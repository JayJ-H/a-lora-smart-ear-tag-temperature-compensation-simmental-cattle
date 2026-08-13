# 复现命令

在仓库根目录运行：

```bash
python -m pip install -r environment/requirements-quick.txt
python run_all_checks.py
```

完整重跑：

```bash
python -m pip install -r environment/requirements-full.txt
python run_analysis_pipeline.py --full
python plot_manuscript_panels.py
```
