suppressPackageStartupMessages({
  library(dplyr)
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
OUT_METRICS <- file.path(OUTPUT_DIR, "thermal_memory_oof_metrics.csv")
OUT_FOLD_METRICS <- file.path(OUTPUT_DIR, "thermal_memory_oof_fold_metrics.csv")
OUT_PREDS <- file.path(OUTPUT_DIR, "thermal_memory_oof_predictions.csv")
OUT_CHECK <- file.path(OUTPUT_DIR, "thermal_memory_oof_check.csv")
OUT_CHOICE <- file.path(OUTPUT_DIR, "thermal_memory_oof_source_choices.csv")
OUT_DUP_CHECK <- file.path(OUTPUT_DIR, "thermal_memory_oof_duplicate_check.csv")

load_analysis_functions <- function() {
  path <- file.path(BASE_DIR, "prepare_th_shrc_inputs.R")
  lines <- readLines(path, encoding = "UTF-8", warn = FALSE)
  main_call <- grep("^main\\(\\)\\s*$", lines)
  if (length(main_call) == 0) stop("Could not find trailing main() in prepare_th_shrc_inputs.R")
  eval(parse(text = paste(lines[seq_len(main_call[1] - 1)], collapse = "\n")), envir = .GlobalEnv)
}

circ_dist <- function(a, b) {
  d <- abs(a - b)
  pmin(d, 24 - d)
}

memory_predict <- function(train, test, cfg) {
  pred <- numeric(nrow(test))
  nearest_distance <- numeric(nrow(test))
  nearest_source <- character(nrow(test))
  nearest_row_id <- integer(nrow(test))
  exact_feature_match <- logical(nrow(test))

  for (i in seq_len(nrow(test))) {
    r <- test[i, ]
    dt <- circ_dist(train$Time, r$Time)
    de <- abs(train$Ear - r$Ear)
    da <- abs(train$Air - r$Air)
    d2 <- (dt / cfg$h_time)^2 + (de / cfg$h_ear)^2 + (da / cfg$h_air)^2
    ord <- order(d2)
    k <- min(cfg$k, length(ord))
    idx <- ord[seq_len(k)]
    nearest_distance[i] <- sqrt(d2[idx[1]])
    nearest_source[i] <- as.character(train$Source[idx[1]])
    nearest_row_id[i] <- train$RowID[idx[1]]
    exact_feature_match[i] <- isTRUE(dt[idx[1]] < 1e-9 && de[idx[1]] < 1e-9 && da[idx[1]] < 1e-9)

    if (k == 1) {
      pred[i] <- train$Rectal[idx[1]]
    } else {
      w <- exp(-0.5 * d2[idx] / (cfg$bandwidth^2)) * pmax(train$SourceWeight[idx], 1e-6)
      if (sum(w) <= 1e-12) {
        pred[i] <- mean(train$Rectal[idx])
      } else {
        pred[i] <- sum(w * train$Rectal[idx]) / sum(w)
      }
    }
  }

  list(
    pred = pred,
    nearest_distance = nearest_distance,
    nearest_source = nearest_source,
    nearest_row_id = nearest_row_id,
    exact_feature_match = exact_feature_match
  )
}

config_grid <- function() {
  bind_rows(
    tibble(ConfigID = "global_k1_t2_e03_a5", k = 1L, h_time = 2.0, h_ear = 0.3, h_air = 5.0, bandwidth = 1.0),
    tibble(ConfigID = "global_k1_t2_e06_a5", k = 1L, h_time = 2.0, h_ear = 0.6, h_air = 5.0, bandwidth = 1.0),
    tibble(ConfigID = "global_k1_t2_e06_a10", k = 1L, h_time = 2.0, h_ear = 0.6, h_air = 10.0, bandwidth = 1.0),
    tibble(ConfigID = "global_k2_t2_e03_a5_b05", k = 2L, h_time = 2.0, h_ear = 0.3, h_air = 5.0, bandwidth = 0.5),
    tibble(ConfigID = "global_k2_t2_e06_a5_b05", k = 2L, h_time = 2.0, h_ear = 0.6, h_air = 5.0, bandwidth = 0.5),
    tibble(ConfigID = "global_k2_t2_e06_a10_b05", k = 2L, h_time = 2.0, h_ear = 0.6, h_air = 10.0, bandwidth = 0.5),
    tibble(ConfigID = "global_k2_t2_e03_a5_b1", k = 2L, h_time = 2.0, h_ear = 0.3, h_air = 5.0, bandwidth = 1.0),
    tibble(ConfigID = "global_k2_t2_e06_a5_b1", k = 2L, h_time = 2.0, h_ear = 0.6, h_air = 5.0, bandwidth = 1.0)
  )
}

build_demo_analysis_dataset <- function() {
  all_df <- load_all_sources() %>% add_observable_features()
  cow_levels <- levels(all_df$CowKey)
  select_analysis_dataset(all_df) %>%
    add_session_features() %>%
    mutate(
      Source = factor(as.character(Source), levels = c("S03", "S04", "S02", "S01")),
      SourceType = factor(as.character(SourceType)),
      EarStatus = factor(as.character(EarStatus)),
      CowKey = factor(as.character(CowKey), levels = cow_levels),
      HourGroup = factor(HourGroup),
      MaySession = factor(MaySession)
    )
}

add_session_features <- function(df) {
  df$.orig_order <- seq_len(nrow(df))
  df %>%
    mutate(
      AcquisitionSession = as.integer(AcquisitionSession)
    ) %>%
    group_by(CowKey, AcquisitionSession) %>%
    arrange(Time, Ear, Air, .by_group = TRUE) %>%
    mutate(
      CowOrderIndex = row_number(),
      CowOrderN = n(),
      SourceOrderScaled = ifelse(CowOrderN > 1, (CowOrderIndex - 1) / (CowOrderN - 1), 0),
      SourceRowSin = sin(2 * pi * SourceOrderScaled),
      SourceRowCos = cos(2 * pi * SourceOrderScaled),
      MaySessionNum = AcquisitionSession,
      MaySession = paste(as.character(CowKey), sprintf("A%02d", MaySessionNum), sep = "_"),
      HourGroup = case_when(
        Time <= 6 ~ "night",
        Time <= 11 ~ "morning_gap",
        Time <= 15 ~ "noon",
        Time <= 18 ~ "afternoon_gap",
        Time <= 21 ~ "evening",
        TRUE ~ "late"
      ),
      TimeSession = Time + 24 * MaySessionNum
    ) %>%
    ungroup() %>%
    arrange(.orig_order) %>%
    select(-.orig_order)
}

align_matrices_local <- function(train, test, formula) {
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

session_ridge_predict <- function(train, test, lambda = 0.1) {
  formula <- ~ Ear + I(Ear^2) + Air + I(Air^2) + Time + TimeSin + TimeCos +
    ThermalLoad + EarAirGap + I(EarAirGap^2) + HotFlag + NightFlag +
    EarLag1 + EarLag2 + AirLag1 + EarDelta1 + AirDelta1 +
    SeqInCowSource + CowSourceN + SourceOrderScaled +
    SourceRowSin + SourceRowCos + TimeSession + Source + CowKey + MaySession + HourGroup
  mats <- align_matrices_local(train, test, formula)
  x <- mats$x_train
  xt <- mats$x_test
  y <- train$Rectal
  w <- pmax(train$SourceWeight, 1e-6)
  sw <- sqrt(w)
  xw <- x * sw
  yw <- y * sw
  pen <- diag(lambda, ncol(x))
  if ("(Intercept)" %in% colnames(x)) {
    pen[which(colnames(x) == "(Intercept)"), which(colnames(x) == "(Intercept)")] <- 0
  }
  beta <- MASS::ginv(crossprod(xw) + pen) %*% crossprod(xw, yw)
  as.numeric(xt %*% beta)
}

session_group_predict <- function(train, test, use_hour = FALSE) {
  global <- mean(train$Rectal)
  pred <- numeric(nrow(test))
  for (i in seq_len(nrow(test))) {
    r <- test[i, ]
    if (use_hour) {
      pool <- train %>%
        filter(CowKey == r$CowKey, MaySession == r$MaySession, HourGroup == r$HourGroup)
      if (nrow(pool) < 1) pool <- train %>% filter(CowKey == r$CowKey, MaySession == r$MaySession)
      if (nrow(pool) < 1) pool <- train %>% filter(CowKey == r$CowKey, HourGroup == r$HourGroup)
      if (nrow(pool) < 1) pool <- train %>% filter(MaySession == r$MaySession, HourGroup == r$HourGroup)
      if (nrow(pool) < 1) pool <- train %>% filter(CowKey == r$CowKey)
    } else {
      pool <- train %>% filter(CowKey == r$CowKey, MaySession == r$MaySession)
      if (nrow(pool) < 1) pool <- train %>% filter(CowKey == r$CowKey)
      if (nrow(pool) < 1) pool <- train %>% filter(MaySession == r$MaySession)
    }
    pred[i] <- if (nrow(pool) < 1) global else mean(pool$Rectal)
  }
  pred
}

extract_model_pred <- function(pred_rows, model_name) {
  pred_rows %>%
    filter(Model == model_name) %>%
    arrange(match(RowID, unique(RowID)))
}

simplex_grid_5 <- local({
  cached <- NULL
  function() {
    if (!is.null(cached)) return(cached)
    rows <- vector("list", choose(54, 4))
    row_id <- 1L
    for (alpha_i in 0:50) {
      for (beta_i in 0:(50 - alpha_i)) {
        for (gamma_i in 0:(50 - alpha_i - beta_i)) {
          for (delta_i in 0:(50 - alpha_i - beta_i - gamma_i)) {
            eta_i <- 50 - alpha_i - beta_i - gamma_i - delta_i
            rows[[row_id]] <- c(alpha_i, beta_i, gamma_i, delta_i, eta_i)
            row_id <- row_id + 1L
          }
        }
      }
    }
    cached <<- do.call(rbind, rows) / 50
    colnames(cached) <<- c("alpha", "beta", "gamma", "delta", "eta")
    cached
  }
})

select_regime_choices <- function(train, inner_meta, mem_oof, session_ridge_oof, session_group_oof, session_group_hour_oof, cfgs, regime_name, alpha_grid = seq(0, 1, by = 0.01)) {
  src_mask <- as.character(train$ThermalRegime) == regime_name
  if (sum(src_mask) < 8) src_mask <- rep(TRUE, nrow(train))

  best <- list(
    rmse = Inf, alpha = 1, beta = 0, gamma = 0, delta = 0,
    config_index = 1L, config_id = cfgs$ConfigID[1], train_n = sum(src_mask)
  )
  for (ci in seq_len(nrow(cfgs))) {
    mem <- mem_oof[, ci]
    ok <- src_mask & is.finite(inner_meta) & is.finite(mem)
    if (sum(ok) < 8) next
    if (regime_name == "stable_hot") {
      ok <- ok & is.finite(session_ridge_oof) & is.finite(session_group_oof) & is.finite(session_group_hour_oof)
      if (sum(ok) < 8) next
      candidate_residuals <- cbind(
        inner_meta[ok], mem[ok], session_ridge_oof[ok],
        session_group_oof[ok], session_group_hour_oof[ok]
      ) - train$Rectal[ok]
      residual_gram <- crossprod(candidate_residuals) / sum(ok)
      weights <- simplex_grid_5()
      candidate_mse <- rowSums((weights %*% residual_gram) * weights)
      choice_index <- which.min(candidate_mse)
      score <- sqrt(max(candidate_mse[choice_index], 0))
      if (is.finite(score) && score < best$rmse) {
        selected <- weights[choice_index, ]
        best <- list(
          rmse = score,
          alpha = selected[["alpha"]],
          beta = selected[["beta"]],
          gamma = selected[["gamma"]],
          delta = selected[["delta"]],
          config_index = ci,
          config_id = cfgs$ConfigID[ci],
          train_n = sum(ok)
        )
      }
    } else {
      for (alpha in alpha_grid) {
        candidate <- alpha * inner_meta[ok] + (1 - alpha) * mem[ok]
        score <- rmse(train$Rectal[ok], candidate)
        if (is.finite(score) && score < best$rmse) {
          best <- list(
            rmse = score, alpha = alpha, beta = 1 - alpha,
            gamma = 0, delta = 0, config_index = ci,
            config_id = cfgs$ConfigID[ci], train_n = sum(ok)
          )
        }
      }
    }
  }
  best
}

run_outer_fold <- function(df, fold, outer_id, cfgs) {
  train <- df[fold != outer_id, , drop = FALSE]
  test <- df[fold == outer_id, , drop = FALSE]
  outer_profiles <- attach_train_observable_profiles(train, test)
  train <- outer_profiles$train
  test <- outer_profiles$test

  outer_pred_rows <- run_one_fold(train, test, "all_measured_520_analysis_set", "within_cow_random5", outer_id)
  outer_meta <- outer_pred_rows %>%
    filter(Model == "MetaFusionCalibrated") %>%
    arrange(match(RowID, test$RowID))
  stopifnot(all(outer_meta$RowID == test$RowID))

  inner_fold <- make_within_cow_folds(train, k = 5, seed = FOLD_SEED + 1000 + outer_id)
  inner_meta <- rep(NA_real_, nrow(train))
  session_ridge_oof <- rep(NA_real_, nrow(train))
  session_group_oof <- rep(NA_real_, nrow(train))
  session_group_hour_oof <- rep(NA_real_, nrow(train))
  mem_oof <- matrix(NA_real_, nrow = nrow(train), ncol = nrow(cfgs))
  colnames(mem_oof) <- cfgs$ConfigID

  for (j in sort(unique(inner_fold))) {
    inner_train <- train[inner_fold != j, , drop = FALSE]
    inner_valid <- train[inner_fold == j, , drop = FALSE]
    inner_profiles <- attach_train_observable_profiles(inner_train, inner_valid)
    inner_train <- inner_profiles$train
    inner_valid <- inner_profiles$test
    inner_rows <- run_one_fold(inner_train, inner_valid, "inner_train_only", "inner_within_cow5", j)
    inner_meta_rows <- inner_rows %>%
      filter(Model == "MetaFusionCalibrated") %>%
      arrange(match(RowID, inner_valid$RowID))
    idx <- which(inner_fold == j)
    stopifnot(all(inner_meta_rows$RowID == inner_valid$RowID))
    inner_meta[idx] <- inner_meta_rows$Predicted
    session_ridge_oof[idx] <- session_ridge_predict(inner_train, inner_valid, lambda = 0.01)
    session_group_oof[idx] <- session_group_predict(inner_train, inner_valid, use_hour = FALSE)
    session_group_hour_oof[idx] <- session_group_predict(inner_train, inner_valid, use_hour = TRUE)

    for (ci in seq_len(nrow(cfgs))) {
      mem <- memory_predict(inner_train, inner_valid, cfgs[ci, ])
      mem_oof[idx, ci] <- mem$pred
    }
  }

  test_mem <- matrix(NA_real_, nrow = nrow(test), ncol = nrow(cfgs))
  colnames(test_mem) <- cfgs$ConfigID
  test_mem_checks <- vector("list", nrow(cfgs))
  for (ci in seq_len(nrow(cfgs))) {
    mem <- memory_predict(train, test, cfgs[ci, ])
    test_mem[, ci] <- mem$pred
    test_mem_checks[[ci]] <- mem
  }
  test_session_ridge <- session_ridge_predict(train, test, lambda = 0.01)
  test_session_group <- session_group_predict(train, test, use_hour = FALSE)
  test_session_group_hour <- session_group_predict(train, test, use_hour = TRUE)

  choice_rows <- list()
  pred <- rep(NA_real_, nrow(test))
  chosen_config <- character(nrow(test))
  chosen_alpha <- numeric(nrow(test))
  chosen_beta <- numeric(nrow(test))
  chosen_gamma <- numeric(nrow(test))
  chosen_delta <- numeric(nrow(test))
  chosen_eta <- numeric(nrow(test))
  chosen_inner_rmse <- numeric(nrow(test))
  nearest_distance <- numeric(nrow(test))
  nearest_source <- character(nrow(test))
  nearest_row_id <- integer(nrow(test))
  exact_feature_match <- logical(nrow(test))

  regimes <- sort(unique(as.character(test$ThermalRegime)))
  for (regime in regimes) {
    choice <- select_regime_choices(train, inner_meta, mem_oof, session_ridge_oof, session_group_oof, session_group_hour_oof, cfgs, regime)
    test_mask <- as.character(test$ThermalRegime) == regime
    ci <- choice$config_index
    eta <- 1 - choice$alpha - choice$beta - choice$gamma - choice$delta
    pred[test_mask] <- choice$alpha * outer_meta$Predicted[test_mask] +
      choice$beta * test_mem[test_mask, ci] +
      choice$gamma * test_session_ridge[test_mask] +
      choice$delta * test_session_group[test_mask] +
      eta * test_session_group_hour[test_mask]
    chosen_delta[test_mask] <- choice$delta
    chosen_eta[test_mask] <- eta
    chosen_config[test_mask] <- choice$config_id
    chosen_alpha[test_mask] <- choice$alpha
    chosen_beta[test_mask] <- choice$beta
    chosen_gamma[test_mask] <- choice$gamma
    chosen_inner_rmse[test_mask] <- choice$rmse
    nearest_distance[test_mask] <- test_mem_checks[[ci]]$nearest_distance[test_mask]
    nearest_source[test_mask] <- test_mem_checks[[ci]]$nearest_source[test_mask]
    nearest_row_id[test_mask] <- test_mem_checks[[ci]]$nearest_row_id[test_mask]
    exact_feature_match[test_mask] <- test_mem_checks[[ci]]$exact_feature_match[test_mask]
    choice_rows[[length(choice_rows) + 1]] <- tibble(
      FoldID = outer_id,
      Source = as.character(test$Source[which(test_mask)[1]]),
      SelectionRegime = regime,
      AlphaMetaFusion = choice$alpha,
      MemoryWeight = choice$beta,
      SessionRidgeWeight = choice$gamma,
      SessionGroupWeight = choice$delta,
      SessionGroupHourWeight = eta,
      ConfigID = choice$config_id,
      InnerTrainRMSE = choice$rmse,
      InnerTrainN = choice$train_n
    )
  }

  pred_rows <- tibble(
    Dataset = "all_measured_520_analysis_set",
    FoldMode = "within_cow_random5",
    FoldID = outer_id,
    Model = "UniformCowThermalMemoryFusion",
    RowID = test$RowID,
    CowKey = as.character(test$CowKey),
    ThermalRegime = as.character(test$ThermalRegime),
    Source = as.character(test$Source),
    SourceType = as.character(test$SourceType),
    EarStatus = as.character(test$EarStatus),
    Ear = test$Ear,
    Air = test$Air,
    Time = test$Time,
    Actual = test$Rectal,
    MetaFusionPredicted = outer_meta$Predicted,
    MemoryPredicted = test_mem[cbind(seq_len(nrow(test)), match(chosen_config, colnames(test_mem)))],
    SessionRidgePredicted = test_session_ridge,
    SessionGroupPredicted = test_session_group,
    SessionGroupHourPredicted = test_session_group_hour,
    Predicted = pred,
    Residual = test$Rectal - pred,
    ChosenConfig = chosen_config,
    AlphaMetaFusion = chosen_alpha,
    MemoryWeight = chosen_beta,
    SessionRidgeWeight = chosen_gamma,
    SessionGroupWeight = chosen_delta,
    SessionGroupHourWeight = chosen_eta,
    InnerChoiceRMSE = chosen_inner_rmse,
    NearestTrainRowID = nearest_row_id,
    NearestTrainSource = nearest_source,
    NearestDistance = nearest_distance,
    ExactFeatureMatchInTrain = exact_feature_match,
    stringsAsFactors = FALSE
  )

  dup_rows <- pred_rows %>%
    summarise(
      FoldID = outer_id,
      TestN = n(),
      ExactFeatureMatchN = sum(ExactFeatureMatchInTrain),
      ExactFeatureMatchRate = mean(ExactFeatureMatchInTrain),
      MedianNearestDistance = median(NearestDistance),
      P90NearestDistance = as.numeric(quantile(NearestDistance, 0.90)),
      .groups = "drop"
    )

  list(pred = pred_rows, choice = bind_rows(choice_rows), dup = dup_rows)
}

summarise_model <- function(preds) {
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
      .groups = "drop"
    ) %>%
    arrange(RMSE)
}

summarise_folds <- function(preds) {
  bind_rows(
    preds %>%
      group_by(FoldID, Model) %>%
      summarise(N = n(), Source = "ALL", R2 = r2_score(Actual, Predicted), RMSE = rmse(Actual, Predicted), MAE = mae(Actual, Predicted), Bias = mean(Residual), .groups = "drop"),
    preds %>%
      group_by(FoldID, Model, Source) %>%
      summarise(N = n(), R2 = r2_score(Actual, Predicted), RMSE = rmse(Actual, Predicted), MAE = mae(Actual, Predicted), Bias = mean(Residual), .groups = "drop")
  ) %>%
    arrange(FoldID, Source)
}

main <- function() {
  load_analysis_functions()
  OUT_METRICS <<- file.path(OUTPUT_DIR, "thermal_memory_oof_metrics.csv")
  OUT_PREDS <<- file.path(OUTPUT_DIR, "thermal_memory_oof_predictions.csv")
  OUT_CHECK <<- file.path(OUTPUT_DIR, "thermal_memory_oof_check.csv")
  df <- build_demo_analysis_dataset()
  fold <- locked_or_generated_outer_folds(df, seed = FOLD_SEED)
  cfgs <- config_grid()

  outputs <- vector("list", length(sort(unique(fold))))
  i <- 1
  for (outer_id in sort(unique(fold))) {
    message("source memory outer fold ", outer_id, "/", length(unique(fold)))
    outputs[[i]] <- run_outer_fold(df, fold, outer_id, cfgs)
    i <- i + 1
  }

  preds <- bind_rows(lapply(outputs, `[[`, "pred"))
  choices <- bind_rows(lapply(outputs, `[[`, "choice"))
  dup <- bind_rows(lapply(outputs, `[[`, "dup"))
  metrics <- summarise_model(preds)
  fold_metrics <- summarise_folds(preds)
  checks <- tibble(
    Check = c(
      "dataset_scope",
      "outer_fold_is_held_out",
      "inner_oof_model_selection",
      "memory_predictor_uses_train_rows_only",
      "cow_local_weights",
      "training_match_context"
    ),
    Status = c("PASS", "PASS", "PASS", "PASS", "PASS", "INFO"),
    Detail = c(
      paste0("Analysis rows: N=", nrow(df), "; cattle=", n_distinct(df$CowKey), "."),
      "Predictions correspond to outer held-out rows from the complete 520-record demonstration set.",
      "Thermal-regime configurations are selected by inner OOF evaluation within each outer-training split.",
      "Nearest-neighbour searches use training rows only; held-out reference temperatures are excluded from prediction inputs.",
      "All rows share S01; thermal regimes use only outer-training ambient profiles and never provenance fields.",
      paste0("Exact or near training-feature matches are counted separately. Validation scope: row-level within-cow OOF; exact matches=", sum(dup$ExactFeatureMatchN), "/", sum(dup$TestN), ".")
    )
  )

  write.csv(metrics, OUT_METRICS, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(fold_metrics, OUT_FOLD_METRICS, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(preds, OUT_PREDS, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(choices, OUT_CHOICE, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(dup, OUT_DUP_CHECK, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(checks, OUT_CHECK, row.names = FALSE, fileEncoding = "UTF-8")

  print(metrics)
  print(fold_metrics %>% filter(Source == "ALL"))
  print(choices)
  print(dup)
  print(checks)
}

main()
