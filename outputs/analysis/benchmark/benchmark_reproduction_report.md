# 33-model benchmark reference

| Model | R² | RMSE (°C) | MAE (°C) |
|---|---:|---:|---:|
| TH_SHRC | 0.8551 | 0.2520 | 0.1346 |
| DE_XGBoost | 0.7342 | 0.3413 | 0.2413 |
| DE_GradientBoosting | 0.7062 | 0.3588 | 0.2507 |
| LightGBM | 0.6784 | 0.3754 | 0.2754 |
| ExtraTrees | 0.6361 | 0.3994 | 0.2613 |
| XGBoost | 0.6226 | 0.4067 | 0.3118 |
| BaggedTree | 0.6202 | 0.4079 | 0.2869 |
| RandomForest | 0.6187 | 0.4088 | 0.2895 |
| PSO_RandomForest | 0.6156 | 0.4105 | 0.3010 |
| GWO_ExtraTrees | 0.5768 | 0.4307 | 0.3074 |
| HistGradientBoosting | 0.5720 | 0.4331 | 0.3270 |
| GA_SVR_RBF | 0.5684 | 0.4349 | 0.2952 |

Rows per model: 503. Validation: same-cow random five-fold OOF.

Fixed-choice refit results are stored in `../benchmark_replay/benchmark_replay_verification.json`.
