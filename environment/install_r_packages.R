packages <- c("MASS", "dplyr", "e1071", "gbm", "ggplot2", "jsonlite", "mgcv", "patchwork", "ragg", "svglite", "tibble", "tidyr", "xgboost")
missing <- packages[!vapply(packages, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) install.packages(missing, repos = "https://cloud.r-project.org")
cat("R package check complete. Installed/available:", paste(packages, collapse = ", "), "\n")
