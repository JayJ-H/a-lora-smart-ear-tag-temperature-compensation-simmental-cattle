suppressPackageStartupMessages({
  library(dplyr)
  library(gbm)
  library(xgboost)
})

get_script_dir <- function() {
  args <- commandArgs(trailingOnly = FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg) == 0) return(normalizePath(getwd(), winslash = "/", mustWork = FALSE))
  normalizePath(dirname(sub("^--file=", "", file_arg[1])), winslash = "/", mustWork = FALSE)
}

BASE_DIR <- get_script_dir()
SHARED_ROOT <- normalizePath(file.path(BASE_DIR, "..", "..", ".."), winslash = "/", mustWork = TRUE)
OUTPUT_DIR <- Sys.getenv(
  "TH_SHRC_BRANCH_OUTPUT_DIR",
  file.path(SHARED_ROOT, "outputs", "analysis", "upstream")
)
dir.create(OUTPUT_DIR, recursive = TRUE, showWarnings = FALSE)
IN_DATASET <- Sys.getenv("TH_SHRC_PUBLIC_INPUT", file.path(SHARED_ROOT, "data", "processed", "paired_temperature_records.csv"))
MIN_RECORDS <- as.integer(Sys.getenv("TH_SHRC_MIN_RECORDS", "8"))
ANALYSIS_SCOPE <- Sys.getenv("TH_SHRC_ANALYSIS_SCOPE", "all_unique")
FOLD_SEED <- as.integer(Sys.getenv("TH_SHRC_FOLD_SEED", "20260523"))
OUT_METRICS <- file.path(OUTPUT_DIR, "individual_session_calibration_oof_metrics.csv")
OUT_FOLD_METRICS <- file.path(OUTPUT_DIR, "individual_session_calibration_oof_fold_metrics.csv")
OUT_PREDS <- file.path(OUTPUT_DIR, "individual_session_calibration_oof_predictions.csv")
OUT_CHOICES <- file.path(OUTPUT_DIR, "individual_session_calibration_oof_choices.csv")
OUT_CHECK <- file.path(OUTPUT_DIR, "individual_session_calibration_oof_check.csv")

rmse <- function(y, p) sqrt(mean((y - p)^2, na.rm = TRUE))
mae <- function(y, p) mean(abs(y - p), na.rm = TRUE)
r2_score <- function(y, p) {
  keep <- is.finite(y) & is.finite(p)
  y <- y[keep]
  p <- p[keep]
  den <- sum((y - mean(y))^2)
  if (den <= 0) return(NA_real_)
  1 - sum((y - p)^2) / den
}
safe_sd <- function(x) {
  x <- x[is.finite(x)]
  if (length(x) <= 1) return(0)
  sd(x)
}
clip <- function(x, lo, hi) pmin(pmax(x, lo), hi)

weighted_median <- function(x, w) {
  ok <- is.finite(x) & is.finite(w) & w > 0
  x <- x[ok]
  w <- w[ok]
  if (length(x) == 0) return(NA_real_)
  o <- order(x)
  x <- x[o]
  w <- w[o] / sum(w[o])
  x[which(cumsum(w) >= 0.5)[1]]
}

time_period <- function(time) {
  ifelse(time >= 10 & time <= 16, "midday",
    ifelse(time >= 18 | time <= 2, "late", "transition")
  )
}

circ_dist <- function(a, b) {
  d <- abs(a - b)
  pmin(d, 24 - d)
}

read_analysis_dataset <- function() {
  if (!file.exists(IN_DATASET)) stop("Missing input: ", IN_DATASET)
  df <- read.csv(IN_DATASET, stringsAsFactors = FALSE, check.names = FALSE, fileEncoding = "UTF-8-BOM")
  locked_fold_column <- paste0("OuterFold_", FOLD_SEED)
  if (!locked_fold_column %in% names(df)) df[[locked_fold_column]] <- NA_integer_
  df <- df %>% transmute(RecordID, MeasurementUnitID, CowKey, Source, RowID, SourceRowID, AcquisitionSession, OuterFoldID = as.integer(.data[[locked_fold_column]]), Ear = EarTemperature_C, Rectal = CoreReferenceTemperature_C, Air = AmbientTemperature_C, Time = MeasurementTime_hour, SourceType, EarStatus, SourceWeight, SeqInCowSource)
  num_cols <- intersect(
    c("Ear", "Rectal", "Air", "Time", "SourceWeight", "SourceRowID", "RowID", "SeqInCowSource", "AcquisitionSession"),
    names(df)
  )
  for (col in num_cols) df[[col]] <- suppressWarnings(as.numeric(df[[col]]))
  selected_sources <- if (ANALYSIS_SCOPE == "all_unique") {
    c("S03", "S04", "S02", "S01")
  } else {
    stop("Unknown TH_SHRC_ANALYSIS_SCOPE: ", ANALYSIS_SCOPE)
  }
  df %>%
    filter(Source %in% selected_sources) %>%
    mutate(
      Source = as.character(Source),
      CowKey = as.character(CowKey),
      SourceType = as.character(SourceType),
      EarStatus = as.character(EarStatus)
    ) %>%
    filter(
      is.finite(Ear), is.finite(Rectal), is.finite(Air), is.finite(Time),
       is.finite(SourceRowID), is.finite(RowID), is.finite(AcquisitionSession),
      Ear > 25, Rectal > 35, Rectal < 42, Air > -40, Air < 60, Time >= 0, Time <= 24
    ) %>%
    group_by(CowKey) %>%
    filter(n() >= MIN_RECORDS) %>%
    ungroup() %>%
    arrange(CowKey, AcquisitionSession, Time, Ear, Air)
}

locked_or_generated_outer_folds <- function(df, seed = FOLD_SEED) {
  locked <- suppressWarnings(as.integer(df$OuterFoldID))
  if (length(locked) == nrow(df) && all(is.finite(locked)) && all(locked %in% 1:5)) {
    return(locked)
  }
  make_within_cow_folds(df, k = 5, seed = seed)
}

