# Unified result verification

Overall: **PASS** (18/18 checks passed)

| Group | Check | Status | Detail |
|---|---|---:|---|
| provenance | public_result_file_hashes | PASS | All 11 result files match the provenance manifest. |
| main_th_shrc | oof_design | PASS | 503 unique records, 30 CowKey values, and five within-cow random OOF folds. |
| main_th_shrc | official_oof_metrics | PASS | R2, RMSE, MAE, and 0.5 C coverage recomputed from all OOF predictions. |
| main_th_shrc | stored_residuals | PASS | Every stored residual equals Actual - Predicted. |
| benchmark | benchmark_shape | PASS | All 33 models contain one prediction for each of 503 records. |
| benchmark | benchmark_record_identity | PASS | Each model uses the same RowID and Actual values as the official OOF table. |
| benchmark | benchmark_metrics | PASS | All displayed benchmark metrics recomputed from row-level predictions. |
| benchmark | proposed_model_matches_official_oof | PASS | TH_SHRC benchmark predictions match the OOF reference. |
| ablation | ablation_record_identity | PASS | Ablation rows and the full A+B+C prediction match the official OOF table. |
| ablation | ablation_metrics | PASS | All four mechanism-level configurations were recomputed from 503 OOF rows. |
| ablation | ablation_bootstrap_reference_summary | PASS | The 10,000-replicate summary has valid intervals and point deltas consistent with the recalculated metrics. |
| shap | shap_record_identity | PASS | SHAP rows match the anonymous identity and measurement fields. |
| shap | shap_four_group_summary | PASS | Four displayed SHAP group summaries and their ranking were recomputed from 503 rows. |
| shap | shap_internal_additivity | PASS | Technical baseline plus four conditional SHAP groups reconstructs the conditional full-pipeline value. |
| shap | shap_official_oof_boundary | PASS | The conditional SHAP table reconstructs the conditional full-pipeline value; reported accuracy metrics are recomputed from the OOF predictions. |
| lora | packet_test_design | PASS | The packet table contains 5 distances x 8 directions x 100 packets. |
| lora | packet_delivery_ratio | PASS | PDR values were recomputed from all packet-level Received flags. |
| lora | packet_signal_consistency | PASS | Received and packet-loss flags are complementary; the 249 lost-packet 91 sentinels are preserved only in SourceSentinelValue and excluded from RSSI/SNR. |

Row-level inputs are used for TH-SHRC, benchmark, ablation, SHAP, and LoRa checks.
