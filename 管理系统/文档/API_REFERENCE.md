# API reference and evidence boundary

The backend exposes explicit authentication, health, version, system-status, generic database-RPC, and cow-domain RPC routes. The adjacent CSV lists the registered top-level HTTP endpoints verified in source.

MQTT ingestion is implemented inside the same backend process rather than as an HTTP endpoint. It parses configured temperature topics, normalizes payload keys, resolves/creates the cow reference, creates or resolves a gateway device, stores sensor readings, logs the MQTT message, and may generate a temperature alert.

The full generic RPC method surface is large and table-driven. Refer to the sanitized backend source and the database frontend/管理系统 contract for exact request payloads. No passwords, database accounts, tokens, remote hosts, or private keys are included in this package.
