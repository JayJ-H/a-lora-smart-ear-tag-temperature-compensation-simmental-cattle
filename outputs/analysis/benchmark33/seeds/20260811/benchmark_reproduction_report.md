# 33-model benchmark

Models: 33; rows per model: 520; elapsed: 1053.2 s.

| Model | R2 | RMSE (C) | MAE (C) |
|---|---:|---:|---:|
| TH-SHRC | 0.8289 | 0.3155 | 0.1756 |
| GA_SVR_RBF | 0.7364 | 0.3916 | 0.2441 |
| DE_XGBoost | 0.7315 | 0.3953 | 0.2672 |
| DE_GradientBoosting | 0.7279 | 0.3979 | 0.2632 |
| PolynomialRidge | 0.7252 | 0.3998 | 0.2627 |
| LightGBM | 0.7231 | 0.4014 | 0.2725 |
| SplineRidge_GAMLike | 0.7187 | 0.4045 | 0.2765 |
| GWO_ExtraTrees | 0.7147 | 0.4074 | 0.2542 |
| ExtraTrees | 0.7124 | 0.4091 | 0.2464 |
| Ridge | 0.7123 | 0.4091 | 0.2712 |
| Lasso | 0.7123 | 0.4091 | 0.2713 |
| BayesianRidge | 0.7121 | 0.4092 | 0.2712 |

Validation: fold-seed-aligned same-cow random five-fold OOF. Hyperparameter search uses training-fold data only.
