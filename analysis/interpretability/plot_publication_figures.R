suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
  library(ggplot2)
  library(patchwork)
})

get_script_dir <- function() {
  args <- commandArgs(trailingOnly = FALSE)
  file_arg <- grep("^--file=", args, value = TRUE)
  if (length(file_arg) == 0) return(normalizePath(getwd(), winslash = "/", mustWork = FALSE))
  normalizePath(dirname(sub("^--file=", "", file_arg[1])), winslash = "/", mustWork = FALSE)
}

parse_args <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  out <- list(output_dir = NULL)
  i <- 1L
  while (i <= length(args)) {
    if (args[i] == "--output-dir" && i < length(args)) {
      out$output_dir <- args[i + 1L]
      i <- i + 2L
    } else {
      stop("Unknown or incomplete argument: ", args[i])
    }
  }
  out
}

SCRIPT_DIR <- get_script_dir()
SHARED_ROOT <- normalizePath(file.path(SCRIPT_DIR, "..", ".."), winslash = "/", mustWork = TRUE)
ARGS <- parse_args()
OUTPUT_DIR <- if (is.null(ARGS$output_dir)) {
  file.path(SHARED_ROOT, "outputs", "analysis", "interpretability", "figures")
} else {
  normalizePath(ARGS$output_dir, winslash = "/", mustWork = FALSE)
}
DATA_DIR <- file.path(SHARED_ROOT, "data", "processed")
dir.create(OUTPUT_DIR, recursive = TRUE, showWarnings = FALSE)

read_public_csv <- function(name) {
  read.csv(file.path(DATA_DIR, name), stringsAsFactors = FALSE, check.names = FALSE, fileEncoding = "UTF-8-BOM")
}

theme_set(
  theme_classic(base_size = 7, base_family = "Arial") +
    theme(
      axis.line = element_line(linewidth = 0.35, colour = "#222222"),
      axis.ticks = element_line(linewidth = 0.35, colour = "#222222"),
      axis.text = element_text(colour = "#222222"),
      axis.title = element_text(colour = "#222222"),
      legend.title = element_text(size = 6.5),
      legend.text = element_text(size = 6.2),
      strip.background = element_blank(),
      strip.text = element_text(size = 6.8, face = "bold"),
      plot.tag = element_text(size = 8, face = "bold"),
      panel.grid = element_blank(),
      plot.margin = margin(4, 5, 4, 4)
    )
)

save_publication <- function(plot, stem, width_mm, height_mm, dpi = 600) {
  width_in <- width_mm / 25.4
  height_in <- height_mm / 25.4
  svg_path <- file.path(OUTPUT_DIR, paste0(stem, ".svg"))
  pdf_path <- file.path(OUTPUT_DIR, paste0(stem, ".pdf"))
  tiff_path <- file.path(OUTPUT_DIR, paste0(stem, ".tiff"))
  png_path <- file.path(OUTPUT_DIR, paste0(stem, ".png"))

  svglite::svglite(svg_path, width = width_in, height = height_in, bg = "white")
  print(plot)
  dev.off()
  grDevices::cairo_pdf(pdf_path, width = width_in, height = height_in, family = "Arial", bg = "white")
  print(plot)
  dev.off()
  ragg::agg_tiff(tiff_path, width = width_in, height = height_in, units = "in", res = dpi, compression = "lzw", background = "white")
  print(plot)
  dev.off()
  ragg::agg_png(png_path, width = width_in, height = height_in, units = "in", res = dpi, background = "white")
  print(plot)
  dev.off()
}

metric_data <- read_public_csv("th_shrc_ablation_metrics.csv")
bootstrap_data <- read_public_csv("th_shrc_ablation_bootstrap.csv")
ablation_rows <- read_public_csv("th_shrc_ablation_oof_predictions.csv")
shap_values <- read_public_csv("th_shrc_shap_values.csv")
shap_summary <- read_public_csv("th_shrc_shap_summary.csv")

