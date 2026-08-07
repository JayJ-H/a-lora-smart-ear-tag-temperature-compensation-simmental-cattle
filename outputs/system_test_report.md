# System static checks

Overall: **PASS**

| Check | Status | Detail |
|---|---|---|
| `protocol_known_vectors` | PASS | 3 fixed vectors matched |
| `protocol_roundtrips` | PASS | 1715 roundtrips matched |
| `radio_parameter_alignment` | PASS | frequency bandwidth spreading factor coding rate sync preamble header and CRC agree |
| `firmware_sources` | PASS | ear-tag and gateway ESP-IDF sources and configuration constants verified |
| `system_asset_manifest` | PASS | 562 asset hashes verified |
| `backend_reference` | PASS | scoped backend schema and interface files verified |
| `backend_platform` | PASS | 12 full-platform source entry points verified |
| `mysql_bootstrap` | PASS | single cattle_management bootstrap chain verified |
| `node_syntax` | PASS | Node syntax passed for 69 files |
| `th_shrc_runtime_timezone` | PASS | TH-SHRC runtime validation passed in UTC and Asia/Shanghai |
| `package_script_paths` | PASS | 36 package scripts checked |
| `production_template` | PASS | deployment configuration verified |
