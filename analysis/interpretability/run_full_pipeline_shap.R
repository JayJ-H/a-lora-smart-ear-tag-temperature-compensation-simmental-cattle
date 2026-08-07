suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(jsonlite)
})

get_script_dir <- function() {
  args <- commandArgs(trailingOnly = FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg) == 0) return(normalizePath(getwd(), winslash = "/", mustWork = FALSE))
  normalizePath(dirname(sub("^--file=", "", file_arg[1])), winslash = "/", mustWork = FALSE)
}

parse_args <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  out <- list(
    output_dir = NULL,
    chunk_size = 4L,
    target_limit_per_fold = 0L,
    tolerance = 0.05,
    resume = FALSE,
    self_test = FALSE
  )
  i <- 1L
  while (i <= length(args)) {
    arg <- args[i]
    if (arg %in% c("--resume", "--self-test")) {
      key <- gsub("-", "_", sub("^--", "", arg))
      out[[key]] <- TRUE
      i <- i + 1L
    } else if (arg %in% c("--output-dir", "--chunk-size", "--target-limit-per-fold", "--tolerance") && i < length(args)) {
      key <- gsub("-", "_", sub("^--", "", arg))
      out[[key]] <- args[i + 1L]
      i <- i + 2L
    } else {
      stop("Unknown or incomplete argument: ", arg)
    }
  }
  out$chunk_size <- as.integer(out$chunk_size)
  out$target_limit_per_fold <- as.integer(out$target_limit_per_fold)
  out$tolerance <- as.numeric(out$tolerance)
  if (!is.finite(out$chunk_size) || out$chunk_size < 1) stop("--chunk-size must be a positive integer")
  if (!is.finite(out$target_limit_per_fold) || out$target_limit_per_fold < 0) stop("--target-limit-per-fold must be nonnegative")
  if (!is.finite(out$tolerance) || out$tolerance < 0) stop("--tolerance must be nonnegative")
  out
}

SCRIPT_DIR <- get_script_dir()
SHARED_ROOT <- normalizePath(file.path(SCRIPT_DIR, "..", ".."), winslash = "/", mustWork = TRUE)
MODULE_DIR <- file.path(SHARED_ROOT, "analysis", "th_shrc", "upstream_modules")
PUBLIC_INPUT <- file.path(SHARED_ROOT, "data", "processed", "paired_temperature_records.csv")
OOF_INPUT <- file.path(SHARED_ROOT, "data", "processed", "th_shrc_oof_predictions.csv")
FROZEN_SHAP_INPUT <- file.path(SHARED_ROOT, "data", "processed", "th_shrc_shap_values.csv")
SHAP_STACK_INPUT <- file.path(SHARED_ROOT, "data", "processed", "th_shrc_conditional_shap_stack_choices.csv")
ARGS <- parse_args()
OUTPUT_DIR <- if (is.null(ARGS$output_dir)) {
  file.path(SHARED_ROOT, "outputs", "analysis", "interpretability", "full_pipeline_shap")
} else {
  normalizePath(ARGS$output_dir, winslash = "/", mustWork = FALSE)
}
dir.create(OUTPUT_DIR, recursive = TRUE, showWarnings = FALSE)
RUN_LABEL <- if (ARGS$target_limit_per_fold > 0) paste0("sample_", ARGS$target_limit_per_fold) else "all_503"
CHUNK_DIR <- file.path(OUTPUT_DIR, "chunks", RUN_LABEL)
dir.create(CHUNK_DIR, recursive = TRUE, showWarnings = FALSE)
LOG_FILE <- file.path(OUTPUT_DIR, paste0("run_progress_", RUN_LABEL, ".txt"))
Sys.setenv(TH_SHRC_PUBLIC_INPUT = PUBLIC_INPUT)

safe_read <- function(path) {
  read.csv(path, stringsAsFactors = FALSE, check.names = FALSE, fileEncoding = "UTF-8-BOM")
}

