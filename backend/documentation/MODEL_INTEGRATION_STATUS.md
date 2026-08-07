# TH-SHRC runtime integration

The released platform includes the TH-SHRC runtime asset at `backend/source_code/scripts/assets/th-shrc/runtime-model-v2-exact.json`. The MQTT temperature-ingestion path calls the runtime, stores compensation metadata, and writes the compensated temperature together with the corresponding sensor record.

`scripts/check-th-shrc-live.mjs` provides an end-to-end local check covering MQTT publication, API retrieval, MySQL sensor storage, compensated body-temperature storage, and MQTT message logging.