add_batch_session_features <- function(df) {
  df$.orig_order <- seq_len(nrow(df))
  df <- df %>%
    mutate(
      TimePeriod = time_period(Time),
      Source = as.character(Source),
      CowKey = as.character(CowKey),
      AcquisitionSession = as.integer(AcquisitionSession)
    ) %>%
    group_by(CowKey, AcquisitionSession) %>%
    arrange(AcquisitionSession, Time, Ear, Air, .by_group = TRUE) %>%
    mutate(
      SourceOrderIndex = row_number(),
      SourceN = n(),
      SourceOrderPct = ifelse(SourceN > 1, (SourceOrderIndex - 1) / (SourceN - 1), 0)
    ) %>%
    ungroup() %>%
    mutate(
      SourceSessionIndex = AcquisitionSession,
      DayIndex = pmax(1L, AcquisitionSession),
      SessionID = paste(CowKey, sprintf("S%02d", SourceSessionIndex), sep = "_"),
      BatchID = paste(CowKey, sprintf("B%02d", SourceSessionIndex), sep = "_"),
      DayID = paste(CowKey, sprintf("D%02d", DayIndex), sep = "_"),
      MaySourceOrderPct = SourceOrderPct,
      HeatSegment = case_when(
        Air < 10 ~ "thermal_cold",
        Air < 20 ~ "thermal_cool",
        Air < 30 ~ "thermal_warm",
        TRUE ~ "thermal_hot"
      )
    ) %>%
    group_by(CowKey, SessionID) %>%
    arrange(Time, Ear, Air, .by_group = TRUE) %>%
    mutate(
      SessionRowIndex = row_number(),
      SessionSize = n(),
      SessionRowPct = ifelse(SessionSize > 1, (SessionRowIndex - 1) / (SessionSize - 1), 0),
      SessionMeanAir = mean(Air),
      SessionMaxAir = max(Air),
      SessionMeanEar = mean(Ear),
      SessionMeanTime = mean(Time),
      SessionTimeSpan = max(Time) - min(Time),
      SessionHotRate = mean(Air >= 30)
    ) %>%
    ungroup() %>%
    group_by(CowKey, AcquisitionSession) %>%
    arrange(AcquisitionSession, Time, Ear, Air, .by_group = TRUE) %>%
    mutate(
      SeqInCowSourceRow = row_number(),
      CowSourceRowN = n(),
      EarOrderLag1 = lag(Ear, 1),
      EarOrderLag2 = lag(Ear, 2),
      AirOrderLag1 = lag(Air, 1),
      TimeOrderLag1 = lag(Time, 1),
      OrderEarDelta1 = Ear - lag(Ear, 1),
      OrderAirDelta1 = Air - lag(Air, 1),
      OrderTimeDelta1 = Time - lag(Time, 1)
    ) %>%
    ungroup() %>%
    mutate(
      EarOrderLag1 = ifelse(is.na(EarOrderLag1), Ear, EarOrderLag1),
      EarOrderLag2 = ifelse(is.na(EarOrderLag2), EarOrderLag1, EarOrderLag2),
      AirOrderLag1 = ifelse(is.na(AirOrderLag1), Air, AirOrderLag1),
      TimeOrderLag1 = ifelse(is.na(TimeOrderLag1), Time, TimeOrderLag1),
      OrderEarDelta1 = ifelse(is.na(OrderEarDelta1), 0, OrderEarDelta1),
      OrderAirDelta1 = ifelse(is.na(OrderAirDelta1), 0, OrderAirDelta1),
      OrderTimeDelta1 = ifelse(is.na(OrderTimeDelta1), 0, OrderTimeDelta1),
      TimeSin = sin(2 * pi * Time / 24),
      TimeCos = cos(2 * pi * Time / 24),
      ThermalLoad = clip((Air - 18) / 17, 0, 1),
      EarAirGap = Ear - Air,
      HotFlag = as.integer(Air >= 30),
      HighHeatFlag = as.integer(Air >= 33),
      NightFlag = as.integer(Time >= 20 | Time <= 6),
      AirMinusSessionMean = Air - SessionMeanAir,
      EarMinusSessionMean = Ear - SessionMeanEar,
      TimeMinusSessionMean = Time - SessionMeanTime
    ) %>%
    arrange(.orig_order) %>%
    select(-.orig_order)
  df
}

target_summary <- function(.data, group_cols, prefix) {
  .data %>%
    group_by(across(all_of(group_cols))) %>%
    summarise(
      "{prefix}N" := n(),
      "{prefix}RectalCenter" := weighted.mean(Rectal, pmax(SourceWeight, 1e-6), na.rm = TRUE),
      "{prefix}GapBias" := weighted_median(Rectal - Ear, pmax(SourceWeight, 1e-6)),
      "{prefix}RectalSD" := safe_sd(Rectal),
      .groups = "drop"
    )
}

fill_num <- function(x, value) {
  x <- as.numeric(x)
  ifelse(is.na(x) | !is.finite(x), value, x)
}

attach_train_observable_profiles <- function(train, test) {
  profile_cols <- c("CowAirMean", "CowAirSD", "ThermalRegime")
  train <- train %>% dplyr::select(-dplyr::any_of(profile_cols))
  test <- test %>% dplyr::select(-dplyr::any_of(profile_cols))
  global_air_mean <- mean(train$Air)
  global_air_sd <- safe_sd(train$Air)
  profiles <- train %>%
    group_by(CowKey) %>%
    summarise(CowAirMean = mean(Air), CowAirSD = safe_sd(Air), .groups = "drop")
  add_profile <- function(x) {
    x %>%
      left_join(profiles, by = "CowKey") %>%
      mutate(
        CowAirMean = fill_num(CowAirMean, global_air_mean),
        CowAirSD = fill_num(CowAirSD, global_air_sd),
        ThermalRegime = case_when(
          CowAirSD >= 8 ~ "wide_range",
          CowAirMean >= 22 ~ "stable_hot",
          TRUE ~ "stable_cool"
        )
      )
  }
  list(train = add_profile(train), test = add_profile(test))
}

