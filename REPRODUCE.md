# Reproduction commands

Run from the repository root.

```bash
python -m pip install -r environment/requirements-quick.txt
python run_all_checks.py
```

For a complete analysis rerun:

```bash
python -m pip install -r environment/requirements-full.txt
python run_analysis_pipeline.py --full
python plot_manuscript_panels.py
```
