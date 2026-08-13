# 33-model benchmark

Models: 33; rows per model: 520; elapsed: 1079.8 s.

| Model | R2 | RMSE (C) | MAE (C) |
|---|---:|---:|---:|
| TH-SHRC | 0.8499 | 0.2955 | 0.1676 |
| GA_SVR_RBF | 0.7646 | 0.3701 | 0.2299 |
| SVR_RBF | 0.7644 | 0.3702 | 0.2394 |
| DE_XGBoost | 0.7528 | 0.3792 | 0.2551 |
| DE_GradientBoosting | 0.7517 | 0.3801 | 0.2605 |
| LightGBM | 0.7449 | 0.3853 | 0.2660 |
| PolynomialRidge | 0.7421 | 0.3873 | 0.2570 |
| ExtraTrees | 0.7415 | 0.3878 | 0.2416 |
| GWO_ExtraTrees | 0.7404 | 0.3886 | 0.2480 |
| SplineRidge_GAMLike | 0.7380 | 0.3904 | 0.2695 |
| MultipleLinear | 0.7324 | 0.3946 | 0.2590 |
| ElasticNet | 0.7310 | 0.3956 | 0.2617 |

Validation: fold-seed-aligned same-cow random five-fold OOF. Hyperparameter search uses training-fold data only.
