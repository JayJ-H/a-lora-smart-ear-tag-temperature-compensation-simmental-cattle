# 机制消融

```bash
python 分析/消融/run_ablation.py
python 分析/消融/test_ablation.py
```

程序在固定外层折上计算Full A+B+C及三种去除单分支配置，并按各自规则重新完成候选选择和嵌套Ridge拟合。输入均已匿名化并按行对齐，哈希见`数据/元数据/ablation_provenance_manifest.csv`。