read_batch_dataset_for_shap <- function() {
  data <- safe_read(PUBLIC_INPUT) %>%
    transmute(
      RecordID, CowKey, Source, RowID, SourceRowID,
      Ear = EarTemperature_C,
      Rectal = CoreReferenceTemperature_C,
      Air = AmbientTemperature_C,
      Time = MeasurementTime_hour,
      SourceType, EarStatus, SourceWeight, SeqInCowSource
    )
  numeric_columns <- c(
    "Ear", "Rectal", "Air", "Time", "SourceWeight",
    "SourceRowID", "RowID", "SeqInCowSource"
  )
  for (column in numeric_columns) data[[column]] <- suppressWarnings(as.numeric(data[[column]]))
  data %>%
    filter(Source %in% c("S03", "S04", "S01")) %>%
    mutate(
      Source = as.character(Source),
      CowKey = as.character(CowKey),
      SourceType = as.character(SourceType),
      EarStatus = as.character(EarStatus)
    ) %>%
    filter(
      is.finite(Ear), is.finite(Rectal), is.finite(Air), is.finite(Time),
      is.finite(SourceRowID), is.finite(RowID),
      Ear > 25, Rectal > 35, Rectal < 42, Air > -40, Air < 60,
      Time >= 0, Time <= 24
    ) %>%
    group_by(CowKey) %>%
    filter(n() >= 8) %>%
    ungroup()
}

log_msg <- function(...) {
  msg <- paste0(format(Sys.time(), "%Y-%m-%d %H:%M:%S"), " | ", paste(..., collapse = ""))
  cat(msg, "\n")
  cat(msg, "\n", file = LOG_FILE, append = TRUE)
}

load_functions_before_main <- function(path, env) {
  lines <- readLines(path, encoding = "UTF-8", warn = FALSE)
  main_line <- grep("^main\\s*<-\\s*function\\s*\\(", lines)
  if (length(main_line) == 0) stop("Could not find main <- function in ", path)
  eval(parse(text = paste(lines[seq_len(main_line[1] - 1L)], collapse = "\n")), envir = env)
  invisible(env)
}

bind_dplyr_verbs <- function(env) {
  verbs <- c("select", "filter", "mutate", "arrange", "summarise", "transmute", "rename", "left_join", "inner_join", "bind_rows")
  for (name in verbs) assign(name, get(name, asNamespace("dplyr")), envir = env)
}

reference_row <- function(train) {
  key_columns <- intersect(c("Ear", "Air", "Time"), names(train))
  medians <- vapply(train[key_columns], median, numeric(1), na.rm = TRUE)
  distance_data <- train[key_columns]
  for (name in key_columns) {
    scale_value <- stats::sd(distance_data[[name]], na.rm = TRUE)
    if (!is.finite(scale_value) || scale_value <= 0) scale_value <- 1
    distance_data[[name]] <- abs((distance_data[[name]] - medians[[name]]) / scale_value)
  }
  train[which.min(rowSums(distance_data)), , drop = FALSE]
}

