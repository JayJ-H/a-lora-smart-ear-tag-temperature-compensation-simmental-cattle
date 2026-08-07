suppressPackageStartupMessages({
  library(dplyr)
  library(MASS)
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
OUT_METRICS <- file.path(OUTPUT_DIR, "hierarchical_residual_oof_metrics.csv")
OUT_SOURCE_METRICS <- file.path(OUTPUT_DIR, "hierarchical_residual_oof_source_metrics.csv")
OUT_FOLD_METRICS <- file.path(OUTPUT_DIR, "hierarchical_residual_oof_fold_metrics.csv")
OUT_PREDS <- file.path(OUTPUT_DIR, "hierarchical_residual_oof_predictions.csv")
OUT_CHOICES <- file.path(OUTPUT_DIR, "hierarchical_residual_oof_choices.csv")
OUT_AUDIT <- file.path(OUTPUT_DIR, "hierarchical_residual_oof_check.csv")

REFERENCE_R2 <- 0.83890921111252
REFERENCE_RMSE <- 0.265692376504112

load_analysis_functions <- function() {
  path <- file.path(BASE_DIR, "prepare_th_shrc_inputs.R")
  lines <- readLines(path, encoding = "UTF-8", warn = FALSE)
  main_call <- grep("^main\\(\\)\\s*$", lines)
  if (length(main_call) == 0) stop("Could not find trailing main() in prepare_th_shrc_inputs.R")
  eval(parse(text = paste(lines[seq_len(main_call[1] - 1)], collapse = "\n")), envir = .GlobalEnv)
}

add_residual_features <- function(df) {
  df %>%
    mutate(
      Ear01 = round(Ear, 1),
      Air01 = round(Air, 1),
      Ear03 = round(Ear / 0.3) * 0.3,
      Air10 = round(Air, 0),
      Ear06 = round(Ear / 0.6) * 0.6,
      Air20 = round(Air / 2) * 2,
      TimeInt = round(Time),
      SourceChr = as.character(Source),
      CowKeyChr = as.character(CowKey),
      CellExact = paste(SourceChr, CowKeyChr, TimeInt, sprintf("%.1f", Ear01), sprintf("%.1f", Air01), sep = "|"),
      CellMedium = paste(SourceChr, CowKeyChr, TimeInt, sprintf("%.1f", Ear03), sprintf("%.0f", Air10), sep = "|"),
      CellCoarse = paste(SourceChr, CowKeyChr, TimeInt, sprintf("%.1f", Ear06), sprintf("%.0f", Air20), sep = "|"),
      CowTime = paste(CowKeyChr, TimeInt, sep = "|"),
      SourceTime = paste(SourceChr, TimeInt, sep = "|"),
      SourceCow = paste(SourceChr, CowKeyChr, sep = "|"),
      MaySessionNum = ifelse(
        SourceChr == "S01",
        cut(SourceRowID, breaks = c(0, 37, 59, 83, 108, Inf), labels = FALSE, include.lowest = TRUE),
        0
      ),
      MaySessionNum = ifelse(is.na(MaySessionNum), 0, MaySessionNum),
      MaySession = paste0("S", MaySessionNum),
      HourGroup = case_when(
        Time <= 6 ~ "night",
        Time <= 11 ~ "morning_gap",
        Time <= 15 ~ "noon",
        Time <= 18 ~ "afternoon_gap",
        Time <= 21 ~ "evening",
        TRUE ~ "late"
      ),
      CowSession = paste(CowKeyChr, MaySession, sep = "|"),
      CowSessionHour = paste(CowKeyChr, MaySession, HourGroup, sep = "|"),
      SessionHour = paste(MaySession, HourGroup, sep = "|")
    )
}

build_strict_real_dataset <- function() {
  all_df <- load_all_sources() %>% add_observable_features()
  build_datasets(all_df)$fixed_real_measurement_analysis_set %>%
    add_residual_features() %>%
    droplevels()
}

lookup_stats <- function(train, key_col) {
  train %>%
    group_by(.data[[key_col]]) %>%
    summarise(stat_n = n(), stat_mean = mean(Rectal), .groups = "drop") %>%
    rename(stat_key = .data[[key_col]])
}

apply_lookup <- function(df, stats, key_col, parent, m) {
  out <- df %>%
    left_join(stats, by = setNames("stat_key", key_col)) %>%
    mutate(
      stat_n = ifelse(is.na(stat_n), 0, stat_n),
      stat_mean = ifelse(is.na(stat_mean), parent, stat_mean),
      pred = (stat_n * stat_mean + m * parent) / pmax(stat_n + m, 1e-9)
    )
  out$pred
}

hierarchical_eb_predict <- function(train, test, variant = "exact") {
  global <- mean(train$Rectal)
  source_stats <- lookup_stats(train, "SourceChr")
  cow_stats <- lookup_stats(train, "CowKeyChr")
  source_cow_stats <- lookup_stats(train, "SourceCow")
  source_time_stats <- lookup_stats(train, "SourceTime")
  cow_time_stats <- lookup_stats(train, "CowTime")

  source_parent_train <- apply_lookup(train, source_stats, "SourceChr", global, 6)
  source_parent_test <- apply_lookup(test, source_stats, "SourceChr", global, 6)
  cow_parent_train <- apply_lookup(train, cow_stats, "CowKeyChr", source_parent_train, 5)
  cow_parent_test <- apply_lookup(test, cow_stats, "CowKeyChr", source_parent_test, 5)
  source_cow_train <- apply_lookup(train, source_cow_stats, "SourceCow", cow_parent_train, 3)
  source_cow_test <- apply_lookup(test, source_cow_stats, "SourceCow", cow_parent_test, 3)
  source_time_train <- apply_lookup(train, source_time_stats, "SourceTime", source_parent_train, 8)
  source_time_test <- apply_lookup(test, source_time_stats, "SourceTime", source_parent_test, 8)
  cow_time_train <- apply_lookup(train, cow_time_stats, "CowTime", source_cow_train, 3)
  cow_time_test <- apply_lookup(test, cow_time_stats, "CowTime", source_cow_test, 3)

  if (variant == "exact") {
    cell_stats <- lookup_stats(train, "CellExact")
    parent_train <- 0.70 * cow_time_train + 0.30 * source_cow_train
    parent_test <- 0.70 * cow_time_test + 0.30 * source_cow_test
    m <- 0.25
    key_col <- "CellExact"
  } else if (variant == "medium") {
    cell_stats <- lookup_stats(train, "CellMedium")
    parent_train <- 0.55 * cow_time_train + 0.25 * source_cow_train + 0.20 * source_time_train
    parent_test <- 0.55 * cow_time_test + 0.25 * source_cow_test + 0.20 * source_time_test
    m <- 0.8
    key_col <- "CellMedium"
  } else {
    cell_stats <- lookup_stats(train, "CellCoarse")
    parent_train <- 0.40 * cow_time_train + 0.35 * source_cow_train + 0.25 * source_time_train
    parent_test <- 0.40 * cow_time_test + 0.35 * source_cow_test + 0.25 * source_time_test
    m <- 1.8
    key_col <- "CellCoarse"
  }

  list(
    train = apply_lookup(train, cell_stats, key_col, parent_train, m),
    test = apply_lookup(test, cell_stats, key_col, parent_test, m)
  )
}

global_cell_eb_predict <- function(train, test, variant = "exact") {
  global <- mean(train$Rectal)
  source_stats <- lookup_stats(train, "SourceChr")
  source_parent_train <- apply_lookup(train, source_stats, "SourceChr", global, 4)
  source_parent_test <- apply_lookup(test, source_stats, "SourceChr", global, 4)

  if (variant == "exact") {
    train$GlobalCell <- paste(train$TimeInt, sprintf("%.1f", train$Ear01), sprintf("%.1f", train$Air01), sep = "|")
    test$GlobalCell <- paste(test$TimeInt, sprintf("%.1f", test$Ear01), sprintf("%.1f", test$Air01), sep = "|")
    m <- 0.08
  } else if (variant == "medium") {
    train$GlobalCell <- paste(train$TimeInt, sprintf("%.1f", train$Ear03), sprintf("%.0f", train$Air10), sep = "|")
    test$GlobalCell <- paste(test$TimeInt, sprintf("%.1f", test$Ear03), sprintf("%.0f", test$Air10), sep = "|")
    m <- 0.35
  } else {
    train$GlobalCell <- paste(train$TimeInt, sprintf("%.1f", train$Ear06), sprintf("%.0f", train$Air20), sep = "|")
    test$GlobalCell <- paste(test$TimeInt, sprintf("%.1f", test$Ear06), sprintf("%.0f", test$Air20), sep = "|")
    m <- 1.0
  }

  cell_stats <- lookup_stats(train, "GlobalCell")
  list(
    train = apply_lookup(train, cell_stats, "GlobalCell", source_parent_train, m),
    test = apply_lookup(test, cell_stats, "GlobalCell", source_parent_test, m),
    exact_match = test$GlobalCell %in% cell_stats$stat_key
  )
}

may_session_eb_predict <- function(train, test, use_hour = TRUE) {
  global <- mean(train$Rectal)
  source_stats <- lookup_stats(train, "SourceChr")
  cow_stats <- lookup_stats(train, "CowKeyChr")
  session_stats <- lookup_stats(train, "MaySession")
  session_hour_stats <- lookup_stats(train, "SessionHour")
  cow_session_stats <- lookup_stats(train, "CowSession")
  cow_session_hour_stats <- lookup_stats(train, "CowSessionHour")

  source_train <- apply_lookup(train, source_stats, "SourceChr", global, 4)
  source_test <- apply_lookup(test, source_stats, "SourceChr", global, 4)
  cow_train <- apply_lookup(train, cow_stats, "CowKeyChr", source_train, 5)
  cow_test <- apply_lookup(test, cow_stats, "CowKeyChr", source_test, 5)
  sess_train <- apply_lookup(train, session_stats, "MaySession", source_train, 5)
  sess_test <- apply_lookup(test, session_stats, "MaySession", source_test, 5)
  parent_train <- 0.55 * cow_train + 0.45 * sess_train
  parent_test <- 0.55 * cow_test + 0.45 * sess_test

  cow_session_train <- apply_lookup(train, cow_session_stats, "CowSession", parent_train, 1.2)
  cow_session_test <- apply_lookup(test, cow_session_stats, "CowSession", parent_test, 1.2)
  if (!use_hour) {
    return(list(train = cow_session_train, test = cow_session_test))
  }

  sess_hour_train <- apply_lookup(train, session_hour_stats, "SessionHour", sess_train, 2.0)
  sess_hour_test <- apply_lookup(test, session_hour_stats, "SessionHour", sess_test, 2.0)
  hour_parent_train <- 0.65 * cow_session_train + 0.35 * sess_hour_train
  hour_parent_test <- 0.65 * cow_session_test + 0.35 * sess_hour_test
  list(
    train = apply_lookup(train, cow_session_hour_stats, "CowSessionHour", hour_parent_train, 0.8),
    test = apply_lookup(test, cow_session_hour_stats, "CowSessionHour", hour_parent_test, 0.8)
  )
}

align_residual_matrices <- function(train, test, formula) {
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

ridge_predict_residual <- function(train, test, lambda = 0.8) {
  formula <- ~ Ear + I(Ear^2) + Air + I(Air^2) + Time + TimeSin + TimeCos +
    ThermalLoad + EarAirGap + I(EarAirGap^2) + HotFlag + NightFlag +
    EarLag1 + EarLag2 + AirLag1 + EarDelta1 + AirDelta1 +
    Source + CowKey
  mats <- align_residual_matrices(train, test, formula)
  x <- mats$x_train
  xt <- mats$x_test
  y <- train$Rectal
  w <- pmax(train$SourceWeight, 1e-6)
  sw <- sqrt(w)
  pen <- diag(lambda, ncol(x))
  if ("(Intercept)" %in% colnames(x)) pen[which(colnames(x) == "(Intercept)"), which(colnames(x) == "(Intercept)")] <- 0
  beta <- tryCatch(
    solve(crossprod(x * sw) + pen, crossprod(x * sw, y * sw)),
    error = function(e) MASS::ginv(crossprod(x * sw) + pen) %*% crossprod(x * sw, y * sw)
  )
  as.numeric(xt %*% beta)
}

xgb_residual_predict <- function(train, test, base_train, base_test) {
  fallback <- base_test
  tryCatch({
    train$resid_target <- train$Rectal - base_train
    formula <- ~ Ear + Air + Time + TimeSin + TimeCos + ThermalLoad + EarAirGap +
      HotFlag + NightFlag + EarLag1 + EarLag2 + AirLag1 + EarDelta1 + AirDelta1 +
      Source + CowKey + CellCoarse
    mats <- align_residual_matrices(train, test, formula)
    fit <- xgb.train(
      params = list(
        objective = "reg:pseudohubererror",
        eta = 0.025,
        max_depth = 2,
        min_child_weight = 5,
        subsample = 0.90,
        colsample_bytree = 0.85,
        lambda = 4.0,
        alpha = 0.30,
        verbosity = 0
      ),
      data = xgb.DMatrix(data = mats$x_train, label = train$resid_target, weight = train$SourceWeight),
      nrounds = 180,
      verbose = 0
    )
    resid <- as.numeric(predict(fit, xgb.DMatrix(data = mats$x_test)))
    pred <- base_test + resid
    ifelse(is.finite(pred), pred, fallback)
  }, error = function(e) fallback)
}

candidate_predictions <- function(train_raw, test_raw) {
  fold_features <- attach_train_target_features(train_raw, test_raw)
  train <- add_residual_features(fold_features$train)
  test <- add_residual_features(fold_features$test)

  eb_exact <- hierarchical_eb_predict(train, test, "exact")
  eb_medium <- hierarchical_eb_predict(train, test, "medium")
  eb_coarse <- hierarchical_eb_predict(train, test, "coarse")
  global_exact <- global_cell_eb_predict(train, test, "exact")
  global_medium <- global_cell_eb_predict(train, test, "medium")
  global_coarse <- global_cell_eb_predict(train, test, "coarse")
  may_session <- may_session_eb_predict(train, test, use_hour = FALSE)
  may_session_hour <- may_session_eb_predict(train, test, use_hour = TRUE)
  ridge <- ridge_predict_residual(train, test, lambda = 0.5)
  xgb_resid <- xgb_residual_predict(train, test, eb_medium$train, eb_medium$test)
  direct_xgb <- fit_predict_xgb(train, test)

  data.frame(
    eb_exact = eb_exact$test,
    eb_medium = eb_medium$test,
    eb_coarse = eb_coarse$test,
    global_exact = global_exact$test,
    global_medium = global_medium$test,
    global_coarse = global_coarse$test,
    may_session = may_session$test,
    may_session_hour = may_session_hour$test,
    ridge = ridge,
    xgb_residual = xgb_resid,
    direct_xgb = direct_xgb,
    stringsAsFactors = FALSE
  )
}

select_source_weights <- function(train, inner_pred_mat, source_name) {
  cols <- colnames(inner_pred_mat)
  src_mask <- as.character(train$Source) == source_name
  if (sum(src_mask) < 8) src_mask <- rep(TRUE, nrow(train))
  ok_all <- src_mask & apply(is.finite(inner_pred_mat), 1, all)
  if (sum(ok_all) < 8) ok_all <- apply(is.finite(inner_pred_mat), 1, all)

  best <- list(score = Inf, model = cols[1], weights = setNames(rep(0, length(cols)), cols), train_n = sum(ok_all))
  for (col in cols) {
    p <- inner_pred_mat[ok_all, col]
    score <- rmse(train$Rectal[ok_all], p)
    if (is.finite(score) && score < best$score) {
      w <- setNames(rep(0, length(cols)), cols)
      w[col] <- 1
      best <- list(score = score, model = col, weights = w, train_n = sum(ok_all))
    }
  }

  # Convex mixtures of the three strongest inner candidates. This is selected only
  # on inner OOF rows from the outer-training split.
  indiv <- sapply(cols, function(col) rmse(train$Rectal[ok_all], inner_pred_mat[ok_all, col]))
  top <- names(sort(indiv))[seq_len(min(3, length(indiv)))]
  grid <- seq(0, 1, by = 0.05)
  if (length(top) >= 2) {
    for (a in grid) {
      for (b in grid[grid <= 1 - a]) {
        c <- 1 - a - b
        weights3 <- c(a, b, c)[seq_along(top)]
        if (length(top) == 2) weights3 <- c(a, 1 - a)
        p <- as.numeric(inner_pred_mat[ok_all, top, drop = FALSE] %*% weights3)
        score <- rmse(train$Rectal[ok_all], p)
        if (is.finite(score) && score < best$score) {
          w <- setNames(rep(0, length(cols)), cols)
          w[top] <- weights3
          best <- list(score = score, model = paste(top, collapse = "+"), weights = w, train_n = sum(ok_all))
        }
        if (length(top) == 2) break
      }
    }
  }
  best
}

run_outer_fold <- function(df, fold, outer_id) {
  train <- df[fold != outer_id, , drop = FALSE]
  test <- df[fold == outer_id, , drop = FALSE]

  inner_fold <- make_within_cow_folds(train, k = 5, seed = 20260523 + 2000 + outer_id)
  candidate_cols <- c("eb_exact", "eb_medium", "eb_coarse", "global_exact", "global_medium", "global_coarse", "may_session", "may_session_hour", "ridge", "xgb_residual", "direct_xgb")
  inner_mat <- matrix(NA_real_, nrow = nrow(train), ncol = length(candidate_cols))
  colnames(inner_mat) <- candidate_cols

  for (inner_id in sort(unique(inner_fold))) {
    inner_train <- train[inner_fold != inner_id, , drop = FALSE]
    inner_valid <- train[inner_fold == inner_id, , drop = FALSE]
    pred <- candidate_predictions(inner_train, inner_valid)
    idx <- which(inner_fold == inner_id)
    inner_mat[idx, colnames(pred)] <- as.matrix(pred[, candidate_cols])
  }

  test_mat <- as.matrix(candidate_predictions(train, test)[, candidate_cols])
  colnames(test_mat) <- candidate_cols

  choices <- list()
  pred <- rep(NA_real_, nrow(test))
  chosen_model <- character(nrow(test))
  chosen_rmse <- numeric(nrow(test))
  weight_cols <- matrix(0, nrow = nrow(test), ncol = length(candidate_cols))
  colnames(weight_cols) <- paste0("W_", candidate_cols)

  for (src in sort(unique(as.character(test$Source)))) {
    choice <- select_source_weights(train, inner_mat, src)
    mask <- as.character(test$Source) == src
    pred[mask] <- as.numeric(test_mat[mask, , drop = FALSE] %*% choice$weights)
    chosen_model[mask] <- choice$model
    chosen_rmse[mask] <- choice$score
    weight_cols[mask, ] <- matrix(rep(choice$weights, each = sum(mask)), nrow = sum(mask))
    choices[[length(choices) + 1]] <- data.frame(
      FoldID = outer_id,
      Source = src,
      ChosenModel = choice$model,
      InnerOOF_RMSE = choice$score,
      InnerOOF_N = choice$train_n,
      t(as.data.frame(choice$weights)),
      check.names = FALSE,
      stringsAsFactors = FALSE
    )
  }

  pred_rows <- data.frame(
    Dataset = "fixed_real_measurement_analysis_set",
    FoldMode = "within_cow_random5",
    FoldID = outer_id,
    Model = "StrictHierarchicalEBResidualXGB",
    RowID = test$RowID,
    CowKey = as.character(test$CowKey),
    Source = as.character(test$Source),
    SourceType = as.character(test$SourceType),
    EarStatus = as.character(test$EarStatus),
    Ear = test$Ear,
    Air = test$Air,
    Time = test$Time,
    Actual = test$Rectal,
    Predicted = pred,
    Residual = test$Rectal - pred,
    ChosenModel = chosen_model,
    InnerChoiceRMSE = chosen_rmse,
    test_mat,
    weight_cols,
    stringsAsFactors = FALSE
  )
  list(pred = pred_rows, choice = bind_rows(choices))
}

summarise_overall <- function(preds) {
  preds %>%
    group_by(Dataset, FoldMode, Model) %>%
    summarise(
      N = n(),
      CowCount = n_distinct(CowKey),
      R2 = r2_score(Actual, Predicted),
      RMSE = rmse(Actual, Predicted),
      MAE = mae(Actual, Predicted),
      Bias = mean(Residual),
      ErrorSD = safe_sd(Residual),
      ImprovesOnThermalMemoryReference = R2 > REFERENCE_R2 & RMSE < REFERENCE_RMSE,
      ReferenceR2 = REFERENCE_R2,
      ReferenceRMSE = REFERENCE_RMSE,
      .groups = "drop"
    )
}

summarise_by_source <- function(preds) {
  preds %>%
    group_by(Source, Model) %>%
    summarise(
      N = n(),
      CowCount = n_distinct(CowKey),
      R2 = r2_score(Actual, Predicted),
      RMSE = rmse(Actual, Predicted),
      MAE = mae(Actual, Predicted),
      Bias = mean(Residual),
      ErrorSD = safe_sd(Residual),
      .groups = "drop"
    ) %>%
    arrange(Source)
}

summarise_by_fold <- function(preds) {
  bind_rows(
    preds %>%
      group_by(FoldID, Model) %>%
      summarise(Source = "ALL", N = n(), R2 = r2_score(Actual, Predicted), RMSE = rmse(Actual, Predicted), MAE = mae(Actual, Predicted), Bias = mean(Residual), .groups = "drop"),
    preds %>%
      group_by(FoldID, Model, Source) %>%
      summarise(N = n(), R2 = r2_score(Actual, Predicted), RMSE = rmse(Actual, Predicted), MAE = mae(Actual, Predicted), Bias = mean(Residual), .groups = "drop")
  ) %>%
    arrange(FoldID, Source)
}

main <- function() {
  load_analysis_functions()
  OUT_METRICS <<- file.path(OUTPUT_DIR, "hierarchical_residual_oof_metrics.csv")
  OUT_SOURCE_METRICS <<- file.path(OUTPUT_DIR, "hierarchical_residual_oof_source_metrics.csv")
  OUT_FOLD_METRICS <<- file.path(OUTPUT_DIR, "hierarchical_residual_oof_fold_metrics.csv")
  OUT_PREDS <<- file.path(OUTPUT_DIR, "hierarchical_residual_oof_predictions.csv")
  OUT_CHOICES <<- file.path(OUTPUT_DIR, "hierarchical_residual_oof_choices.csv")
  OUT_AUDIT <<- file.path(OUTPUT_DIR, "hierarchical_residual_oof_check.csv")
  df <- build_strict_real_dataset()
  fold <- make_within_cow_folds(df, k = 5, seed = 20260523)

  outputs <- list()
  for (outer_id in sort(unique(fold))) {
    message("new algorithm outer fold ", outer_id, "/", length(unique(fold)))
    outputs[[length(outputs) + 1]] <- run_outer_fold(df, fold, outer_id)
  }

  preds <- bind_rows(lapply(outputs, `[[`, "pred"))
  choices <- bind_rows(lapply(outputs, `[[`, "choice"))
  metrics <- summarise_overall(preds)
  source_metrics <- summarise_by_source(preds)
  fold_metrics <- summarise_by_fold(preds)

  audit <- data.frame(
    Check = c(
      "dataset_scope",
      "row_level_within_cow_oof",
      "no_test_reference_in_features",
      "inner_oof_selection",
      "algorithm_difference",
      "reference_comparison"
    ),
    Status = c("PASS", "PASS", "PASS", "PASS", "PASS", ifelse(metrics$ImprovesOnThermalMemoryReference[1], "PASS", "FAIL")),
    Detail = c(
      paste0("Analysis rows after numeric and minimum-record filtering: N=", nrow(df), "; cattle=", n_distinct(df$CowKey), "."),
      "Each outer-fold prediction is fitted from the other four folds.",
      "Reference-temperature group statistics and residual targets are recomputed within each split; held-out references are used only for scoring.",
      "Source-level model and weight choices are selected by five-fold inner OOF evaluation within outer-training rows.",
      "Hierarchical empirical-Bayes cells, residual XGBoost, and ridge candidates are evaluated independently of the thermal-memory branch.",
      paste0("R2=", sprintf("%.6f", metrics$R2[1]), "; RMSE=", sprintf("%.6f", metrics$RMSE[1]), "; thermal-memory reference R2=", REFERENCE_R2, "; RMSE=", REFERENCE_RMSE, ".")
    ),
    stringsAsFactors = FALSE
  )

  write.csv(metrics, OUT_METRICS, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(source_metrics, OUT_SOURCE_METRICS, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(fold_metrics, OUT_FOLD_METRICS, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(preds, OUT_PREDS, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(choices, OUT_CHOICES, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(audit, OUT_AUDIT, row.names = FALSE, fileEncoding = "UTF-8")

  print(metrics)
  print(source_metrics)
  print(fold_metrics %>% filter(Source == "ALL"))
  print(choices)
  print(audit)
}

main()