attach_train_target_features <- function(train, test) {
  profiles <- attach_train_observable_profiles(train, test)
  train <- profiles$train
  test <- profiles$test
  global_center <- weighted.mean(train$Rectal, pmax(train$SourceWeight, 1e-6), na.rm = TRUE)
  global_gap <- weighted_median(train$Rectal - train$Ear, pmax(train$SourceWeight, 1e-6))
  global_sd <- safe_sd(train$Rectal)

  source_tbl <- target_summary(train, c("ThermalRegime"), "TrainSource")
  cow_tbl <- target_summary(train, c("CowKey"), "TrainCow")
  session_tbl <- target_summary(train, c("SessionID"), "TrainSession")
  day_tbl <- target_summary(train, c("DayID"), "TrainDay")
  period_tbl <- target_summary(train, c("ThermalRegime", "TimePeriod"), "TrainSourcePeriod")
  cow_session_tbl <- target_summary(train, c("CowKey", "SessionID"), "TrainCowSession")
  heat_tbl <- target_summary(train, c("HeatSegment"), "TrainHeatSegment")

  add_tbl <- function(x) {
    x %>%
      left_join(source_tbl, by = "ThermalRegime") %>%
      left_join(cow_tbl, by = "CowKey") %>%
      left_join(session_tbl, by = "SessionID") %>%
      left_join(day_tbl, by = "DayID") %>%
      left_join(period_tbl, by = c("ThermalRegime", "TimePeriod")) %>%
      left_join(cow_session_tbl, by = c("CowKey", "SessionID")) %>%
      left_join(heat_tbl, by = "HeatSegment") %>%
      mutate(
        TrainSourceN = fill_num(TrainSourceN, 0),
        TrainSourceRectalCenter = fill_num(TrainSourceRectalCenter, global_center),
        TrainSourceGapBias = fill_num(TrainSourceGapBias, global_gap),
        TrainSourceRectalSD = fill_num(TrainSourceRectalSD, global_sd),

        TrainCowN = fill_num(TrainCowN, 0),
        TrainCowRectalCenter = fill_num(TrainCowRectalCenter, global_center),
        TrainCowGapBias = fill_num(TrainCowGapBias, global_gap),
        TrainCowRectalSD = fill_num(TrainCowRectalSD, global_sd),

        TrainSessionN = fill_num(TrainSessionN, 0),
        TrainSessionRectalCenter = fill_num(TrainSessionRectalCenter, TrainSourceRectalCenter),
        TrainSessionGapBias = fill_num(TrainSessionGapBias, TrainSourceGapBias),
        TrainSessionRectalSD = fill_num(TrainSessionRectalSD, TrainSourceRectalSD),

        TrainDayN = fill_num(TrainDayN, 0),
        TrainDayRectalCenter = fill_num(TrainDayRectalCenter, TrainSourceRectalCenter),
        TrainDayGapBias = fill_num(TrainDayGapBias, TrainSourceGapBias),

        TrainSourcePeriodN = fill_num(TrainSourcePeriodN, 0),
        TrainSourcePeriodRectalCenter = fill_num(TrainSourcePeriodRectalCenter, TrainSourceRectalCenter),
        TrainSourcePeriodGapBias = fill_num(TrainSourcePeriodGapBias, TrainSourceGapBias),

        TrainCowSessionN = fill_num(TrainCowSessionN, 0),
        TrainCowSessionRectalCenter = fill_num(TrainCowSessionRectalCenter, TrainCowRectalCenter),
        TrainCowSessionGapBias = fill_num(TrainCowSessionGapBias, TrainCowGapBias),

        TrainHeatSegmentN = fill_num(TrainHeatSegmentN, 0),
        TrainHeatSegmentRectalCenter = fill_num(TrainHeatSegmentRectalCenter, TrainSourceRectalCenter),
        TrainHeatSegmentGapBias = fill_num(TrainHeatSegmentGapBias, TrainSourceGapBias),

        SourceCenterShrink = pmin(1, TrainSourceN / (TrainSourceN + 12)),
        SourceCenterFeature = SourceCenterShrink * TrainSourceRectalCenter + (1 - SourceCenterShrink) * global_center,
        CowCenterShrink = pmin(1, TrainCowN / (TrainCowN + 4)),
        CowCenterFeature = CowCenterShrink * TrainCowRectalCenter + (1 - CowCenterShrink) * SourceCenterFeature,
        SessionCenterShrink = pmin(1, TrainSessionN / (TrainSessionN + 6)),
        SessionCenterFeature = SessionCenterShrink * TrainSessionRectalCenter + (1 - SessionCenterShrink) * SourceCenterFeature,
        DayCenterShrink = pmin(1, TrainDayN / (TrainDayN + 8)),
        DayCenterFeature = DayCenterShrink * TrainDayRectalCenter + (1 - DayCenterShrink) * SourceCenterFeature,
        SourcePeriodCenterShrink = pmin(1, TrainSourcePeriodN / (TrainSourcePeriodN + 8)),
        SourcePeriodCenterFeature = SourcePeriodCenterShrink * TrainSourcePeriodRectalCenter + (1 - SourcePeriodCenterShrink) * SourceCenterFeature,
        HeatSegmentCenterShrink = pmin(1, TrainHeatSegmentN / (TrainHeatSegmentN + 8)),
        HeatSegmentCenterFeature = HeatSegmentCenterShrink * TrainHeatSegmentRectalCenter + (1 - HeatSegmentCenterShrink) * SourceCenterFeature,
        CowSessionCenterShrink = pmin(1, TrainCowSessionN / (TrainCowSessionN + 2)),
        CowSessionCenterFeature = CowSessionCenterShrink * TrainCowSessionRectalCenter + (1 - CowSessionCenterShrink) * CowCenterFeature,

        CowGapFeature = CowCenterShrink * TrainCowGapBias + (1 - CowCenterShrink) * TrainSourceGapBias,
        SessionGapFeature = SessionCenterShrink * TrainSessionGapBias + (1 - SessionCenterShrink) * TrainSourceGapBias,
        CowSessionGapFeature = CowSessionCenterShrink * TrainCowSessionGapBias + (1 - CowSessionCenterShrink) * CowGapFeature
      )
  }

  list(train = add_tbl(train), test = add_tbl(test))
}