GROUPS <- list(
  Cow_identity = c(
    "CowKey", "CowKeyChr", "SourceCow", "CowTime", "CowSession", "CowSessionHour",
    "TrainCowN", "TrainCowRectalCenter", "TrainCowGapBias", "TrainCowRectalSD",
    "CowCenterShrink", "CowCenterFeature", "CowGapFeature", "TrainCowSessionN",
    "TrainCowSessionRectalCenter", "TrainCowSessionGapBias", "CowSessionCenterShrink",
    "CowSessionCenterFeature", "CowSessionGapFeature", "CowSourceN", "CowSourceRowN",
    "SeqInCowSource", "SeqInCowSourceRow"
  ),
  Ear_temperature = c(
    "Ear", "Ear01", "Ear03", "Ear06", "EarAirGap", "EarLag1", "EarLag2",
    "EarDelta1", "EarOrderLag1", "EarOrderLag2", "OrderEarDelta1", "SessionMeanEar",
    "EarMinusSessionMean", "CellExact", "CellMedium", "CellCoarse", "GlobalCell"
  ),
  Ambient_temperature = c(
    "Air", "Air01", "Air10", "Air20", "ThermalLoad", "HotFlag", "HighHeatFlag",
    "EarAirGap", "AirLag1", "AirDelta1", "AirOrderLag1", "OrderAirDelta1",
    "SessionMeanAir", "SessionMaxAir", "SessionHotRate", "AirMinusSessionMean",
    "HeatSegment", "HeatSegmentCenterFeature"
  ),
  Time_diurnal = c(
    "Time", "TimeInt", "TimeSin", "TimeCos", "NightFlag", "TimePeriod", "HourGroup",
    "TimeSession", "SourceTime", "CowTime", "SessionHour", "CowSessionHour",
    "SessionMeanTime", "SessionTimeSpan", "TimeMinusSessionMean", "TimeOrderLag1",
    "OrderTimeDelta1"
  ),
  Source_technical = c(
    "Source", "SourceChr", "SourceType", "EarStatus", "SourceWeight", "SourceFile",
    "SourceCenterFeature", "SourceCenterShrink", "TrainSourceN", "TrainSourceRectalCenter",
    "TrainSourceGapBias", "TrainSourceRectalSD", "SourcePeriodCenterFeature",
    "TrainSourcePeriodN", "TrainSourcePeriodRectalCenter", "TrainSourcePeriodGapBias"
  ),
  Row_order_technical = c(
    "SourceRowID", "RowID", "RowKey", "SourceOrderIndex", "SourceN", "SourceOrderPct",
    "SourceOrderScaled", "SourceRowSin", "SourceRowCos", "NewSessionFlag",
    "SourceSessionIndex", "DayIndex", "SessionID", "BatchID", "DayID",
    "SessionRowIndex", "SessionSize", "SessionRowPct", "SourceRowGap1",
    "MaySourceOrderPct", "IsMayMeasured", "MaySession", "MaySessionNum",
    "DayCenterFeature", "SessionCenterFeature", "SessionGapFeature"
  )
)
GROUP_NAMES <- names(GROUPS)
M <- length(GROUP_NAMES)
DISPLAYED_GROUPS <- GROUP_NAMES[1:4]
TECHNICAL_MASK <- 2^4 + 2^5

coalition_table <- function() {
  bind_rows(lapply(0:(2^M - 1L), function(mask) {
    included <- GROUP_NAMES[as.logical(intToBits(mask)[seq_len(M)])]
    data.frame(
      CoalitionID = mask,
      CoalitionKey = if (length(included) == 0) "EMPTY" else paste(included, collapse = "+"),
      CoalitionSize = length(included),
      stringsAsFactors = FALSE
    )
  }))
}

make_variants <- function(test, train, target_row_ids, rowid_offset) {
  reference <- reference_row(train)
  coalitions <- coalition_table()
  out <- vector("list", nrow(test) * nrow(coalitions))
  index <- 1L
  for (i in seq_len(nrow(test))) {
    base <- test[i, , drop = FALSE]
    for (j in seq_len(nrow(coalitions))) {
      mask <- coalitions$CoalitionID[j]
      if (mask == 2^M - 1L) {
        row <- base
      } else {
        row <- reference
        for (group_index in seq_along(GROUP_NAMES)) {
          if (as.logical(intToBits(mask)[group_index])) {
            columns <- intersect(GROUPS[[group_index]], intersect(names(row), names(base)))
            if (length(columns) > 0) row[1, columns] <- base[1, columns]
          }
        }
      }
      row$RowID <- rowid_offset + index
      if ("Rectal" %in% names(row) && "Rectal" %in% names(base)) row$Rectal <- base$Rectal
      row$TargetRowID <- target_row_ids[i]
      row$CoalitionID <- mask
      row$CoalitionKey <- coalitions$CoalitionKey[j]
      row$CoalitionSize <- coalitions$CoalitionSize[j]
      out[[index]] <- row
      index <- index + 1L
    }
  }
  bind_rows(out)
}

