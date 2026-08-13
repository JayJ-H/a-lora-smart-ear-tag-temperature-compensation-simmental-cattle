# ID mapping and ingestion flow

## Ear-tag/cow mapping

The frontend normalizes multiple candidate cow-reference fields through `源代码/frontend/src/utils/cow-reference.ts`. MQTT ingestion normalizes the payload cow number, checks existing animal and cow records, and creates a review-required MQTT-origin record only when no existing mapping is found. The gateway itself encodes a six-bit device code and reconstructs the configured device ID by adding 51; a manuscript-facing mapping from that firmware device ID to the farm cow identifier still requires author confirmation.

## Raw ear-surface temperature ingestion

The backend parses MQTT JSON/text payloads, accepts aliases for ear, rectal/body, ambient, signal, and sender time fields, records raw MQTT metadata, and writes normalized sensor readings. The server receive time is retained separately from any sender time supplied in the payload.

## CowKey

The validation package uses `CowKey` as an 分析/source identifier. The production platform uses several cow/animal identifiers and normalization helpers. A single formally documented mapping table among firmware device ID, ear-tag number, platform cow ID, farm cow number, and analytical CowKey was not located.
