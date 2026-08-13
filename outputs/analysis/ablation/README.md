# Strict TH-SHRC Mechanism Ablation

This analysis disables each mechanism before downstream selection and
refitting. It is not a post-hoc deletion of one saved branch-prediction column.

- A: thermal-state memory/retrieval. Disabling A removes lookup,
  empirical-Bayes, and session-memory routes; only direct Ridge and direct
  XGBoost routes remain.
- B: individual/session calibration. Disabling B removes cow- and
  session-conditioned routes; only non-cow pure thermal memory and global
  thermal cells remain.
- C: hierarchical residual correction. Disabling C removes the complete C
  route and refits the final nested Ridge learner using A and B.

Each configuration is rerun on five fixed outer OOF assignments. Candidate
and Ridge choices are learned from outer-training rows, then the five complete
OOF prediction streams are combined with the declared rowwise median rule.
The full configuration matches the frozen prediction within 1e-10 C.

The public Fig. 15 interval table uses 10,000 paired-record bootstrap
replicates to match the Chinese GitHub plotting package. A separate robustness
table uses 10,000 paired cow-cluster replicates to retain within-cow dependence.