configuration_order <- c("Full A+B+C", "w/o C (A+B)", "w/o B (A+C)", "w/o A (B+C)")
configuration_labels <- c(
  "Full A+B+C" = "Full A+B+C",
  "w/o C (A+B)" = "Without C",
  "w/o B (A+C)" = "Without B",
  "w/o A (B+C)" = "Without A"
)
configuration_palette <- c(
  "Full A+B+C" = "#30343B",
  "w/o C (A+B)" = "#4F8A70",
  "w/o B (A+C)" = "#4C78A8",
  "w/o A (B+C)" = "#C65D57"
)

metric_long <- metric_data %>%
  select(Configuration, R2, RMSE_C, MAE_C) %>%
  pivot_longer(cols = c(R2, RMSE_C, MAE_C), names_to = "Metric", values_to = "Value") %>%
  mutate(
    Configuration = factor(Configuration, levels = rev(configuration_order)),
    Metric = factor(Metric, levels = c("R2", "RMSE_C", "MAE_C"), labels = c("R2", "RMSE (degree C)", "MAE (degree C)"))
  )

p_ablation_metrics <- ggplot(metric_long, aes(x = Value, y = Configuration, colour = Configuration)) +
  geom_segment(aes(x = 0, xend = Value, yend = Configuration), linewidth = 0.7, colour = "#D7D9DC") +
  geom_point(size = 2.2) +
  geom_text(aes(label = sprintf("%.3f", Value)), hjust = -0.28, size = 2.25, colour = "#222222", family = "Arial") +
  facet_wrap(~Metric, scales = "free_x", ncol = 3) +
  scale_colour_manual(values = configuration_palette, guide = "none") +
  scale_y_discrete(labels = configuration_labels) +
  scale_x_continuous(expand = expansion(mult = c(0, 0.24))) +
  labs(x = NULL, y = NULL) +
  theme(axis.line.y = element_blank(), axis.ticks.y = element_blank())

bootstrap_long <- bind_rows(
  bootstrap_data %>% transmute(Configuration, RemovedModel, Metric = "Delta RMSE", Estimate = Delta_RMSE_C, Lower = Delta_RMSE_CI2.5_C, Upper = Delta_RMSE_CI97.5_C),
  bootstrap_data %>% transmute(Configuration, RemovedModel, Metric = "Delta MAE", Estimate = Delta_MAE_C, Lower = Delta_MAE_CI2.5_C, Upper = Delta_MAE_CI97.5_C)
) %>%
  mutate(
    RemovedModel = factor(RemovedModel, levels = c("C", "B", "A")),
    Metric = factor(Metric, levels = c("Delta RMSE", "Delta MAE"))
  )

p_ablation_bootstrap <- ggplot(bootstrap_long, aes(x = Estimate, y = RemovedModel, colour = Metric, shape = Metric)) +
  geom_vline(xintercept = 0, linewidth = 0.35, linetype = "22", colour = "#777777") +
  geom_errorbar(aes(xmin = Lower, xmax = Upper), width = 0.14, linewidth = 0.55, position = position_dodge(width = 0.34)) +
  geom_point(size = 2.0, position = position_dodge(width = 0.34)) +
  scale_colour_manual(values = c("Delta RMSE" = "#C65D57", "Delta MAE" = "#4C78A8")) +
  scale_shape_manual(values = c("Delta RMSE" = 16, "Delta MAE" = 17)) +
  scale_y_discrete(labels = c("A" = "Remove A", "B" = "Remove B", "C" = "Remove C")) +
  labs(x = "Increase relative to full model (degree C)", y = NULL, colour = NULL, shape = NULL) +
  theme(
    legend.position = c(0.73, 0.2),
    legend.direction = "horizontal",
    axis.line.y = element_blank(),
    axis.ticks.y = element_blank()
  )

fig_ablation <- p_ablation_metrics / p_ablation_bootstrap +
  plot_layout(heights = c(1.05, 1)) +
  plot_annotation(tag_levels = "a")
