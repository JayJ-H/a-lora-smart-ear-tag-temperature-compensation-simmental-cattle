# Data files

- `raw_anonymized/`: 503 paired temperature records and 4,000 packet-level LoRa records;
- `processed/`: OOF predictions, benchmark tables, mechanism inputs/results, SHAP values, and link-quality records;
- `metadata/`: dictionaries, hashes, selection counts, and source-to-package transformations.

Research tables use anonymous `CowKey` values. The core-temperature reference is
intravaginal thermometry. Field definitions, selection counts, and source
transformations are in `metadata/`.