split_chunks <- function(values, size) {
  if (length(values) == 0) return(list())
  split(values, ceiling(seq_along(values) / size))
}

select_targets <- function(saved, limit_per_fold) {
  targets <- saved %>%
    transmute(FoldID = as.integer(FoldID), RowID = as.integer(RowID), Source, AbsResidual = abs(Residual)) %>%
    arrange(FoldID, Source, RowID)
  if (limit_per_fold <= 0) return(targets)
  targets %>% group_by(FoldID) %>% slice_head(n = limit_per_fold) %>% ungroup()
}

predict_stack_for_variants <- function(
  source_env, batch_env, new_env,
  df_source, df_batch, df_new,
  fold_source, fold_id, target_keep,
  cfg_source, cfg_batch, stack_choices,
  rowid_offset
) {
  test_source <- df_source[fold_source == fold_id, , drop = FALSE]
  train_source <- df_source[fold_source != fold_id, , drop = FALSE]
  fold_lookup <- setNames(fold_source, as.character(df_source$RowID))
  fold_batch <- as.integer(fold_lookup[as.character(df_batch$RowID)])
  fold_new <- as.integer(fold_lookup[as.character(df_new$RowID)])
  test_batch <- df_batch[fold_batch == fold_id, , drop = FALSE]
  train_batch <- df_batch[fold_batch != fold_id, , drop = FALSE]
  test_new <- df_new[fold_new == fold_id, , drop = FALSE]
  train_new <- df_new[fold_new != fold_id, , drop = FALSE]

  align_targets <- function(data) {
    data <- data[data$RowID %in% target_keep, , drop = FALSE]
    data[match(target_keep, data$RowID), , drop = FALSE]
  }
  test_source <- align_targets(test_source)
  test_batch <- align_targets(test_batch)
  test_new <- align_targets(test_new)
  if (any(is.na(test_source$RowID)) || any(is.na(test_batch$RowID)) || any(is.na(test_new$RowID))) {
    stop("Target RowID alignment failed for fold ", fold_id)
  }
  if (!identical(as.integer(test_source$RowID), as.integer(test_batch$RowID)) ||
      !identical(as.integer(test_source$RowID), as.integer(test_new$RowID))) {
    stop("Pipeline test-row order mismatch for fold ", fold_id)
  }

  target_ids <- test_source$RowID
  variants_source <- make_variants(test_source, train_source, target_ids, rowid_offset)
  variants_batch <- make_variants(test_batch, train_batch, target_ids, rowid_offset)
  variants_new <- make_variants(test_new, train_new, target_ids, rowid_offset)
  meta <- variants_source %>% select(RowID, TargetRowID, CoalitionID, CoalitionKey, CoalitionSize)
  drop_meta <- function(data) data %>% select(-TargetRowID, -CoalitionID, -CoalitionKey, -CoalitionSize)
  combined_source <- bind_rows(train_source, drop_meta(variants_source))
  combined_batch <- bind_rows(train_batch, drop_meta(variants_batch))
  combined_new <- bind_rows(train_new, drop_meta(variants_new))
  fold_source_variant <- c(rep(0L, nrow(train_source)), rep(fold_id, nrow(variants_source)))
  fold_batch_variant <- c(rep(0L, nrow(train_batch)), rep(fold_id, nrow(variants_batch)))
  fold_new_variant <- c(rep(0L, nrow(train_new)), rep(fold_id, nrow(variants_new)))

  log_msg("full-pipeline SHAP fold ", fold_id, ": targets=", length(target_keep), ", variants=", nrow(variants_source))
  set.seed(20260708 + fold_id * 1000 + 11)
  source_predictions <- source_env$run_outer_fold(combined_source, fold_source_variant, fold_id, cfg_source)$pred %>%
    transmute(RowID, SourceMemoryPredicted = Predicted)
  set.seed(20260708 + fold_id * 1000 + 22)
  batch_predictions <- batch_env$run_outer_fold(combined_batch, fold_batch_variant, fold_id, cfg_batch)$pred %>%
    transmute(RowID, BatchSessionPredicted = Predicted)
  set.seed(20260708 + fold_id * 1000 + 33)
  new_predictions <- new_env$run_outer_fold(combined_new, fold_new_variant, fold_id)$pred %>%
    transmute(RowID, HierarchicalResidualPredicted = Predicted)

  joined <- meta %>%
    left_join(source_predictions, by = "RowID") %>%
    left_join(batch_predictions, by = "RowID") %>%
    left_join(new_predictions, by = "RowID")
  choice <- stack_choices[stack_choices$FoldID == fold_id, , drop = FALSE]
  if (nrow(choice) != 1) stop("Missing stack choice for fold ", fold_id)
  joined %>%
    mutate(
      FoldID = fold_id,
      StackIntercept = choice$Intercept[1],
      StackWeightSourceMemory = choice$WeightSourceMemory[1],
      StackWeightBatchSession = choice$WeightBatchSession[1],
      StackWeightHierarchicalResidual = choice$WeightHierarchicalResidual[1],
      FullPipelinePredicted = pmin(
        pmax(
          StackIntercept +
            StackWeightSourceMemory * SourceMemoryPredicted +
            StackWeightBatchSession * BatchSessionPredicted +
            StackWeightHierarchicalResidual * HierarchicalResidualPredicted,
          35
        ),
        42
      )
    )
}

