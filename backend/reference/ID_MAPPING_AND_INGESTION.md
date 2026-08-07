# ID mapping and ingestion

A tag is linked to an animal through `tag_registry` and `animal_tag_assignment`.
Incoming MQTT records are decoded, time-stamped, linked to the active
assignment, and stored in `thermal_reading` and `link_metric`. Public analysis
files use anonymous `CowKey` values.