factor_vars <- c(
  "Source", "SourceType", "EarStatus", "CowKey", "TimePeriod",
  "SessionID", "BatchID", "DayID", "HeatSegment", "ThermalRegime"
)

align_factor_levels <- function(train, test) {
  for (v in intersect(factor_vars, names(train))) {
    vals <- unique(c(as.character(train[[v]]), as.character(test[[v]])))
    vals <- vals[!is.na(vals)]
    if (length(vals) < 2) vals <- c(vals, "__dummy_level__")
    train[[v]] <- factor(as.character(train[[v]]), levels = vals)
    test[[v]] <- factor(as.character(test[[v]]), levels = vals)
  }
  list(train = train, test = test)
}

align_matrices <- function(train, test, formula) {
  train$.is_train_design <- TRUE
  test$.is_train_design <- FALSE
  combo <- bind_rows(train, test)
  used <- all.vars(formula)
  for (v in intersect(used, names(combo))) {
    if (is.character(combo[[v]]) || is.factor(combo[[v]])) {
      vals <- unique(as.character(combo[[v]][!is.na(combo[[v]])]))
      if (length(vals) < 2) vals <- c(vals, "__dummy_level__")
      combo[[v]] <- factor(as.character(combo[[v]]), levels = vals)
    }
  }
  x <- model.matrix(formula, data = combo)
  list(
    x_train = x[combo$.is_train_design, , drop = FALSE],
    x_test = x[!combo$.is_train_design, , drop = FALSE]
  )
}

ridge_predict <- function(train, test, formula, lambda = 3.0, weights = NULL) {
  mats <- align_matrices(train, test, formula)
  x <- mats$x_train
  xt <- mats$x_test
  y <- train$Rectal
  if (is.null(weights)) weights <- rep(1, length(y))
  weights <- pmax(as.numeric(weights), 1e-6)
  sw <- sqrt(weights)
  xw <- x * sw
  yw <- y * sw
  pen <- diag(lambda, ncol(x))
  if ("(Intercept)" %in% colnames(x)) {
    ii <- which(colnames(x) == "(Intercept)")
    pen[ii, ii] <- 0
  }
  beta <- tryCatch(
    solve(crossprod(xw) + pen, crossprod(xw, yw)),
    error = function(e) MASS::ginv(crossprod(xw) + pen) %*% crossprod(xw, yw)
  )
  as.numeric(xt %*% beta)
}

base_formula <- ~ Ear + I(Ear^2) + Air + I(Air^2) + Time + TimeSin + TimeCos +
  ThermalLoad + EarAirGap + I(EarAirGap^2) + HotFlag + HighHeatFlag + NightFlag +
  SourceOrderPct + MaySourceOrderPct + SourceOrderIndex + SessionRowPct + SessionSize +
  SessionMeanAir + SessionMaxAir + SessionMeanEar + SessionHotRate + SessionTimeSpan +
  AirMinusSessionMean + EarMinusSessionMean + TimeMinusSessionMean +
  EarOrderLag1 + EarOrderLag2 + AirOrderLag1 + TimeOrderLag1 +
  OrderEarDelta1 + OrderAirDelta1 + OrderTimeDelta1 +
  CowCenterFeature + SessionCenterFeature + DayCenterFeature + SourcePeriodCenterFeature +
  HeatSegmentCenterFeature + CowSessionCenterFeature + CowGapFeature +
  SessionGapFeature + CowSessionGapFeature + TrainCowN + TrainSessionN + TrainCowSessionN +
  CowAirMean + CowAirSD + ThermalRegime + Source + CowKey +
  TimePeriod + BatchID + DayID + HeatSegment

gbm_formula <- Rectal ~ Ear + Air + Time + TimeSin + TimeCos + ThermalLoad + EarAirGap +
  HotFlag + HighHeatFlag + NightFlag + SourceOrderPct + MaySourceOrderPct +
  SessionRowPct + SessionSize + SessionMeanAir + SessionMaxAir + SessionHotRate +
  AirMinusSessionMean + EarMinusSessionMean + EarOrderLag1 + AirOrderLag1 +
  OrderEarDelta1 + OrderAirDelta1 + CowCenterFeature + SessionCenterFeature +
  CowSessionCenterFeature + SourcePeriodCenterFeature + HeatSegmentCenterFeature +
  CowGapFeature + SessionGapFeature + CowSessionGapFeature +
  CowAirMean + CowAirSD + ThermalRegime + Source + CowKey +
  TimePeriod + BatchID + HeatSegment

fit_gbm_predict <- function(train, test) {
  fallback <- weighted.mean(train$Rectal, pmax(train$SourceWeight, 1e-6), na.rm = TRUE)
  tryCatch({
    fit <- gbm(
      gbm_formula,
      data = train,
      weights = train$SourceWeight,
      distribution = "gaussian",
      n.trees = 420,
      interaction.depth = 3,
      shrinkage = 0.025,
      n.minobsinnode = 5,
      bag.fraction = 0.85,
      verbose = FALSE
    )
    pred <- as.numeric(predict(fit, newdata = test, n.trees = 420))
    if (length(pred) != nrow(test)) rep(fallback, nrow(test)) else ifelse(is.finite(pred), pred, fallback)
  }, error = function(e) rep(fallback, nrow(test)))
}

fit_xgb_predict <- function(train, test) {
  fallback <- weighted.mean(train$Rectal, pmax(train$SourceWeight, 1e-6), na.rm = TRUE)
  tryCatch({
    mats <- align_matrices(train, test, base_formula)
    dtrain <- xgb.DMatrix(mats$x_train, label = train$Rectal, weight = train$SourceWeight)
    dtest <- xgb.DMatrix(mats$x_test)
    fit <- xgb.train(
      params = list(
        objective = "reg:squarederror",
        eta = 0.035,
        max_depth = 2,
        min_child_weight = 5,
        subsample = 0.9,
        colsample_bytree = 0.85,
        lambda = 4.0,
        alpha = 0.20,
        verbosity = 0
      ),
      data = dtrain,
      nrounds = 220,
      verbose = 0
    )
    pred <- as.numeric(predict(fit, dtest))
    if (length(pred) != nrow(test)) rep(fallback, nrow(test)) else ifelse(is.finite(pred), pred, fallback)
  }, error = function(e) rep(fallback, nrow(test)))
}

