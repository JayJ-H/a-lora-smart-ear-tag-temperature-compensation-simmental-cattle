# Interpretability analyses

```bash
python analysis/interpretability/run_native_stack_shap.py
python analysis/interpretability/verify_conditional_shap.py
```

`run_native_stack_shap.py` calculates fold-wise linear SHAP values for the three-input ridge stack. `verify_conditional_shap.py` checks the four-group conditional SHAP table and additivity. The R scripts provide the longer conditional replay and analytical plots.
