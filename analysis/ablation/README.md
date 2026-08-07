# Mechanism ablation

```bash
python analysis/ablation/run_ablation.py
python analysis/ablation/test_ablation.py
```

The analysis evaluates Full A+B+C and the three remove-one configurations with the fixed outer folds. Each configuration repeats its specified candidate selection and nested ridge fit. Inputs are anonymous and row-aligned; hashes are listed in `data/metadata/ablation_provenance_manifest.csv`.