shapley_weight <- function(size, group_count) {
  factorial(size) * factorial(group_count - size - 1L) / factorial(group_count)
}

compute_conditional_shap <- function(predictions) {
  by_row <- split(predictions, predictions$TargetRowID)
  value_rows <- list()
  audit_rows <- list()
  value_index <- 1L
  audit_index <- 1L
  for (row_id in names(by_row)) {
    table <- by_row[[row_id]]
    values <- setNames(table$FullPipelinePredicted, as.character(table$CoalitionID))
    if (length(values) != 64L || anyDuplicated(names(values))) stop("Incomplete coalition table for RowID ", row_id)
    phi <- setNames(rep(0, length(DISPLAYED_GROUPS)), DISPLAYED_GROUPS)
    for (group_index in seq_along(DISPLAYED_GROUPS)) {
      bit <- 2^(group_index - 1L)
      for (mask in 0:15) {
        if (bitwAnd(mask, bit) != 0) next
        coalition_size <- sum(as.logical(intToBits(mask)[1:4]))
        with_group <- bitwOr(mask, bit)
        phi[group_index] <- phi[group_index] +
          shapley_weight(coalition_size, 4L) *
          (values[as.character(TECHNICAL_MASK + with_group)] - values[as.character(TECHNICAL_MASK + mask)])
      }
    }
    baseline <- values[as.character(TECHNICAL_MASK)]
    full <- values[as.character(2^M - 1L)]
    audit_rows[[audit_index]] <- data.frame(
      TargetRowID = as.integer(row_id),
      TechnicalBaselinePrediction_C = baseline,
      ConditionalFullPipelinePrediction_C = full,
      SHAPSum_C = sum(phi),
      ReconstructedPrediction_C = baseline + sum(phi),
      AdditivityDifference_C = baseline + sum(phi) - full,
      stringsAsFactors = FALSE
    )
    audit_index <- audit_index + 1L
    for (group in DISPLAYED_GROUPS) {
      value_rows[[value_index]] <- data.frame(
        TargetRowID = as.integer(row_id),
        FeatureGroup = group,
        SHAP_C = phi[group],
        stringsAsFactors = FALSE
      )
      value_index <- value_index + 1L
    }
  }
  list(values = bind_rows(value_rows), audit = bind_rows(audit_rows))
}

