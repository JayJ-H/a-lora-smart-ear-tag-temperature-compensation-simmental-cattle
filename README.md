# LoRa smart ear-tag and TH-SHRC reproducibility repository

This repository accompanies *A LoRa smart ear-tag system with a stacked
temperature-compensation model for ear-surface thermometry in Simmental cattle*.
It contains anonymized research data, fixed result tables, reproduction code,
hardware and firmware files, management-platform source, and figure source files.

## Research results

- 503 paired temperature observations from 30 anonymous `CowKey` animals;
- same-cow random five-fold out-of-fold validation;
- TH-SHRC: R2 `0.8551359051012453`, RMSE `0.25195565941200593 C`,
  MAE `0.1345534257161156 C`, and absolute-error <= 0.5 C proportion
  `0.9423459244532804`;
- 4,000 LoRa packet trials, with 3,751 received and 249 lost;
- overall PDR `0.93775`, 200 m PDR `0.93875`, and 250 m PDR `0.83125`.

## Quick verification

```bash
python -m venv .venv
python -m pip install -r environment/requirements-quick.txt
python run_all_checks.py
```

See `REPRODUCE.md` for the individual analysis commands.

## Platform source

`backend/source_code/` contains:

- the Vue 3, TypeScript, Vite, Element Plus, and ECharts Web client;
- the Node.js/Express API and MySQL persistence layer;
- MQTT uplink ingestion, animal-tag mapping, temperature and link-record storage;
- the TH-SHRC runtime integration, alert handling, and gateway-control interfaces;
- MySQL initialization and migration files, local and container deployment files;
- environment templates, validation scripts, and the retained third-party license.

## Repository contents

- `data/`: temperature, LoRa, benchmark, ablation, and SHAP tables;
- `analysis/` and `scripts/`: model reproduction, verification, and Fig. 15-17 plotting;
- `hardware/`: ear-tag and gateway CAD, PCB, schematic, and enclosure files;
- `firmware/`: ear-tag and gateway ESP-IDF source plus the 3-byte protocol;
- `backend/source_code/`: management-platform source;
- `backend/reference/`: schema and interface reference for the paper data path;
- `outputs/`: verification and analysis outputs.

## Figure source and reproduction source

The figure materials are organized as follows:

- `analysis/manuscript_figures/reproduction_sources/`: inputs, plotting scripts,
  component assets, and generated panels for each figure.
- `analysis/manuscript_figures/source_assets/`: editable Illustrator, SVG, Origin,
  and CAD sources.
- `analysis/manuscript_figures/figure_reproduction_manifest.csv`: figure input,
  script, and output mapping.
- `analysis/manuscript_figures/editable_source_manifest.csv`: editable-source mapping.

Figure-specific notes are in `analysis/manuscript_figures/reproduction_sources/figXX/README.md`.
