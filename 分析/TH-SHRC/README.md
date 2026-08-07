# TH-SHRC分析

堆叠复现：

```bash
python 脚本/run_temperature_analysis.py --verify-docs
```

流程重训：

```bash
python 分析/TH-SHRC/reproduce_full_pipeline.py --rscript Rscript
```

堆叠输入：热记忆、个体/时段校准和层级残差三组OOF预测。结果：R² `0.8551359051`、RMSE `0.2519556594 ℃`、MAE `0.1345534257 ℃`，94.23%的记录绝对误差不超过0.5 ℃。
