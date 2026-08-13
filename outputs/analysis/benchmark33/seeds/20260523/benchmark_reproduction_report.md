# 33-model benchmark

Models: 33; rows per model: 520; elapsed: 1072.6 s.

| Model | R2 | RMSE (C) | MAE (C) |
|---|---:|---:|---:|
| TH-SHRC | 0.8370 | 0.3080 | 0.1724 |
| GA_SVR_RBF | 0.7575 | 0.3757 | 0.2384 |
| SVR_RBF | 0.7447 | 0.3854 | 0.2424 |
| PolynomialRidge | 0.7381 | 0.3903 | 0.2586 |
| MultipleLinear | 0.7321 | 0.3948 | 0.2595 |
| GWO_ExtraTrees | 0.7311 | 0.3956 | 0.2543 |
| DE_XGBoost | 0.7302 | 0.3962 | 0.2594 |
| ElasticNet | 0.7292 | 0.3969 | 0.2626 |
| Ridge | 0.7292 | 0.3969 | 0.2640 |
| BayesianRidge | 0.7292 | 0.3969 | 0.2640 |
| SplineRidge_GAMLike | 0.7280 | 0.3978 | 0.2742 |
| Lasso | 0.7269 | 0.3986 | 0.2647 |

Validation: fold-seed-aligned same-cow random five-fold OOF. Hyperparameter search uses training-fold data only.