save_publication(fig_ablation, "fig_ablation_mechanism_validation", 183, 118)

selected_rows <- ablation_rows %>%
  filter(between(RowID, 173, 200) | between(RowID, 1083, 1101)) %>%
  group_by(CowKey) %>%
  arrange(RowID, .by_group = TRUE) %>%
  mutate(Observation = row_number()) %>%
  ungroup()

trajectory_long <- selected_rows %>%
  select(CowKey, Observation, Actual_C, Predicted_Full_ABC_C, Predicted_Without_A_BC_C, Predicted_Without_B_AC_C, Predicted_Without_C_AB_C) %>%
  pivot_longer(cols = -c(CowKey, Observation), names_to = "Series", values_to = "CoreTemperature_C") %>%
  mutate(
    Series = factor(
      Series,
      levels = c("Actual_C", "Predicted_Full_ABC_C", "Predicted_Without_A_BC_C", "Predicted_Without_B_AC_C", "Predicted_Without_C_AB_C"),
      labels = c("Measured", "Full A+B+C", "Without A", "Without B", "Without C")
    )
  )

trajectory_palette <- c(
  "Measured" = "#111111",
  "Full A+B+C" = "#7C4D8B",
  "Without A" = "#C65D57",
  "Without B" = "#4C78A8",
  "Without C" = "#4F8A70"
)
p_trajectory <- ggplot(trajectory_long, aes(x = Observation, y = CoreTemperature_C, colour = Series, linewidth = Series)) +
  geom_line() +
  geom_point(data = subset(trajectory_long, Series == "Measured"), size = 1.1) +
  facet_wrap(~CowKey, scales = "free_x", nrow = 1) +
  scale_colour_manual(values = trajectory_palette) +
  scale_linewidth_manual(values = c("Measured" = 0.8, "Full A+B+C" = 0.65, "Without A" = 0.45, "Without B" = 0.45, "Without C" = 0.45)) +
  labs(x = "Within-animal observation order", y = "Core temperature (degree C)", colour = NULL, linewidth = NULL) +
  theme(legend.position = "bottom", legend.key.width = grid::unit(10, "mm"))
save_publication(p_trajectory, "fig_ablation_oof_trajectories", 183, 72)

feature_spec <- data.frame(
  FeatureGroup = c("Time_diurnal", "Ear_temperature", "Cow_identity", "Ambient_temperature"),
  SHAPColumn = c("SHAP_Time_diurnal_C", "SHAP_Ear_temperature_C", "SHAP_Cow_identity_C", "SHAP_Ambient_temperature_C"),
  ValueColumn = c("Time_hour", "Ear_C", "CowKey", "Air_C"),
  Label = c("Sampling time and diurnal state", "Ear-surface temperature", "Animal identity", "Ambient temperature"),
  stringsAsFactors = FALSE
)
feature_order <- shap_summary$FeatureGroup[order(shap_summary$MeanAbsSHAP_C, decreasing = TRUE)]
feature_labels <- setNames(feature_spec$Label, feature_spec$FeatureGroup)

shap_long <- bind_rows(lapply(seq_len(nrow(feature_spec)), function(i) {
  spec <- feature_spec[i, ]
  raw_value <- shap_values[[spec$ValueColumn]]
  numeric_value <- suppressWarnings(as.numeric(raw_value))
  if (spec$FeatureGroup == "Cow_identity") numeric_value <- NA_real_
  data.frame(
    RecordID = shap_values$RecordID,
    FeatureGroup = spec$FeatureGroup,
    SHAP_C = shap_values[[spec$SHAPColumn]],
    FeatureValue = numeric_value,
    stringsAsFactors = FALSE
  )
})) %>%
  group_by(FeatureGroup) %>%
  mutate(
    ScaledValue = ifelse(
      all(is.na(FeatureValue)) || diff(range(FeatureValue, na.rm = TRUE)) == 0,
      NA_real_,
      (FeatureValue - min(FeatureValue, na.rm = TRUE)) / diff(range(FeatureValue, na.rm = TRUE))
    ),
    Jitter = runif(n(), -0.17, 0.17)
  ) %>%
  ungroup() %>%
  mutate(
    FeatureGroup = factor(FeatureGroup, levels = rev(feature_order)),
    FeaturePosition = as.numeric(FeatureGroup) + Jitter
  )

