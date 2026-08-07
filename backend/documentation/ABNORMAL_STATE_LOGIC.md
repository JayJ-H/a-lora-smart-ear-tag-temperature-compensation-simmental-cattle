# Temperature alert logic

The backend classifies an incoming temperature record as critical at 40.5 °C or above, high at 40.0 °C or above, and also high at 39.8 °C or above when ambient temperature is at least 35 °C. A medium alert is produced at 39.5 °C or above when ambient temperature is at least 35 °C.

When a body-temperature field is supplied it is used as the main temperature; otherwise the ear-temperature field is used.
