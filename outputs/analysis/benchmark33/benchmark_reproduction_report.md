# 33-model five-seed benchmark

Each strategy was evaluated under the same five fixed OOF fold seeds; formal predictions are rowwise medians.
This is a modeling-strategy comparison, not an equal-information-budget comparison, because TH-SHRC includes lag and acquisition-session features.

| Model | R2 | RMSE (C) | MAE (C) |
|---|---:|---:|---:|
| TH-SHRC | 0.8495 | 0.2960 | 0.1610 |
| GA_SVR_RBF | 0.7613 | 0.3726 | 0.2298 |
| DE_XGBoost | 0.7586 | 0.3748 | 0.2486 |
| DE_GradientBoosting | 0.7579 | 0.3753 | 0.2512 |
| SVR_RBF | 0.7512 | 0.3805 | 0.2384 |
| GWO_ExtraTrees | 0.7506 | 0.3809 | 0.2361 |
| ExtraTrees | 0.7419 | 0.3875 | 0.2360 |
| PolynomialRidge | 0.7396 | 0.3892 | 0.2568 |
| LightGBM | 0.7384 | 0.3901 | 0.2651 |
| SplineRidge_GAMLike | 0.7356 | 0.3922 | 0.2694 |
| MultipleLinear | 0.7302 | 0.3962 | 0.2589 |
| ElasticNet | 0.7286 | 0.3973 | 0.2617 |