set.seed(20260723)
shap_long <- shap_long %>%
  group_by(FeatureGroup) %>%
  mutate(Jitter = runif(n(), -0.17, 0.17), FeaturePosition = as.numeric(FeatureGroup) + Jitter) %>%
  ungroup()

p_shap_importance <- shap_summary %>%
  mutate(FeatureGroup = factor(FeatureGroup, levels = rev(feature_order))) %>%
  ggplot(aes(x = MeanAbsSHAP_C, y = FeatureGroup)) +
  geom_col(width = 0.62, fill = "#D78B83") +
  geom_text(aes(label = sprintf("%.3f", MeanAbsSHAP_C)), hjust = -0.2, size = 2.35, family = "Arial") +
  scale_y_discrete(labels = feature_labels) +
  scale_x_continuous(expand = expansion(mult = c(0, 0.22))) +
  labs(x = "Mean absolute conditional SHAP value (degree C)", y = NULL) +
  theme(axis.line.y = element_blank(), axis.ticks.y = element_blank())

p_shap_distribution <- ggplot(shap_long, aes(x = SHAP_C, y = FeaturePosition, colour = ScaledValue)) +
  geom_vline(xintercept = 0, linewidth = 0.35, linetype = "22", colour = "#777777") +
  geom_point(data = subset(shap_long, !is.na(ScaledValue)), size = 0.75, alpha = 0.62) +
  geom_point(data = subset(shap_long, is.na(ScaledValue)), size = 0.75, alpha = 0.5, colour = "#6B6B6B") +
  scale_colour_gradient2(low = "#3B6EA8", mid = "#E7E7E7", high = "#B84A4A", midpoint = 0.5, limits = c(0, 1), breaks = c(0, 1), labels = c("Low", "High")) +
  scale_y_continuous(breaks = seq_along(rev(feature_order)), labels = feature_labels[rev(feature_order)], expand = expansion(add = 0.5)) +
  labs(x = "Conditional SHAP value (degree C)", y = NULL, colour = "Feature value") +
  theme(axis.line.y = element_blank(), axis.ticks.y = element_blank(), legend.position = "right")

fig_global_shap <- p_shap_importance + p_shap_distribution +
  plot_layout(widths = c(0.88, 1.22)) +
  plot_annotation(tag_levels = "a")
save_publication(fig_global_shap, "fig_conditional_shap_global", 183, 83)
save_publication(p_shap_importance, "fig_conditional_shap_importance", 89, 62)

ordering <- shap_values %>%
  arrange(CowKey, Time_hour, ConditionalFullPipelinePrediction_C) %>%
  mutate(Instance = row_number())
heat_long <- ordering %>%
  select(Instance, SHAP_Ear_temperature_C, SHAP_Ambient_temperature_C, SHAP_Time_diurnal_C, SHAP_Cow_identity_C) %>%
  pivot_longer(cols = -Instance, names_to = "SHAPColumn", values_to = "SHAP_C") %>%
  left_join(feature_spec %>% select(FeatureGroup, SHAPColumn), by = "SHAPColumn") %>%
  mutate(FeatureGroup = factor(FeatureGroup, levels = rev(feature_order)))
heat_limit <- max(abs(heat_long$SHAP_C))

p_prediction_strip <- ggplot(ordering, aes(x = Instance, y = ConditionalFullPipelinePrediction_C)) +
  geom_line(linewidth = 0.35, colour = "#222222") +
  labs(x = NULL, y = "Predicted core\n(degree C)") +
  theme(axis.text.x = element_blank(), axis.ticks.x = element_blank(), plot.margin = margin(3, 7, 0, 4))

