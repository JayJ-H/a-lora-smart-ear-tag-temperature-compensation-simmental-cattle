# TH-SHRC analysis

Final stack:

```bash
python scripts/run_temperature_analysis.py --verify-docs
```

Upstream branch retraining:

```bash
python analysis/th_shrc/reproduce_full_pipeline.py --rscript Rscript
```

The final stack uses the thermal-memory, individual/session calibration, and hierarchical residual OOF branches. Reference metrics are R² `0.8551359051`, RMSE `0.2519556594 °C`, MAE `0.1345534257 °C`, and 94.23% within 0.5 °C.
