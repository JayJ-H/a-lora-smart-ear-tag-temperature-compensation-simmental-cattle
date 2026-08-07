# 统一结果验证

总体：**PASS**（18/18 项检查通过）

| 分组 | 检查项 | 状态 | 说明 |
|---|---|---:|---|
| provenance | public_result_file_hashes | PASS | 11 个结果文件均与来源清单一致。 |
| main_th_shrc | oof_design | PASS | 503 条唯一记录、30 个 CowKey，以及 5 个牛内随机 OOF 折。 |
| main_th_shrc | official_oof_metrics | PASS | 根据全部 OOF 预测重新计算 R2、RMSE、MAE 和 0.5 °C 覆盖率。 |
| main_th_shrc | stored_residuals | PASS | 每个已存残差均等于 Actual - Predicted。 |
| 基准模型 | benchmark_shape | PASS | 33 个模型均为 503 条记录各提供一个预测值。 |
| 基准模型 | benchmark_record_identity | PASS | 每个模型使用与官方 OOF 表相同的 RowID 和 Actual 值。 |
| 基准模型 | benchmark_metrics | PASS | 所有展示的基准指标均由逐行预测重新计算。 |
| 基准模型 | proposed_model_matches_official_oof | PASS | TH-SHRC 基准预测与 OOF 参考值一致。 |
| 消融 | ablation_record_identity | PASS | 消融逐行数据及完整 A+B+C 预测与官方 OOF 表一致。 |
| 消融 | ablation_metrics | PASS | 4 个机制配置均由 503 条 OOF 记录重新计算。 |
| 消融 | ablation_bootstrap_reference_summary | PASS | 10,000 次重复摘要的区间有效，点差值与重算指标一致。 |
| shap | shap_record_identity | PASS | SHAP 逐行数据与匿名标识及测量字段一致。 |
| shap | shap_four_group_summary | PASS | 4 个展示的 SHAP 分组摘要及其排序均由 503 条记录重新计算。 |
| shap | shap_internal_additivity | PASS | 技术基线加 4 个条件 SHAP 分组可重建条件全流程预测值。 |
| shap | shap_official_oof_boundary | PASS | 条件 SHAP 表重建条件全流程预测值；报告指标由 OOF 预测重新计算。 |
| lora | packet_test_design | PASS | 数据包表包含 5 个距离、8 个方向，每个组合 100 个数据包。 |
| lora | packet_delivery_ratio | PASS | PDR 由全部数据包级 Received 标志重新计算。 |
| lora | packet_signal_consistency | PASS | Received 与丢包标志互补；249 个丢包的 91 哨兵值仅保存在 SourceSentinelValue 中，不进入 RSSI/SNR。 |

TH-SHRC、基准模型、消融、SHAP 和 LoRa 检查均使用逐行输入数据。
