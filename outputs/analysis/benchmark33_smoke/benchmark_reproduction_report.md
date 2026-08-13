# 33-model benchmark

Models: 3; rows per model: 520; elapsed: 0.1 s.

| Model | R2 | RMSE (C) | MAE (C) |
|---|---:|---:|---:|
| TH-SHRC | 0.8370 | 0.3080 | 0.1724 |
| EarOnlyLinear | 0.0797 | 0.7318 | 0.5965 |
| MeanTrain | -0.0018 | 0.7634 | 0.6347 |

Validation: fold-seed-aligned same-cow random five-fold OOF. Hyperparameter search uses training-fold data only.