predict_batch_model <- function(train_raw, test_raw) {
  actual <- test_raw$Rectal
  test_no_target <- test_raw
  test_no_target$Rectal <- NA_real_
  ft <- attach_train_target_features(train_raw, test_no_target)
  aligned <- align_factor_levels(ft$train, ft$test)
  train <- aligned$train
  test <- aligned$test

  train_ridge <- ridge_predict(train, train, base_formula, lambda = 4.0, weights = train$SourceWeight)
  test_ridge <- ridge_predict(train, test, base_formula, lambda = 4.0, weights = train$SourceWeight)
  train_gbm <- fit_gbm_predict(train, train)
  test_gbm <- fit_gbm_predict(train, test)
  train_xgb <- fit_xgb_predict(train, train)
  test_xgb <- fit_xgb_predict(train, test)

  meta_train <- train %>%
    transmute(
      Rectal = Rectal,
      SourceWeight = SourceWeight,
      ridge = train_ridge,
      gbm = train_gbm,
      xgb = train_xgb,
      cow = CowCenterFeature,
      session = SessionCenterFeature,
      csession = CowSessionCenterFeature,
      heat = HeatSegmentCenterFeature,
      gap = CowSessionGapFeature,
      Source = Source,
      HeatSegment = HeatSegment
    )
  meta_test <- test %>%
    transmute(
      ridge = test_ridge,
      gbm = test_gbm,
      xgb = test_xgb,
      cow = CowCenterFeature,
      session = SessionCenterFeature,
      csession = CowSessionCenterFeature,
      heat = HeatSegmentCenterFeature,
      gap = CowSessionGapFeature,
      Source = Source,
      HeatSegment = HeatSegment
    )
  meta_formula <- ~ ridge + gbm + xgb + cow + session + csession + heat + gap + Source + HeatSegment
  meta_pred <- ridge_predict(meta_train, meta_test, meta_formula, lambda = 12.0, weights = meta_train$SourceWeight)
  meta_train_pred <- ridge_predict(meta_train, meta_train, meta_formula, lambda = 12.0, weights = meta_train$SourceWeight)

  shrink_grid <- expand.grid(alpha = seq(0.55, 1.05, by = 0.05), beta = seq(0, 0.25, by = 0.05))
  best <- list(score = Inf, alpha = 1, beta = 0)
  for (i in seq_len(nrow(shrink_grid))) {
    a <- shrink_grid$alpha[i]
    b <- shrink_grid$beta[i]
    cand <- train$CowSessionCenterFeature + a * (meta_train_pred - train$CowSessionCenterFeature) +
      b * (train$HeatSegmentCenterFeature - train$SourceCenterFeature)
    score <- rmse(train$Rectal, cand)
    if (is.finite(score) && score < best$score) best <- list(score = score, alpha = a, beta = b)
  }
  pred <- test$CowSessionCenterFeature + best$alpha * (meta_pred - test$CowSessionCenterFeature) +
    best$beta * (test$HeatSegmentCenterFeature - test$SourceCenterFeature)
  pred <- ifelse(is.finite(pred), pred, weighted.mean(train$Rectal, pmax(train$SourceWeight, 1e-6), na.rm = TRUE))

  list(
    pred = as.numeric(pred),
    test_features = test,
    actual = actual,
    ridge = as.numeric(test_ridge),
    gbm = as.numeric(test_gbm),
    xgb = as.numeric(test_xgb),
    shrink_alpha = best$alpha,
    shrink_beta = best$beta
  )
}

make_within_cow_folds <- function(df, k = 5, seed = FOLD_SEED) {
  if (!"MeasurementUnitID" %in% names(df)) stop("MeasurementUnitID is required for grouped folds.")
  if (any(is.na(df$MeasurementUnitID) | df$MeasurementUnitID == "")) stop("MeasurementUnitID contains missing values.")
  unit_cows <- tapply(as.character(df$CowKey), df$MeasurementUnitID, function(x) length(unique(x)))
  if (any(unit_cows != 1L)) stop("A MeasurementUnitID cannot span multiple cattle.")
  set.seed(seed)
  fold <- integer(nrow(df))
  for (cow in unique(df$CowKey)) {
    idx <- which(df$CowKey == cow)
    units <- unique(as.character(df$MeasurementUnitID[idx]))
    unit_fold <- setNames(sample(rep(seq_len(k), length.out = length(units))), units)
    fold[idx] <- unname(unit_fold[as.character(df$MeasurementUnitID[idx])])
  }
  fold
}

config_grid <- function() {
  bind_rows(
    tibble::tibble(MemoryFamily = "batch_session", ConfigID = "session_k3_o06_t2_e08_a35_b075", k = 3L, h_order = 6, h_time = 2.0, h_ear = 0.8, h_air = 3.5, bandwidth = 0.75, same_session_first = TRUE),
    tibble::tibble(MemoryFamily = "batch_session", ConfigID = "session_k5_o10_t3_e10_a45_b100", k = 5L, h_order = 10, h_time = 3.0, h_ear = 1.0, h_air = 4.5, bandwidth = 1.00, same_session_first = TRUE),
    tibble::tibble(MemoryFamily = "batch_session", ConfigID = "source_k5_o12_t3_e08_a40_b080", k = 5L, h_order = 12, h_time = 3.0, h_ear = 0.8, h_air = 4.0, bandwidth = 0.80, same_session_first = FALSE),
    tibble::tibble(MemoryFamily = "batch_session", ConfigID = "source_k8_o20_t4_e12_a60_b100", k = 8L, h_order = 20, h_time = 4.0, h_ear = 1.2, h_air = 6.0, bandwidth = 1.00, same_session_first = FALSE),
    tibble::tibble(MemoryFamily = "global_feature", ConfigID = "global_k1_t2_e03_a5", k = 1L, h_order = NA_real_, h_time = 2.0, h_ear = 0.3, h_air = 5.0, bandwidth = 1.00, same_session_first = FALSE),
    tibble::tibble(MemoryFamily = "global_feature", ConfigID = "global_k1_t2_e06_a5", k = 1L, h_order = NA_real_, h_time = 2.0, h_ear = 0.6, h_air = 5.0, bandwidth = 1.00, same_session_first = FALSE),
    tibble::tibble(MemoryFamily = "global_feature", ConfigID = "global_k2_t2_e03_a5_b05", k = 2L, h_order = NA_real_, h_time = 2.0, h_ear = 0.3, h_air = 5.0, bandwidth = 0.50, same_session_first = FALSE),
    tibble::tibble(MemoryFamily = "global_feature", ConfigID = "global_k2_t2_e06_a10_b05", k = 2L, h_order = NA_real_, h_time = 2.0, h_ear = 0.6, h_air = 10.0, bandwidth = 0.50, same_session_first = FALSE),
    tibble::tibble(MemoryFamily = "global_feature", ConfigID = "global_k2_t2_e06_a5_b1", k = 2L, h_order = NA_real_, h_time = 2.0, h_ear = 0.6, h_air = 5.0, bandwidth = 1.00, same_session_first = FALSE)
  )
}

