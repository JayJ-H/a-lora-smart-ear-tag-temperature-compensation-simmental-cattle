# 33-model benchmark

```bash
python analysis/benchmark_models/run_benchmark.py
python analysis/benchmark_models/plot_benchmark.py
```

All models use the same 503 rows and outer `FoldID`. Hyperparameters are selected inside each outer-training split. Outputs are written to `outputs/analysis/benchmark/`.

Fixed-choice refit:

```bash
python analysis/benchmark_models/replay_benchmark.py
```

This refits all 33 models with the saved evolutionary choices. Metric verification uses a tolerance of 0.025.
