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
  file.path(SHARED_ROOT, "输出", "分析", "上游分支")
)
dir.create(OUTPUT_DIR, recursive = TRUE, showWarnings = FALSE)
OUT_METRICS <- file.path(OUTPUT_DIR, "memory_calibration_oof_metrics.csv")
OUT_FOLD_METRICS <- file.path(OUTPUT_DIR, "memory_calibration_oof_fold_metrics.csv")
OUT_PREDS <- file.path(OUTPUT_DIR, "memory_calibration_oof_predictions.csv")
OUT_AUDIT <- file.path(OUTPUT_DIR, "memory_calibration_oof_check.csv")

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

load_functions_before_main <- function(path, env) {
  lines <- readLines(path, encoding = "UTF-8", warn = FALSE)
  main_line <- grep("^main\\s*<-\\s*function\\s*\\(", lines)
  if (length(main_line) == 0) stop("Could not find main <- function in ", path)
  eval(parse(text = paste(lines[seq_len(main_line[1] - 1)], collapse = "\n")), envir = env)
  invisible(env)
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
      select(Scope, Source, everything())
  ) %>%
    arrange(factor(Scope, levels = c("ALL", "SOURCE")), Source)
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

main <- function() {
  out_metrics <- file.path(OUTPUT_DIR, "memory_calibration_oof_metrics.csv")
  out_fold_metrics <- file.path(OUTPUT_DIR, "memory_calibration_oof_fold_metrics.csv")
  out_preds <- file.path(OUTPUT_DIR, "memory_calibration_oof_predictions.csv")
  out_audit <- file.path(OUTPUT_DIR, "memory_calibration_oof_check.csv")

  source_env <- new.env(parent = .GlobalEnv)
  batch_env <- new.env(parent = .GlobalEnv)
  load_functions_before_main(file.path(BASE_DIR, "run_thermal_memory_oof.R"), source_env)
  source_env$load_analysis_functions()
  load_functions_before_main(file.path(BASE_DIR, "run_individual_session_calibration_oof.R"), batch_env)

  df_source <- source_env$build_strict_real_dataset()
  df_batch <- batch_env$add_batch_session_features(batch_env$read_analysis_dataset())
  if (nrow(df_source) != nrow(df_batch)) stop("Source and batch datasets differ in row count.")
  if (!setequal(df_source$RowID, df_batch$RowID)) stop("Source and batch datasets differ in RowID set.")

  fold_source <- make_within_cow_folds(df_source, k = 5, seed = 20260523)
  fold_lookup <- setNames(fold_source, as.character(df_source$RowID))
  fold_batch <- as.integer(fold_lookup[as.character(df_batch$RowID)])
  if (any(!is.finite(fold_batch))) stop("Missing fold mapping for batch rows.")

  cfg_source <- source_env$config_grid()
  cfg_batch <- batch_env$config_grid()
  alpha_source <- 0.50
  outputs <- list()

  for (outer_id in sort(unique(fold_source))) {
    message("memory/calibration average OOF fold ", outer_id, "/", length(unique(fold_source)))
    sm <- source_env$run_outer_fold(df_source, fold_source, outer_id, cfg_source)$pred %>%
      transmute(
        RowID,
        SourceMemoryFoldID = FoldID,
        CowKey,

        Source,
        SourceType,
        EarStatus,
        Ear,
        Air,
        Time,
        Actual,
        SourceMemoryPredicted = Predicted,
        SourceMemoryResidual = Residual,
        SourceMemoryConfig = ChosenConfig,
        SourceMemoryExactMatch = ExactFeatureMatchInTrain,
        SourceMemoryNearestDistance = NearestDistance
      )
    bs <- batch_env$run_outer_fold(df_batch, fold_batch, outer_id, cfg_batch)$pred %>%
      transmute(
        RowID,
        BatchFoldID = FoldID,
        SourceRowID,
        BatchSessionPredicted = Predicted,
        BatchModelPredicted,
        BatchMemoryPredicted = MemoryPredicted,
        BatchResidual = Residual,
        HeatSegment,
        SessionID,
        BatchConfig = ChosenConfig,
        BatchExactMatch = ExactObservableMatchInTrain,
        BatchNearestDistance = NearestDistance
      )
    joined <- inner_join(sm, bs, by = "RowID")
    if (nrow(joined) != sum(fold_source == outer_id)) stop("Prediction join failed for fold ", outer_id)
    joined <- joined %>%
      mutate(
        Dataset = "fixed_real_measurement_analysis_set",
        FoldMode = "within_cow_random5",
        FoldID = outer_id,
        Model = "MemoryCalibrationAverage_0p50",
        AlphaSourceMemory = alpha_source,
        AlphaBatchSession = 1 - alpha_source,
        Predicted = alpha_source * SourceMemoryPredicted + (1 - alpha_source) * BatchSessionPredicted,
        Residual = Actual - Predicted
      ) %>%
      select(
        Dataset, FoldMode, FoldID, Model, RowID, SourceRowID,
        CowKey, Source, SourceType, EarStatus, HeatSegment, SessionID,
        Ear, Air, Time, Actual,
        SourceMemoryPredicted, BatchSessionPredicted, BatchModelPredicted, BatchMemoryPredicted,
        Predicted, Residual, AlphaSourceMemory, AlphaBatchSession,
        SourceMemoryResidual, BatchResidual, SourceMemoryConfig, BatchConfig,
        SourceMemoryExactMatch, BatchExactMatch, SourceMemoryNearestDistance, BatchNearestDistance
      )
    outputs[[length(outputs) + 1]] <- joined
  }

  preds <- bind_rows(outputs) %>% arrange(FoldID, Source, RowID)
  metrics <- summarise_metrics(preds)
  fold_metrics <- summarise_fold_metrics(preds)
  audit <- tibble::tibble(
    Check = c(
      "dataset_scope",
      "same_outer_fold_for_two_components",
      "fixed_component_weight",
      "component_fold_separation",
      "training_match_context",
      "validation_scope"
    ),
    Status = c("PASS", "PASS", "PASS", "PASS", "INFO", "INFO"),
    Detail = c(
      paste0("Analysis rows: N=", nrow(preds), "; cattle=", n_distinct(preds$CowKey), "."),
      "Thermal-memory and individual/session components use the same within-cow outer-fold assignment.",
      "The component average is fixed at 0.50/0.50; held-out labels are not used to select the weight.",
      "Each component uses outer-training rows for fitting and inner OOF evaluation for configuration selection.",
      paste0("Exact training-feature matches: thermal-memory=", sum(preds$SourceMemoryExactMatch), "/", nrow(preds), "; individual/session=", sum(preds$BatchExactMatch), "/", nrow(preds), "."),
      "Validation protocol: row-level within-cow OOF with fixed outer folds."
    )
  )

  write.csv(metrics, out_metrics, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(fold_metrics, out_fold_metrics, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(preds, out_preds, row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(audit, out_audit, row.names = FALSE, fileEncoding = "UTF-8")

  print(metrics)
  print(fold_metrics %>% filter(Source == "ALL"))
  print(audit)
}

main()
