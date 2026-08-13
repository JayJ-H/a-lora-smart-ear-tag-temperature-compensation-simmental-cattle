# TH-SHRC integration status

The standalone validation package contains the reproducible TH-SHRC/stacked
compensation pipeline and validated model outputs. The released local
Web/backend source also contains a frozen deployment asset at
`backend/source_code/scripts/assets/th-shrc/runtime-model-v3-exact.json`.
`mysql-backend-server.mjs` calls that runtime from the MQTT temperature
ingestion handler and persists the raw payload, compensation metadata,
compensated temperature, and `body_temperature` reading.

`scripts/check-th-shrc-live.mjs` publishes one unique MQTT message and checks
the API, MySQL sensor row, body-temperature reading, and MQTT message log. That
local smoke path passed on Windows for this release. It proves the local
MQTT -> TH-SHRC -> MySQL path, but it does not prove a remote production
installation, Linux execution on another host, or hardware/firmware behavior.
The reference and production Docker configurations therefore remain deployment
references rather than claims of a validated production service.

Figure 4 should be read with this boundary: the model stage is locally
implemented and verified, while the production-host and hardware evidence
remain outside this release.