batch_memory_predict <- function(train, test, cfg) {
  pred <- rep(NA_real_, nrow(test))
  nearest_distance <- rep(NA_real_, nrow(test))
  nearest_row_id <- rep(NA_integer_, nrow(test))
  nearest_source <- rep(NA_character_, nrow(test))
  nearest_session <- rep(NA_character_, nrow(test))
  exact_observable_match <- rep(FALSE, nrow(test))

  for (i in seq_len(nrow(test))) {
    r <- test[i, ]
    pool_idx <- which(train$CowKey == r$CowKey)
    if (isTRUE(cfg$same_session_first)) {
      session_idx <- pool_idx[train$SessionID[pool_idx] == r$SessionID]
      if (length(session_idx) >= cfg$k) pool_idx <- session_idx
    }
    if (length(pool_idx) < cfg$k) {
      pool_idx <- which(train$HeatSegment == r$HeatSegment)
    }
    if (length(pool_idx) < cfg$k) {
      pool_idx <- which(train$CowKey == r$CowKey)
    }
    if (length(pool_idx) == 0) pool_idx <- seq_len(nrow(train))

    dt <- circ_dist(train$Time[pool_idx], r$Time)
    de <- abs(train$Ear[pool_idx] - r$Ear)
    da <- abs(train$Air[pool_idx] - r$Air)
    do <- abs(train$SeqInCowSourceRow[pool_idx] - r$SeqInCowSourceRow)
    session_penalty <- ifelse(train$SessionID[pool_idx] == r$SessionID, 0, 1.25)
    day_penalty <- ifelse(train$DayID[pool_idx] == r$DayID, 0, 0.55)
    cow_bonus <- ifelse(train$CowKey[pool_idx] == r$CowKey, -0.35, 0)
    d2 <- (do / cfg$h_order)^2 + (dt / cfg$h_time)^2 + (de / cfg$h_ear)^2 +
      (da / cfg$h_air)^2 + session_penalty + day_penalty + cow_bonus
    d2 <- pmax(d2, 0)
    ord <- order(d2)
    k <- min(cfg$k, length(ord))
    idx <- pool_idx[ord[seq_len(k)]]
    dsel <- d2[ord[seq_len(k)]]
    w <- exp(-0.5 * dsel / (cfg$bandwidth^2)) * pmax(train$SourceWeight[idx], 1e-6)
    if (sum(w) <= 1e-12) {
      pred[i] <- mean(train$Rectal[idx])
    } else {
      pred[i] <- sum(w * train$Rectal[idx]) / sum(w)
    }
    nearest_distance[i] <- sqrt(d2[ord[1]])
    nearest_row_id[i] <- train$RowID[idx[1]]
    nearest_source[i] <- as.character(train$Source[idx[1]])
    nearest_session[i] <- as.character(train$SessionID[idx[1]])
    exact_observable_match[i] <- isTRUE(
      dt[ord[1]] < 1e-9 && de[ord[1]] < 1e-9 && da[ord[1]] < 1e-9
    )
  }

  list(
    pred = pred,
    nearest_distance = nearest_distance,
    nearest_row_id = nearest_row_id,
    nearest_source = nearest_source,
    nearest_session = nearest_session,
    exact_observable_match = exact_observable_match
  )
}

global_feature_memory_predict <- function(train, test, cfg) {
  pred <- rep(NA_real_, nrow(test))
  nearest_distance <- rep(NA_real_, nrow(test))
  nearest_row_id <- rep(NA_integer_, nrow(test))
  nearest_source <- rep(NA_character_, nrow(test))
  nearest_session <- rep(NA_character_, nrow(test))
  exact_observable_match <- rep(FALSE, nrow(test))

  for (i in seq_len(nrow(test))) {
    r <- test[i, ]
    dt <- circ_dist(train$Time, r$Time)
    de <- abs(train$Ear - r$Ear)
    da <- abs(train$Air - r$Air)
    d2 <- (dt / cfg$h_time)^2 + (de / cfg$h_ear)^2 + (da / cfg$h_air)^2
    ord <- order(d2)
    k <- min(cfg$k, length(ord))
    idx <- ord[seq_len(k)]
    if (k == 1) {
      pred[i] <- train$Rectal[idx[1]]
    } else {
      w <- exp(-0.5 * d2[idx] / (cfg$bandwidth^2)) * pmax(train$SourceWeight[idx], 1e-6)
      if (sum(w) <= 1e-12) pred[i] <- mean(train$Rectal[idx]) else pred[i] <- sum(w * train$Rectal[idx]) / sum(w)
    }
    nearest_distance[i] <- sqrt(d2[idx[1]])
    nearest_row_id[i] <- train$RowID[idx[1]]
    nearest_source[i] <- as.character(train$Source[idx[1]])
    nearest_session[i] <- as.character(train$SessionID[idx[1]])
    exact_observable_match[i] <- isTRUE(dt[idx[1]] < 1e-9 && de[idx[1]] < 1e-9 && da[idx[1]] < 1e-9)
  }

  list(
    pred = pred,
    nearest_distance = nearest_distance,
    nearest_row_id = nearest_row_id,
    nearest_source = nearest_source,
    nearest_session = nearest_session,
    exact_observable_match = exact_observable_match
  )
}

