# 33-model benchmark

Models: 33; rows per model: 520; elapsed: 1143.2 s.

| Model | R2 | RMSE (C) | MAE (C) |
|---|---:|---:|---:|
| TH-SHRC | 0.8404 | 0.3048 | 0.1690 |
| GA_SVR_RBF | 0.7626 | 0.3717 | 0.2302 |
| DE_XGBoost | 0.7572 | 0.3758 | 0.2525 |
| SVR_RBF | 0.7539 | 0.3784 | 0.2410 |
| GWO_ExtraTrees | 0.7533 | 0.3788 | 0.2331 |
| DE_GradientBoosting | 0.7472 | 0.3835 | 0.2577 |
| ExtraTrees | 0.7415 | 0.3878 | 0.2381 |
| PolynomialRidge | 0.7374 | 0.3908 | 0.2584 |
| SplineRidge_GAMLike | 0.7348 | 0.3928 | 0.2706 |
| XGBoost | 0.7273 | 0.3983 | 0.2860 |
| MultipleLinear | 0.7258 | 0.3995 | 0.2608 |
| ElasticNet | 0.7255 | 0.3996 | 0.2639 |

Validation: fold-seed-aligned same-cow random five-fold OOF. Hyperparameter search uses training-fold data only.
