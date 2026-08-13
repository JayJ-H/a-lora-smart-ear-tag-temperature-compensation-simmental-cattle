# LoRa smart ear-tag and TH-SHRC reproducibility repository

This repository contains 520 anonymized quality-controlled paired temperature
measurements, TH-SHRC reproduction code, a 33-model benchmark, mechanism
ablation, robustness analyses, conditional SHAP, manuscript figure sources,
and the associated hardware, firmware, and management-platform sources.

## Reference results

- Records: 520 from 30 anonymous cattle; source S01; SourceWeight=1.0
- Validation: measurement-unit-grouped, same-animal five-fold OOF; five fixed seeds
- TH-SHRC: R2=0.849451603205801; RMSE=0.295958360438717 C; MAE=0.161020758345253 C
- Absolute error <=0.5 C: 92.31%
- Benchmark: 33 models with 520 OOF predictions per model
- Conditional SHAP: four input domains and 520 records

## Quick verification

```bash
python -m pip install -r environment/requirements-quick.txt
python run_all_checks.py
```

## Full reproduction

```bash
python -m pip install -r environment/requirements-full.txt
python run_analysis_pipeline.py --full
python plot_manuscript_panels.py
```

The final Fig. 1-19 files are under
`analysis/manuscript_figures/source_assets/`. Plotting data, code, and the 23
program-generated panels are under
`analysis/manuscript_figures/reproduction_sources/`.

`backend/source_code/` contains the broader cattle-management platform. The
paper data path and runtime-model interface are documented under
`backend/reference/`.
