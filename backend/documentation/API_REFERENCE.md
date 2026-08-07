# API reference

The backend provides authentication, health, version, system-status, database-RPC, and cattle-domain routes. The adjacent CSV lists the registered top-level HTTP endpoints present in the source tree.

MQTT ingestion runs in the backend process. It parses configured temperature topics, normalizes payload fields, resolves the cattle and gateway records, stores sensor readings, logs the MQTT message, and applies the configured temperature-alert rules.

The generic RPC surface is table-driven. Refer to the backend source and the frontend/backend database contract for request payloads and field definitions.
