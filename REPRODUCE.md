# Reproduction commands

Run commands from the repository root.

## Quick verification

```bash
python -m pip install -r environment/requirements-quick.txt
python run_all_checks.py
```

The quick command checks the 1,129-to-503 selection trace, the final stack,
reported metrics, mechanism ablations, packet encoding, radio parameters, and
figure and platform assets.

## Individual analyses

```bash
python scripts/verify_results.py
python scripts/run_temperature_analysis.py --verify-docs
python analysis/ablation/run_ablation.py
python analysis/ablation/test_ablation.py
python analysis/benchmark_models/test_benchmark.py
python analysis/benchmark_models/replay_benchmark.py
python analysis/interpretability/run_native_stack_shap.py
python analysis/interpretability/verify_conditional_shap.py
python analysis/figures/plot_fig15_17_public.py
```

Numerical tolerances:

- final stack prediction difference: `1e-10 °C`;
- w/o A, w/o B, and w/o C prediction difference: `1e-8 °C`;
- PDR is recalculated from all 4,000 packet rows.

## Benchmark models

```bash
python -m pip install -r environment/requirements-full.txt
python analysis/benchmark_models/run_benchmark.py
```

## R-dependent stages

```bash
Rscript environment/install_r_packages.R
python run_analysis_pipeline.py --shap-mode smoke
```

Use `--shap-mode full` for all 503 conditional-SHAP targets. Runtime metadata
and stage results are written to `outputs/`.

## Management-platform source checks

```bash
cd backend/source_code
node scripts/validate-th-shrc-exact-reference.mjs
node scripts/validate-th-shrc-runtime.mjs
node --check scripts/mysql-backend-server.mjs
```

After installing the front-end dependencies, run:

```bash
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run build
```

Local MySQL, API, front-end, and MQTT entry points are listed in
`backend/source_code/README.md`.
