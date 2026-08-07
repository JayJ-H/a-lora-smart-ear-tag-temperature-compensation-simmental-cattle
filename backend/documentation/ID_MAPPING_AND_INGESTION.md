# ID mapping and ingestion flow

## Ear-tag and cattle mapping

The frontend normalizes cattle-reference fields through `source_code/frontend/src/utils/cow-reference.ts`. MQTT ingestion normalizes the incoming cattle reference, resolves existing animal and cattle records, and creates a review record when a mapping is absent. The gateway encodes a six-bit device code and reconstructs the configured device ID according to the firmware mapping rule.

## Temperature ingestion

The backend accepts ear, body/reference, ambient, signal, and sender-time field aliases. It stores normalized sensor readings together with MQTT topic, raw payload metadata, server receive time, RSSI, and SNR.

## Analysis identifier

The public research tables use anonymous `CowKey` values. Platform cattle identifiers and farm-facing identifiers remain separate from the anonymous analysis identifier.