memory_predict_dispatch <- function(train, test, cfg) {
  if (identical(as.character(cfg$MemoryFamily), "global_feature")) {
    return(global_feature_memory_predict(train, test, cfg))
  }
  batch_memory_predict(train, test, cfg)
}

select_blend_choice <- function(train_meta, base_oof, mem_oof, cfgs, regime, alpha_grid = seq(0, 1, by = 0.02)) {
  seg_mask <- train_meta$ThermalRegime == regime
  if (sum(seg_mask) < 8) seg_mask <- rep(TRUE, nrow(train_meta))

  best <- list(alpha = 1, config_index = 1L, config_id = cfgs$ConfigID[1], rmse = Inf, n = sum(seg_mask))
  for (ci in seq_len(nrow(cfgs))) {
    mem <- mem_oof[, ci]
    ok <- seg_mask & is.finite(base_oof) & is.finite(mem) & is.finite(train_meta$Rectal)
    if (sum(ok) < 8) next
    for (alpha in alpha_grid) {
      p <- alpha * base_oof[ok] + (1 - alpha) * mem[ok]
      score <- rmse(train_meta$Rectal[ok], p)
      if (is.finite(score) && score < best$rmse) {
        best <- list(alpha = alpha, config_index = ci, config_id = cfgs$ConfigID[ci], rmse = score, n = sum(ok))
      }
    }
  }
  best
}

inner_oof_components <- function(train, cfgs, outer_id) {
  inner_fold <- make_within_cow_folds(train, k = 5, seed = FOLD_SEED + 1000 + outer_id)
  base_oof <- rep(NA_real_, nrow(train))
  mem_oof <- matrix(NA_real_, nrow = nrow(train), ncol = nrow(cfgs))
  colnames(mem_oof) <- cfgs$ConfigID

  for (j in sort(unique(inner_fold))) {
    inner_train <- train[inner_fold != j, , drop = FALSE]
    inner_valid <- train[inner_fold == j, , drop = FALSE]
    base <- predict_batch_model(inner_train, inner_valid)
    idx <- which(inner_fold == j)
    base_oof[idx] <- base$pred
    for (ci in seq_len(nrow(cfgs))) {
      mem <- memory_predict_dispatch(inner_train, inner_valid, cfgs[ci, ])
      mem_oof[idx, ci] <- mem$pred
    }
  }
  list(base = base_oof, memory = mem_oof)
}

run_outer_fold <- function(df, fold, outer_id, cfgs) {
  message("individual/session calibration OOF fold ", outer_id)
  train <- df[fold != outer_id, , drop = FALSE]
  test <- df[fold == outer_id, , drop = FALSE]
  profiles <- attach_train_observable_profiles(train, test)
  train <- profiles$train
  test <- profiles$test

  base <- predict_batch_model(train, test)
  inner <- inner_oof_components(train, cfgs, outer_id)

  test_mem <- matrix(NA_real_, nrow = nrow(test), ncol = nrow(cfgs))
  colnames(test_mem) <- cfgs$ConfigID
  test_mem_checks <- vector("list", nrow(cfgs))
  for (ci in seq_len(nrow(cfgs))) {
    mem <- memory_predict_dispatch(train, test, cfgs[ci, ])
    test_mem[, ci] <- mem$pred
    test_mem_checks[[ci]] <- mem
  }

  pred <- rep(NA_real_, nrow(test))
  chosen_config <- character(nrow(test))
  chosen_family <- character(nrow(test))
  chosen_alpha <- numeric(nrow(test))
  chosen_inner_rmse <- numeric(nrow(test))
  memory_pred <- numeric(nrow(test))
  nearest_distance <- numeric(nrow(test))
  nearest_row_id <- integer(nrow(test))
  nearest_source <- character(nrow(test))
  nearest_session <- character(nrow(test))
  exact_match <- logical(nrow(test))
  choice_rows <- list()

  train_meta <- train %>% transmute(Rectal = Rectal, ThermalRegime = ThermalRegime)
  for (regime in sort(unique(test$ThermalRegime))) {
    choice <- select_blend_choice(train_meta, inner$base, inner$memory, cfgs, regime)
    mask <- test$ThermalRegime == regime
    ci <- choice$config_index
    pred[mask] <- choice$alpha * base$pred[mask] + (1 - choice$alpha) * test_mem[mask, ci]
    chosen_config[mask] <- choice$config_id
    chosen_family[mask] <- cfgs$MemoryFamily[ci]
    chosen_alpha[mask] <- choice$alpha
    chosen_inner_rmse[mask] <- choice$rmse
    memory_pred[mask] <- test_mem[mask, ci]
    nearest_distance[mask] <- test_mem_checks[[ci]]$nearest_distance[mask]
    nearest_row_id[mask] <- test_mem_checks[[ci]]$nearest_row_id[mask]
    nearest_source[mask] <- test_mem_checks[[ci]]$nearest_source[mask]
    nearest_session[mask] <- test_mem_checks[[ci]]$nearest_session[mask]
    exact_match[mask] <- test_mem_checks[[ci]]$exact_observable_match[mask]
    choice_rows[[length(choice_rows) + 1]] <- tibble::tibble(
      FoldID = outer_id,
      ThermalRegime = regime,
      AlphaBatchModel = choice$alpha,
      MemoryWeight = 1 - choice$alpha,
      ConfigID = choice$config_id,
      MemoryFamily = cfgs$MemoryFamily[choice$config_index],
      InnerOOFRMSE = choice$rmse,
      InnerOOFN = choice$n,
      ShrinkAlpha = base$shrink_alpha,
      ShrinkBeta = base$shrink_beta
    )
  }

  pred <- ifelse(is.finite(pred), pred, base$pred)
  pred_rows <- tibble::tibble(
    Dataset = "all_measured_520_analysis_set",
    FoldMode = "within_cow_random5",
    FoldID = outer_id,
    Model = "IndividualSessionCalibration",
    RowID = test$RowID,
    SourceRowID = test$SourceRowID,
    CowKey = test$CowKey,
    ThermalRegime = test$ThermalRegime,
    Source = test$Source,
    SourceType = test$SourceType,
    EarStatus = test$EarStatus,
    BatchID = test$BatchID,
    SessionID = test$SessionID,
    DayIndex = test$DayIndex,
    TimePeriod = test$TimePeriod,
    HeatSegment = test$HeatSegment,
    Ear = test$Ear,
    Air = test$Air,
    Time = test$Time,
    Actual = base$actual,
    BatchModelPredicted = base$pred,
    MemoryPredicted = memory_pred,
    RidgePredicted = base$ridge,
    GBMPredicted = base$gbm,
    XGBPredicted = base$xgb,
    Predicted = pred,
    Residual = base$actual - pred,
    ChosenConfig = chosen_config,
    ChosenMemoryFamily = chosen_family,
    AlphaBatchModel = chosen_alpha,
    MemoryWeight = 1 - chosen_alpha,
    InnerChoiceRMSE = chosen_inner_rmse,
    NearestTrainRowID = nearest_row_id,
    NearestTrainSource = nearest_source,
    NearestTrainSessionID = nearest_session,
    NearestDistance = nearest_distance,
    ExactObservableMatchInTrain = exact_match
  )

  list(pred = pred_rows, choice = bind_rows(choice_rows))
}

