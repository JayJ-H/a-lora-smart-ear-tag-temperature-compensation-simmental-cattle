# TH-SHRC temperature reproduction

| Item | Value |
|---|---:|
| Status | PASS |
| Rows | 503 |
| Cattle | 30 |
| R2 | 0.855135905101245 |
| RMSE (C) | 0.251955659412006 |
| MAE (C) | 0.134553425716116 |
| Absolute error <= 0.5 C | 0.942345924453280 |
| Maximum prediction difference (C) | 7.1054273576e-15 |
| Maximum stack-setting difference | 2.22044604925e-16 |
| Maximum metric difference | 1.11022302463e-16 |

Validation: same-cow random five-fold OOF. The command refits the nested ridge stack from the three branch-level OOF prediction columns.
