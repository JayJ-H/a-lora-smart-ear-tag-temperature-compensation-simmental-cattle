suppressPackageStartupMessages({
  library(dplyr)
  library(gbm)
  library(mgcv)
  library(e1071)
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
PUBLIC_INPUT <- Sys.getenv(
  "TH_SHRC_PUBLIC_INPUT",
  file.path(SHARED_ROOT, "data", "processed", "paired_temperature_records.csv")
)
MIN_RECORDS <- as.integer(Sys.getenv("TH_SHRC_MIN_RECORDS", "8"))
ANALYSIS_SCOPE <- Sys.getenv("TH_SHRC_ANALYSIS_SCOPE", "all_unique")
FOLD_SEED <- as.integer(Sys.getenv("TH_SHRC_FOLD_SEED", "20260523"))
PUBLIC_COW_FACTOR_LEVELS <- c(
  "C004", "C028", "C008", "C030", "C018", "C025", "C010", "C019",
  "C005", "C021", "C003", "C002", "C029", "C001", "C027", "C026",
  "C016", "C022", "C014", "C023", "C011", "C017", "C020", "C009",
  "C012", "C006", "C015", "C007", "C013", "C024"
)

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

attach_train_observable_profiles <- function(train, test) {
  profile_cols <- c("CowAirMean", "CowAirSD", "ThermalRegime")
  train <- train %>% dplyr::select(-dplyr::any_of(profile_cols))
  test <- test %>% dplyr::select(-dplyr::any_of(profile_cols))
  global_air_mean <- mean(train$Air)
  global_air_sd <- safe_sd(train$Air)
  cow_profile <- train %>%
    group_by(CowKey) %>%
    summarise(
      CowAirMean = mean(Air),
      CowAirSD = safe_sd(Air),
      .groups = "drop"
    )
  add_profile <- function(x) {
    x %>%
      left_join(cow_profile, by = "CowKey") %>%
      mutate(
        CowAirMean = ifelse(is.na(CowAirMean), global_air_mean, CowAirMean),
        CowAirSD = ifelse(is.na(CowAirSD), global_air_sd, CowAirSD),
        ThermalRegime = case_when(
          CowAirSD >= 8 ~ "wide_range",
          CowAirMean >= 22 ~ "stable_hot",
          TRUE ~ "stable_cool"
        )
      )
  }
  list(train = add_profile(train), test = add_profile(test))
}

load_all_sources <- function() {
  if (!file.exists(PUBLIC_INPUT)) stop("Missing public input: ", PUBLIC_INPUT)
  raw <- read.csv(
    PUBLIC_INPUT,
    stringsAsFactors = FALSE,
    check.names = FALSE,
    fileEncoding = "UTF-8-BOM"
  )
  required <- c(
    "RecordID", "CowKey", "Source", "RowID", "SourceRowID",
    "EarTemperature_C", "CoreReferenceTemperature_C",
    "AmbientTemperature_C", "MeasurementTime_hour", "SourceType",
    "EarStatus", "SourceWeight", "SeqInCowSource", "CowSourceN",
    "EarLag1_C", "EarLag2_C", "AmbientLag1_C", "EarDelta1_C",
    "AmbientDelta1_C", "TimeSin", "TimeCos", "ThermalLoad",
    "EarAirGap_C", "HotFlag", "NightFlag", "MeasurementUnitID",
    "AcquisitionSession"
  )
  missing <- setdiff(required, names(raw))
  if (length(missing) > 0) stop("Public input is missing: ", paste(missing, collapse = ", "))

  locked_fold_column <- paste0("OuterFold_", FOLD_SEED)
  locked_fold <- if (locked_fold_column %in% names(raw)) {
    as.integer(raw[[locked_fold_column]])
  } else {
    rep(NA_integer_, nrow(raw))
  }

  data.frame(
    RecordID = raw$RecordID,
    MeasurementUnitID = as.character(raw$MeasurementUnitID),
    CowKey = raw$CowKey,
    Ear = as.numeric(raw$EarTemperature_C),
    Rectal = as.numeric(raw$CoreReferenceTemperature_C),
    Air = as.numeric(raw$AmbientTemperature_C),
    Time = as.numeric(raw$MeasurementTime_hour),
    Source = raw$Source,
    SourceType = raw$SourceType,
    EarStatus = raw$EarStatus,
    SourceWeight = as.numeric(raw$SourceWeight),
    AcquisitionSession = as.integer(raw$AcquisitionSession),
    OuterFoldID = locked_fold,
    SourceRowID = as.numeric(raw$SourceRowID),
    RowID = as.numeric(raw$RowID),
    SeqInCowSource = as.numeric(raw$SeqInCowSource),
    CowSourceN = as.numeric(raw$CowSourceN),
    EarLag1 = as.numeric(raw$EarLag1_C),
    EarLag2 = as.numeric(raw$EarLag2_C),
    AirLag1 = as.numeric(raw$AmbientLag1_C),
    EarDelta1 = as.numeric(raw$EarDelta1_C),
    AirDelta1 = as.numeric(raw$AmbientDelta1_C),
    TimeSin = as.numeric(raw$TimeSin),
    TimeCos = as.numeric(raw$TimeCos),
    ThermalLoad = as.numeric(raw$ThermalLoad),
    EarAirGap = as.numeric(raw$EarAirGap_C),
    HotFlag = as.numeric(raw$HotFlag),
    NightFlag = as.numeric(raw$NightFlag),
    stringsAsFactors = FALSE
  )
}

locked_or_generated_outer_folds <- function(df, seed = FOLD_SEED) {
  locked <- suppressWarnings(as.integer(df$OuterFoldID))
  if (length(locked) == nrow(df) && all(is.finite(locked)) && all(locked %in% 1:5)) {
    return(locked)
  }
  make_within_cow_folds(df, k = 5, seed = seed)
}

add_observable_features <- function(df) {
  stopifnot(
    !anyDuplicated(df$RowID),
    all(is.finite(df$Ear)),
    all(is.finite(df$Rectal)),
    all(is.finite(df$Air)),
    all(is.finite(df$Time))
  )
  cow_levels <- unique(c(PUBLIC_COW_FACTOR_LEVELS, sort(unique(as.character(df$CowKey)))))
  df %>%
    mutate(
      Source = factor(Source, levels = c("S03", "S04", "S02", "S01")),
      SourceType = factor(SourceType),
      EarStatus = factor(EarStatus),
      CowKey = factor(CowKey, levels = cow_levels)
    )
}

attach_train_target_features <- function(train, test) {
  profiles <- attach_train_observable_profiles(train, test)
  train <- profiles$train
  test <- profiles$test
  global_center <- mean(train$Rectal)
  global_gap <- median(train$Rectal - train$Ear)
  global_rectal_sd <- safe_sd(train$Rectal)
  cow_tbl <- train %>%
    group_by(CowKey) %>%
    summarise(
      TrainCowN = n(),
      TrainCowRectalCenter = mean(Rectal),
      TrainCowGapBias = median(Rectal - Ear),
      TrainCowRectalSD = safe_sd(Rectal),
      .groups = "drop"
    )
  add_tbl <- function(x) {
    x %>%
      left_join(cow_tbl, by = "CowKey") %>%
      mutate(
        TrainCowN = ifelse(is.na(TrainCowN), 0, TrainCowN),
        TrainCowRectalCenter = ifelse(is.na(TrainCowRectalCenter), global_center, TrainCowRectalCenter),
        TrainCowGapBias = ifelse(is.na(TrainCowGapBias), global_gap, TrainCowGapBias),
        TrainCowRectalSD = ifelse(is.na(TrainCowRectalSD), global_rectal_sd, TrainCowRectalSD),
        CowCenterShrink = pmin(1, TrainCowN / (TrainCowN + 4)),
        CowCenterFeature = CowCenterShrink * TrainCowRectalCenter + (1 - CowCenterShrink) * global_center
      )
  }
  list(train = add_tbl(train), test = add_tbl(test))
}

align_matrices <- function(train, test, formula) {
  train$.is_train_design <- TRUE
  test$.is_train_design <- FALSE
  combo <- bind_rows(train, test)
  used_vars <- all.vars(formula)
  for (v in intersect(used_vars, names(combo))) {
    if (is.character(combo[[v]]) || is.factor(combo[[v]])) {
      vals <- unique(as.character(combo[[v]][!is.na(combo[[v]])]))
      if (length(vals) < 2) vals <- c(vals, "__dummy_level__")
      combo[[v]] <- factor(as.character(combo[[v]]), levels = vals)
    }
  }
  x_all <- model.matrix(formula, data = combo)
  list(
    x_train = x_all[combo$.is_train_design, , drop = FALSE],
    x_test = x_all[!combo$.is_train_design, , drop = FALSE]
  )
}

weighted_ridge_predict <- function(train, test, formula, lambda = 1.0, weights = NULL) {
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
  if ("(Intercept)" %in% colnames(x)) pen[which(colnames(x) == "(Intercept)"), which(colnames(x) == "(Intercept)")] <- 0
  beta <- tryCatch(
    solve(crossprod(xw) + pen, crossprod(xw, yw)),
    error = function(e) MASS::ginv(crossprod(xw) + pen) %*% crossprod(xw, yw)
  )
  as.numeric(xt %*% beta)
}

fit_predict_gam <- function(train, test) {
  fallback <- mean(train$Rectal)
  train$CowKey <- factor(as.character(train$CowKey), levels = levels(train$CowKey))
  test$CowKey <- factor(as.character(test$CowKey), levels = levels(train$CowKey))
  train$Source <- factor(as.character(train$Source), levels = levels(train$Source))
  test$Source <- factor(as.character(test$Source), levels = levels(train$Source))
  k_safe <- function(x, hi = 5) max(3, min(hi, length(unique(x[is.finite(x)])) - 1))
  tryCatch({
    fit <- gam(
      Rectal ~
        s(Ear, k = k_safe(train$Ear, 5)) +
        s(Air, k = k_safe(train$Air, 5)) +
        s(EarAirGap, k = k_safe(train$EarAirGap, 5)) +
        s(Time, k = k_safe(train$Time, 5)) +
        s(CowCenterFeature, k = k_safe(train$CowCenterFeature, 4)) +
        TimeSin + TimeCos + ThermalLoad + HotFlag + NightFlag +
        CowAirMean + CowAirSD + ThermalRegime + Source + CowKey,
      data = train,
      weights = train$SourceWeight,
      method = "REML"
    )
    pred <- as.numeric(predict(fit, newdata = test))
    if (length(pred) != nrow(test)) rep(fallback, nrow(test)) else ifelse(is.finite(pred), pred, fallback)
  }, error = function(e) rep(fallback, nrow(test)))
}

fit_predict_gbm <- function(train, test) {
  fallback <- mean(train$Rectal)
  tryCatch({
    fit <- gbm(
      Rectal ~ Ear + Air + Time + TimeSin + TimeCos + ThermalLoad + EarAirGap +
        HotFlag + NightFlag + EarLag1 + EarLag2 + AirLag1 + EarDelta1 + AirDelta1 +
        CowCenterFeature + TrainCowGapBias + CowAirMean + CowAirSD + ThermalRegime +
        Source + CowKey,
      data = train,
      weights = train$SourceWeight,
      distribution = "gaussian",
      n.trees = 360,
      interaction.depth = 3,
      shrinkage = 0.035,
      n.minobsinnode = 5,
      bag.fraction = 0.85,
      verbose = FALSE
    )
    pred <- as.numeric(predict(fit, newdata = test, n.trees = 360))
    if (length(pred) != nrow(test)) rep(fallback, nrow(test)) else ifelse(is.finite(pred), pred, fallback)
  }, error = function(e) rep(fallback, nrow(test)))
}

fit_predict_svm <- function(train, test) {
  fallback <- mean(train$Rectal)
  tryCatch({
    formula <- ~ Ear + Air + Time + TimeSin + TimeCos + ThermalLoad + EarAirGap +
      HotFlag + NightFlag + CowCenterFeature + TrainCowGapBias +
      CowAirMean + CowAirSD + ThermalRegime + Source + CowKey
    mats <- align_matrices(train, test, formula)
    fit <- svm(
      x = mats$x_train,
      y = train$Rectal,
      type = "eps-regression",
      kernel = "radial",
      cost = 8,
      gamma = 0.03,
      epsilon = 0.06,
      scale = TRUE
    )
    pred <- as.numeric(predict(fit, mats$x_test))
    if (length(pred) != nrow(test)) rep(fallback, nrow(test)) else ifelse(is.finite(pred), pred, fallback)
  }, error = function(e) rep(fallback, nrow(test)))
}

fit_predict_xgb <- function(train, test) {
  fallback <- mean(train$Rectal)
  tryCatch({
    formula <- ~ Ear + Air + I(Ear^2) + I(Air^2) + Time + TimeSin + TimeCos +
      ThermalLoad + EarAirGap + I(EarAirGap^2) + HotFlag + NightFlag +
      EarLag1 + EarLag2 + AirLag1 + EarDelta1 + AirDelta1 +
      CowCenterFeature + TrainCowGapBias + CowAirMean + CowAirSD + ThermalRegime +
      Source + CowKey
    mats <- align_matrices(train, test, formula)
    dtrain <- xgb.DMatrix(data = mats$x_train, label = train$Rectal, weight = train$SourceWeight)
    dtest <- xgb.DMatrix(data = mats$x_test)
    fit <- xgb.train(
      params = list(
        objective = "reg:squarederror",
        eta = 0.035,
        max_depth = 2,
        min_child_weight = 4,
        subsample = 0.85,
        colsample_bytree = 0.85,
        lambda = 3.0,
        alpha = 0.15,
        verbosity = 0
      ),
      data = dtrain,
      nrounds = 180,
      verbose = 0
    )
    pred <- as.numeric(predict(fit, dtest))
    if (length(pred) != nrow(test)) rep(fallback, nrow(test)) else ifelse(is.finite(pred), pred, fallback)
  }, error = function(e) rep(fallback, nrow(test)))
}

sanitize_pred <- function(pred, n, fallback, lower = -Inf, upper = Inf) {
  pred <- as.numeric(pred)
  if (length(pred) != n) return(rep(fallback, n))
  pred <- ifelse(is.finite(pred), pred, fallback)
  pmin(pmax(pred, lower), upper)
}

make_base_predictions <- function(train, test) {
  direct_formula <- ~ Ear + I(Ear^2) + Air + I(Air^2) + Time + TimeSin + TimeCos +
    ThermalLoad + EarAirGap + I(EarAirGap^2) + HotFlag + NightFlag +
    EarLag1 + EarLag2 + AirLag1 + EarDelta1 + AirDelta1 +
    CowCenterFeature + TrainCowGapBias + CowAirMean + CowAirSD + ThermalRegime +
    Source + CowKey
  train$pred_ridge <- weighted_ridge_predict(train, train, direct_formula, lambda = 3.0, weights = train$SourceWeight)
  test$pred_ridge <- weighted_ridge_predict(train, test, direct_formula, lambda = 3.0, weights = train$SourceWeight)
  train$pred_gam <- fit_predict_gam(train, train)
  test$pred_gam <- fit_predict_gam(train, test)
  train$pred_gbm <- fit_predict_gbm(train, train)
  test$pred_gbm <- fit_predict_gbm(train, test)
  train$pred_svm <- fit_predict_svm(train, train)
  test$pred_svm <- fit_predict_svm(train, test)
  train$pred_xgb <- fit_predict_xgb(train, train)
  test$pred_xgb <- fit_predict_xgb(train, test)
  list(train = train, test = test)
}

fit_meta_fusion <- function(train, test) {
  meta_formula <- ~ pred_ridge + pred_gam + pred_gbm + pred_svm + pred_xgb +
    CowCenterFeature + TrainCowGapBias + Ear + Air + Time + TimeSin + TimeCos +
    ThermalLoad + EarAirGap + HotFlag + NightFlag +
    CowAirMean + CowAirSD + ThermalRegime + Source + CowKey
  meta_pred <- weighted_ridge_predict(train, test, meta_formula, lambda = 8.0, weights = train$SourceWeight)
  train_meta <- weighted_ridge_predict(train, train, meta_formula, lambda = 8.0, weights = train$SourceWeight)

  # Final shrinkage is selected on training data only.
  candidates <- expand.grid(alpha = seq(0.45, 1.08, by = 0.03), beta = seq(0.00, 0.30, by = 0.05))
  best_obj <- Inf
  best <- list(alpha = 1, beta = 0, train_rmse = NA_real_, train_r2 = NA_real_)
  for (i in seq_len(nrow(candidates))) {
    alpha <- candidates$alpha[i]
    beta <- candidates$beta[i]
    train_candidate <- train$CowCenterFeature + alpha * (train_meta - train$CowCenterFeature) +
      beta * (train$TrainCowGapBias - median(train$TrainCowGapBias))
    obj <- rmse(train$Rectal, train_candidate) + 0.02 * mean(abs(diff(sort(train_candidate))))
    if (is.finite(obj) && obj < best_obj) {
      best_obj <- obj
      best <- list(alpha = alpha, beta = beta, train_rmse = rmse(train$Rectal, train_candidate), train_r2 = r2_score(train$Rectal, train_candidate))
    }
  }
  pred <- test$CowCenterFeature + best$alpha * (meta_pred - test$CowCenterFeature) +
    best$beta * (test$TrainCowGapBias - median(train$TrainCowGapBias))
  list(pred = as.numeric(pred), alpha = best$alpha, beta = best$beta, train_rmse = best$train_rmse, train_r2 = best$train_r2)
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

make_group_cow_folds <- function(df, k = 5, seed = FOLD_SEED) {
  set.seed(seed)
  cows <- sample(unique(as.character(df$CowKey)))
  cow_fold <- setNames(rep(seq_len(k), length.out = length(cows)), cows)
  unname(cow_fold[as.character(df$CowKey)])
}

run_cv <- function(df, dataset_name, fold_mode, seed = FOLD_SEED) {
  if (fold_mode == "within_cow_random5") {
    fold <- make_within_cow_folds(df, seed = seed)
  } else if (fold_mode == "cow_group5") {
    fold <- make_group_cow_folds(df, seed = seed)
  } else {
    stop("Unknown fold mode: ", fold_mode)
  }
  run_folds(df, dataset_name, fold_mode, fold)
}

run_holdout <- function(train_df, test_df, dataset_name, holdout_name) {
  fold <- rep(1L, nrow(test_df))
  train_test <- run_one_fold(train_df, test_df, dataset_name, holdout_name, 1L)
  train_test
}

run_one_fold <- function(train_raw, test_raw, dataset_name, fold_mode, fold_id) {
  fold_features <- attach_train_target_features(train_raw, test_raw)
  pred_data <- make_base_predictions(fold_features$train, fold_features$test)
  train <- pred_data$train
  test <- pred_data$test
  fusion <- fit_meta_fusion(train, test)
  response_lower <- min(train$Rectal)
  response_upper <- max(train$Rectal)
  fusion_guard_n <- sum(
    !is.finite(fusion$pred) |
      fusion$pred < response_lower |
      fusion$pred > response_upper
  )
  if (fusion_guard_n > 0) {
    message(
      "bounded meta-fusion predictions in fold ", fold_id,
      ": ", fusion_guard_n, "/", nrow(test),
      " to outer-training response range [",
      response_lower, ", ", response_upper, "]"
    )
  }

  model_map <- list(
    RidgeTargetCalibrated = sanitize_pred(test$pred_ridge, nrow(test), mean(train$Rectal)),
    GAM = sanitize_pred(test$pred_gam, nrow(test), mean(train$Rectal)),
    GBM = sanitize_pred(test$pred_gbm, nrow(test), mean(train$Rectal)),
    SVM = sanitize_pred(test$pred_svm, nrow(test), mean(train$Rectal)),
    XGB = sanitize_pred(test$pred_xgb, nrow(test), mean(train$Rectal)),
    MetaFusionCalibrated = sanitize_pred(
      fusion$pred, nrow(test), mean(train$Rectal),
      lower = response_lower, upper = response_upper
    )
  )
  pred_rows <- bind_rows(lapply(names(model_map), function(model_name) {
    data.frame(
      Dataset = dataset_name,
      FoldMode = fold_mode,
      FoldID = fold_id,
      Model = model_name,
      RowID = test$RowID,
      CowKey = as.character(test$CowKey),
      Source = as.character(test$Source),
      SourceType = as.character(test$SourceType),
      EarStatus = as.character(test$EarStatus),
      Ear = test$Ear,
      Air = test$Air,
      Time = test$Time,
      Actual = test$Rectal,
      Predicted = as.numeric(model_map[[model_name]]),
      Residual = test$Rectal - as.numeric(model_map[[model_name]]),
      TrainCowN = test$TrainCowN,
      stringsAsFactors = FALSE
    )
  }))
  attr(pred_rows, "fusion_alpha") <- fusion$alpha
  attr(pred_rows, "fusion_beta") <- fusion$beta
  attr(pred_rows, "fusion_train_rmse") <- fusion$train_rmse
  attr(pred_rows, "fusion_train_r2") <- fusion$train_r2
  pred_rows
}

run_folds <- function(df, dataset_name, fold_mode, fold) {
  rows <- list()
  for (k in sort(unique(fold))) {
    message("Running ", dataset_name, " / ", fold_mode, " / fold ", k)
    train <- df[fold != k, , drop = FALSE]
    test <- df[fold == k, , drop = FALSE]
    rows[[length(rows) + 1]] <- run_one_fold(train, test, dataset_name, fold_mode, k)
  }
  bind_rows(rows)
}

summarise_predictions <- function(preds) {
  preds %>%
    group_by(Dataset, FoldMode, Model) %>%
    summarise(
      N = n(),
      CowCount = n_distinct(CowKey),
      R2 = r2_score(Actual, Predicted),
      RMSE = rmse(Actual, Predicted),
      MAE = mae(Actual, Predicted),
      Bias = mean(Residual, na.rm = TRUE),
      ErrorSD = safe_sd(Residual),
      .groups = "drop"
    ) %>%
    arrange(Dataset, FoldMode, RMSE)
}

summarise_fold_predictions <- function(preds) {
  preds %>%
    group_by(Dataset, FoldMode, FoldID, Model) %>%
    summarise(
      N = n(),
      CowCount = n_distinct(CowKey),
      R2 = r2_score(Actual, Predicted),
      RMSE = rmse(Actual, Predicted),
      MAE = mae(Actual, Predicted),
      Bias = mean(Residual, na.rm = TRUE),
      ErrorSD = safe_sd(Residual),
      .groups = "drop"
    ) %>%
    arrange(Dataset, FoldMode, FoldID, RMSE)
}

select_analysis_dataset <- function(all_df) {
  if (ANALYSIS_SCOPE != "all_unique") {
    stop("Unknown TH_SHRC_ANALYSIS_SCOPE: ", ANALYSIS_SCOPE)
  }
  clean_ge8 <- function(x) {
    x %>%
      filter(Ear > 25) %>%
      group_by(CowKey) %>%
      filter(n() >= MIN_RECORDS) %>%
      ungroup() %>%
      droplevels()
  }
  clean_ge8(all_df %>% filter(Source %in% c("S03", "S04", "S02", "S01")))
}

main <- function() {
  df <- load_all_sources() %>% add_observable_features()
  selected <- select_analysis_dataset(df)
  fold <- make_within_cow_folds(selected, k = 5, seed = FOLD_SEED)
  stopifnot(nrow(selected) > 0L, dplyr::n_distinct(selected$CowKey) > 0L)
  cat(
    "TH-SHRC input PASS: rows=", nrow(selected),
    ", cows=", dplyr::n_distinct(selected$CowKey),
    ", folds=", paste(sort(unique(fold)), collapse = ","), "\n",
    sep = ""
  )
}

main()