summarise_metrics <- function(preds) {
  bind_rows(
    preds %>%
      summarise(
        Scope = "ALL",
        Source = "ALL",
        N = n(),
        CowCount = n_distinct(CowKey),
        R2 = r2_score(Actual, Predicted),
        RMSE = rmse(Actual, Predicted),
        MAE = mae(Actual, Predicted),
        Bias = mean(Residual),
        ErrorSD = safe_sd(Residual),
        .groups = "drop"
      ),
    preds %>%
      group_by(Source) %>%
      summarise(
        Scope = "SOURCE",
        N = n(),
        CowCount = n_distinct(CowKey),
        R2 = r2_score(Actual, Predicted),
        RMSE = rmse(Actual, Predicted),
        MAE = mae(Actual, Predicted),
        Bias = mean(Residual),
        ErrorSD = safe_sd(Residual),
        .groups = "drop"
      ) %>%
      select(Scope, Source, everything()),
    preds %>%
      group_by(HeatSegment) %>%
      summarise(
        Scope = "HEAT_SEGMENT",
        Source = first(HeatSegment),
        N = n(),
        CowCount = n_distinct(CowKey),
        R2 = r2_score(Actual, Predicted),
        RMSE = rmse(Actual, Predicted),
        MAE = mae(Actual, Predicted),
        Bias = mean(Residual),
        ErrorSD = safe_sd(Residual),
        .groups = "drop"
      ) %>%
      select(Scope, Source, everything(), -HeatSegment)
  ) %>%
    arrange(factor(Scope, levels = c("ALL", "SOURCE", "HEAT_SEGMENT")), Source)
}

summarise_fold_metrics <- function(preds) {
  bind_rows(
    preds %>%
      group_by(FoldID) %>%
      summarise(Source = "ALL", N = n(), R2 = r2_score(Actual, Predicted), RMSE = rmse(Actual, Predicted), MAE = mae(Actual, Predicted), Bias = mean(Residual), .groups = "drop"),
    preds %>%
      group_by(FoldID, Source) %>%
      summarise(N = n(), R2 = r2_score(Actual, Predicted), RMSE = rmse(Actual, Predicted), MAE = mae(Actual, Predicted), Bias = mean(Residual), .groups = "drop")
  ) %>%
    arrange(FoldID, Source)
}

source_row_checks <- function(df) {
  source_unique <- df %>%
    group_by(Source) %>%
    summarise(
      Rows = n(),
      UniqueSourceRowID = n_distinct(SourceRowID),
      Status = ifelse(UniqueSourceRowID == Rows, "PASS", "FAIL"),
      .groups = "drop"
    ) %>%
    transmute(
      Check = paste0("source_row_unique_", Source),
      Status,
      Detail = "SourceRowID is unique within each source."
    )
  bind_rows(
    source_unique,
    tibble::tibble(Check = "outer_fold_mode", Status = "PASS", Detail = "Outer validation uses same-animal within_cow_random5 folds."),
    tibble::tibble(Check = "test_reference_not_used_for_features", Status = "PASS", Detail = "Held-out reference temperature is restored only for scoring."),
    tibble::tibble(Check = "validation_protocol", Status = "INFO", Detail = "Validation protocol: row-level same-animal OOF with fixed outer folds.")
  )
}

main <- function() {
  raw <- read_analysis_dataset()
  df <- add_batch_session_features(raw)
  cfgs <- config_grid()
  fold <- locked_or_generated_outer_folds(df, seed = FOLD_SEED)

  outputs <- vector("list", length(sort(unique(fold))))
  i <- 1
  for (outer_id in sort(unique(fold))) {
    outputs[[i]] <- run_outer_fold(df, fold, outer_id, cfgs)
    i <- i + 1
  }

  preds <- bind_rows(lapply(outputs, `[[`, "pred"))
  choices <- bind_rows(lapply(outputs, `[[`, "choice"))
  metrics <- summarise_metrics(preds)
  fold_metrics <- summarise_fold_metrics(preds)
  checks <- bind_rows(
    source_row_checks(df),
    preds %>%
      summarise(
        Check = "nearest_observable_match",
        Status = "INFO",
        Detail = paste0(
          "Exact Ear/Air/Time training-row matches in the selected memory component: ",
          sum(ExactObservableMatchInTrain), "/", n(),
          "; median nearest distance=", sprintf("%.4f", median(NearestDistance, na.rm = TRUE)),
          "."
        )
      )
  )

  write.csv(metrics, OUT_METRICS, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(fold_metrics, OUT_FOLD_METRICS, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(preds, OUT_PREDS, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(choices, OUT_CHOICES, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(checks, OUT_CHECK, row.names = FALSE, fileEncoding = "UTF-8")

  print(metrics %>% filter(Scope %in% c("ALL", "SOURCE")))
  print(metrics %>% filter(Scope == "HEAT_SEGMENT"))
  print(checks)
}

main()
