# 33-model benchmark

Models: 33; rows per model: 520; elapsed: 1068.1 s.

| Model | R2 | RMSE (C) | MAE (C) |
|---|---:|---:|---:|
| TH-SHRC | 0.8437 | 0.3016 | 0.1692 |
| GA_SVR_RBF | 0.7513 | 0.3804 | 0.2392 |
| DE_XGBoost | 0.7422 | 0.3873 | 0.2558 |
| GWO_ExtraTrees | 0.7401 | 0.3888 | 0.2400 |
| DE_GradientBoosting | 0.7399 | 0.3890 | 0.2658 |
| PolynomialRidge | 0.7337 | 0.3936 | 0.2605 |
| SplineRidge_GAMLike | 0.7279 | 0.3979 | 0.2725 |
| ExtraTrees | 0.7253 | 0.3998 | 0.2432 |
| MultipleLinear | 0.7204 | 0.4033 | 0.2646 |
| ElasticNet | 0.7196 | 0.4039 | 0.2664 |
| Ridge | 0.7194 | 0.4041 | 0.2676 |
| BayesianRidge | 0.7190 | 0.4043 | 0.2678 |

Validation: fold-seed-aligned same-cow random five-fold OOF. Hyperparameter search uses training-fold data only.