build_public_outputs <- function(shap, saved, paired) {
  wide <- shap$values %>%
    pivot_wider(names_from = FeatureGroup, values_from = SHAP_C, names_prefix = "SHAP_")
  values <- paired %>%
    transmute(
      TargetRowID = as.integer(RowID),
      RecordID,
      RowID = as.integer(RowID),
      CowKey,
      Ear_C = as.numeric(EarTemperature_C),
      Air_C = as.numeric(AmbientTemperature_C),
      Time_hour = as.numeric(MeasurementTime_hour),
      EarAirGap_C = as.numeric(EarAirGap_C)
    ) %>%
    inner_join(wide, by = "TargetRowID") %>%
    inner_join(shap$audit, by = "TargetRowID") %>%
    inner_join(saved %>% transmute(TargetRowID = as.integer(RowID), OfficialOOFPrediction_C = as.numeric(Predicted)), by = "TargetRowID") %>%
    mutate(ConditionalVsOfficialDifference_C = ConditionalFullPipelinePrediction_C - OfficialOOFPrediction_C) %>%
    select(
      RecordID, RowID, CowKey, Ear_C, Air_C, Time_hour, EarAirGap_C,
      SHAP_Ear_temperature_C = SHAP_Ear_temperature,
      SHAP_Ambient_temperature_C = SHAP_Ambient_temperature,
      SHAP_Time_diurnal_C = SHAP_Time_diurnal,
      SHAP_Cow_identity_C = SHAP_Cow_identity,
      TechnicalBaselinePrediction_C, ConditionalFullPipelinePrediction_C,
      ReconstructedPrediction_C, AdditivityDifference_C,
      OfficialOOFPrediction_C, ConditionalVsOfficialDifference_C
    ) %>%
    arrange(RowID)
  summary <- shap$values %>%
    group_by(FeatureGroup) %>%
    summarise(
      MeanAbsSHAP_C = mean(abs(SHAP_C)),
      MeanSignedSHAP_C = mean(SHAP_C),
      MedianAbsSHAP_C = median(abs(SHAP_C)),
      P90AbsSHAP_C = quantile(abs(SHAP_C), 0.90),
      .groups = "drop"
    ) %>%
    arrange(desc(MeanAbsSHAP_C)) %>%
    mutate(Rank_by_MeanAbsSHAP = row_number())
  list(values = values, summary = summary, audit = shap$audit)
}

compare_with_frozen <- function(reproduced, frozen) {
  columns <- c(
    "SHAP_Ear_temperature_C", "SHAP_Ambient_temperature_C", "SHAP_Time_diurnal_C",
    "SHAP_Cow_identity_C", "TechnicalBaselinePrediction_C", "ConditionalFullPipelinePrediction_C"
  )
  joined <- reproduced %>%
    select(RowID, all_of(columns)) %>%
    inner_join(frozen %>% select(RowID, all_of(columns)), by = "RowID", suffix = c("_reproduced", "_frozen"))
  differences <- setNames(vapply(columns, function(column) {
    max(abs(joined[[paste0(column, "_reproduced")]] - joined[[paste0(column, "_frozen")]]))
  }, numeric(1)), columns)
  list(rows = nrow(joined), by_column = differences, maximum = max(differences))
}

run_self_test <- function() {
  synthetic <- bind_rows(lapply(0:63, function(mask) {
    bits <- as.integer(as.logical(intToBits(mask)[1:6]))
    data.frame(TargetRowID = 1L, CoalitionID = mask, FullPipelinePredicted = 37 + sum(bits * c(0.1, -0.2, 0.3, -0.4, 1.2, -0.7)))
  }))
  result <- compute_conditional_shap(synthetic)
  expected <- c(Cow_identity = 0.1, Ear_temperature = -0.2, Ambient_temperature = 0.3, Time_diurnal = -0.4)
  actual <- setNames(result$values$SHAP_C, result$values$FeatureGroup)
  if (max(abs(actual[names(expected)] - expected)) > 1e-12) stop("Synthetic Shapley self-test failed")
  if (max(abs(result$audit$AdditivityDifference_C)) > 1e-12) stop("Synthetic additivity self-test failed")
  cat("FULL_PIPELINE_SHAP_SELF_TEST=PASS\n")
}

