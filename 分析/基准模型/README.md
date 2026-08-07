# 33模型对比

```bash
python 分析/基准模型/run_benchmark.py
python 分析/基准模型/plot_benchmark.py
```

所有模型使用相同503条记录和外层`FoldID`，超参数仅在各外层训练折内部选择。输出位于`输出/分析/基准模型/`。

固定搜索结果重拟合：

```bash
python 分析/基准模型/replay_benchmark.py
```

该命令使用保存的进化搜索参数重拟合33个模型。