p_heatmap <- ggplot(heat_long, aes(x = Instance, y = FeatureGroup, fill = SHAP_C)) +
  geom_tile() +
  scale_fill_gradient2(low = "#3B6EA8", mid = "white", high = "#B84A4A", midpoint = 0, limits = c(-heat_limit, heat_limit)) +
  scale_y_discrete(labels = feature_labels) +
  labs(x = "503 OOF records ordered by animal identity and sampling time", y = NULL, fill = "Conditional\nSHAP (degree C)") +
  theme(axis.line = element_blank(), axis.ticks.y = element_blank(), plot.margin = margin(0, 7, 4, 4))

fig_heatmap <- p_prediction_strip / p_heatmap + plot_layout(heights = c(0.72, 1.55))
save_publication(fig_heatmap, "fig_conditional_shap_heatmap", 183, 78)

dependence_spec <- data.frame(
  Feature = c("Ear-surface temperature", "Ambient temperature", "Sampling time"),
  X = c("Ear_C", "Air_C", "Time_hour"),
  Y = c("SHAP_Ear_temperature_C", "SHAP_Ambient_temperature_C", "SHAP_Time_diurnal_C"),
  Colour = c("EarAirGap_C", "Time_hour", "Air_C"),
  XLabel = c("Ear-surface temperature (degree C)", "Ambient temperature (degree C)", "Sampling time (h)"),
  ColourLabel = c("Ear-air gap", "Sampling time", "Ambient temperature"),
  stringsAsFactors = FALSE
)

dependence_plots <- lapply(seq_len(nrow(dependence_spec)), function(i) {
  spec <- dependence_spec[i, ]
  plot_data <- data.frame(
    X = shap_values[[spec$X]],
    SHAP_C = shap_values[[spec$Y]],
    ColourValue = shap_values[[spec$Colour]]
  )
  ggplot(plot_data, aes(x = X, y = SHAP_C, colour = ColourValue)) +
    geom_hline(yintercept = 0, linewidth = 0.35, linetype = "22", colour = "#777777") +
    geom_point(size = 0.8, alpha = 0.62) +
    geom_smooth(method = "loess", formula = y ~ x, se = FALSE, linewidth = 0.7, colour = "#B84A4A") +
    scale_colour_gradient(low = "#3B6EA8", high = "#D97757") +
    labs(x = spec$XLabel, y = "Conditional SHAP value (degree C)", colour = spec$ColourLabel) +
    guides(colour = guide_colourbar(
      direction = "horizontal",
      title.position = "top",
      barwidth = grid::unit(18, "mm"),
      barheight = grid::unit(2.2, "mm")
    )) +
    theme(legend.position = "top", legend.justification = "left")
})

fig_dependence <- wrap_plots(dependence_plots, nrow = 1) + plot_annotation(tag_levels = "a")
save_publication(fig_dependence, "fig_conditional_shap_dependence", 183, 69)

generated <- list.files(OUTPUT_DIR, pattern = "\\.(svg|pdf|tiff|png)$", full.names = TRUE)
expected_stems <- c(
  "fig_ablation_mechanism_validation",
  "fig_ablation_oof_trajectories",
  "fig_conditional_shap_global",
  "fig_conditional_shap_importance",
  "fig_conditional_shap_heatmap",
  "fig_conditional_shap_dependence"
)
if (length(generated) != length(expected_stems) * 4L || any(file.info(generated)$size <= 0)) {
  stop("Figure export contract failed")
}
cat("FIGURE_STATUS=PASS\n")
cat("FIGURE_COUNT=", length(expected_stems), "\n", sep = "")
cat("FILE_COUNT=", length(generated), "\n", sep = "")
cat("OUTPUT_DIR=", OUTPUT_DIR, "\n", sep = "")