main <- function() {
  if (ARGS$self_test) {
    run_self_test()
    return(invisible(NULL))
  }

  source_env <- new.env(parent = .GlobalEnv)
  batch_env <- new.env(parent = .GlobalEnv)
  new_env <- new.env(parent = .GlobalEnv)
  bind_dplyr_verbs(.GlobalEnv)
  bind_dplyr_verbs(source_env)
  bind_dplyr_verbs(batch_env)
  bind_dplyr_verbs(new_env)

  load_functions_before_main(file.path(MODULE_DIR, "run_thermal_memory_oof.R"), source_env)
  assign("BASE_DIR", MODULE_DIR, envir = source_env)
  source_env$load_analysis_functions()
  load_functions_before_main(file.path(MODULE_DIR, "run_individual_session_calibration_oof.R"), batch_env)
  assign("BASE_DIR", MODULE_DIR, envir = batch_env)
  assign("IN_DATASET", PUBLIC_INPUT, envir = batch_env)
  load_functions_before_main(file.path(MODULE_DIR, "run_hierarchical_residual_oof.R"), new_env)
  assign("BASE_DIR", MODULE_DIR, envir = new_env)
  new_env$load_analysis_functions()

  df_source <- source_env$build_strict_real_dataset()
  df_batch <- batch_env$add_batch_session_features(read_batch_dataset_for_shap())
  df_new <- new_env$build_strict_real_dataset()
  if (!setequal(df_source$RowID, df_batch$RowID) || !setequal(df_source$RowID, df_new$RowID)) {
    stop("RowID mismatch across public pipeline datasets")
  }

  saved <- safe_read(OOF_INPUT)
  paired <- safe_read(PUBLIC_INPUT)
  frozen_shap <- safe_read(FROZEN_SHAP_INPUT)
  shap_stack <- safe_read(SHAP_STACK_INPUT)
  fold_lookup <- setNames(as.integer(saved$FoldID), as.character(saved$RowID))
  fold_source <- as.integer(fold_lookup[as.character(df_source$RowID)])
  if (any(is.na(fold_source))) stop("Frozen FoldID mapping is incomplete")
  stack_choices <- shap_stack %>%
    transmute(
      FoldID = as.integer(FoldID),
      Intercept = as.numeric(Intercept),
      WeightSourceMemory = as.numeric(WeightSourceMemory),
      WeightBatchSession = as.numeric(WeightBatchSession),
      WeightHierarchicalResidual = as.numeric(WeightHierarchicalResidual)
    ) %>% distinct()
  if (nrow(stack_choices) != 5L) stop("Expected one stack configuration per fold")
  targets <- select_targets(saved, ARGS$target_limit_per_fold)
  write.csv(targets, file.path(OUTPUT_DIR, paste0("sampled_targets_", RUN_LABEL, ".csv")), row.names = FALSE, fileEncoding = "UTF-8")

  cfg_source <- source_env$config_grid()
  cfg_batch <- batch_env$config_grid()
  expected_chunk_paths <- character()
  rowid_offset <- 9000000L
  for (fold_id in sort(unique(fold_source))) {
    fold_targets <- targets$RowID[targets$FoldID == fold_id]
    chunks <- split_chunks(fold_targets, ARGS$chunk_size)
    for (chunk_id in seq_along(chunks)) {
      chunk_path <- file.path(CHUNK_DIR, sprintf("fold_%02d_chunk_%04d_coalition_predictions.csv", fold_id, chunk_id))
      expected_chunk_paths <- c(expected_chunk_paths, chunk_path)
      if (ARGS$resume && file.exists(chunk_path)) {
        log_msg("skip existing fold ", fold_id, " chunk ", chunk_id, " rows=", length(chunks[[chunk_id]]))
        next
      }
      start_time <- Sys.time()
      chunk_predictions <- predict_stack_for_variants(
        source_env, batch_env, new_env,
        df_source, df_batch, df_new,
        fold_source, fold_id, chunks[[chunk_id]],
        cfg_source, cfg_batch, stack_choices,
        rowid_offset + fold_id * 1000000L + chunk_id * 10000L
      )
      write.csv(chunk_predictions, chunk_path, row.names = FALSE, fileEncoding = "UTF-8")
      full_rows <- chunk_predictions %>%
        filter(CoalitionID == 2^M - 1L) %>%
        left_join(saved %>% select(TargetRowID = RowID, OfficialPredicted = Predicted), by = "TargetRowID")
      log_msg(
        "done fold ", fold_id, " chunk ", chunk_id, "/", length(chunks),
        " rows=", length(chunks[[chunk_id]]),
        " elapsed_min=", sprintf("%.2f", as.numeric(difftime(Sys.time(), start_time, units = "mins"))),
        " replay_max_abs_diff=", sprintf("%.8f", max(abs(full_rows$FullPipelinePredicted - full_rows$OfficialPredicted)))
      )
    }
  }

  if (!all(file.exists(expected_chunk_paths))) stop("One or more expected chunk outputs are missing")
  predictions <- bind_rows(lapply(expected_chunk_paths, safe_read)) %>% arrange(TargetRowID, CoalitionID)
  if (nrow(predictions) != nrow(targets) * 64L) stop("Coalition output row count is incomplete")
  shap <- compute_conditional_shap(predictions)
  outputs <- build_public_outputs(shap, saved, paired)
  comparison <- compare_with_frozen(outputs$values, frozen_shap)
  additivity_max <- max(abs(outputs$audit$AdditivityDifference_C))
  status <- if (comparison$maximum <= ARGS$tolerance && additivity_max <= 1e-12) "PASS" else "FAIL"

  write.csv(predictions, file.path(OUTPUT_DIR, paste0("full_pipeline_coalition_predictions_", RUN_LABEL, ".csv")), row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(outputs$values, file.path(OUTPUT_DIR, paste0("conditional_shap_values_reproduced_", RUN_LABEL, ".csv")), row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(outputs$summary, file.path(OUTPUT_DIR, paste0("conditional_shap_summary_reproduced_", RUN_LABEL, ".csv")), row.names = FALSE, fileEncoding = "UTF-8")
  write.csv(outputs$audit, file.path(OUTPUT_DIR, paste0("conditional_shap_additivity_audit_", RUN_LABEL, ".csv")), row.names = FALSE, fileEncoding = "UTF-8")
  verification <- list(
    status = status,
    method = "native full-pipeline replay followed by exact four-group conditional Shapley values",
    validation = "same-animal random five-fold OOF",
    stack_parameter_scope = "frozen conditional-SHAP replay only; official accuracy remains the OOF prediction table",
    rows = nrow(outputs$values),
    coalitions_per_row = 64L,
    displayed_groups = DISPLAYED_GROUPS,
    conditioned_technical_groups = GROUP_NAMES[5:6],
    tolerance_C = ARGS$tolerance,
    frozen_comparison = comparison,
    additivity_max_abs_difference_C = additivity_max,
    full_run = ARGS$target_limit_per_fold == 0L
  )
  writeLines(
    toJSON(verification, pretty = TRUE, auto_unbox = TRUE, digits = 16),
    file.path(OUTPUT_DIR, paste0("conditional_shap_verification_", RUN_LABEL, ".json")),
    useBytes = TRUE
  )
  cat("FULL_PIPELINE_SHAP_STATUS=", status, "\n", sep = "")
  cat("ROWS=", nrow(outputs$values), "\n", sep = "")
  cat("FROZEN_MAX_ABS_DIFF_C=", sprintf("%.12g", comparison$maximum), "\n", sep = "")
  cat("ADDITIVITY_MAX_ABS_DIFF_C=", sprintf("%.12g", additivity_max), "\n", sep = "")
  if (status != "PASS") quit(status = 1L)
}

main()
