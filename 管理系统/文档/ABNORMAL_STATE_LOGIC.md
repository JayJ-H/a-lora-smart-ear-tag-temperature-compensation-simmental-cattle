# Temperature-defined abnormal-state logic

## Current backend single-record logic

The backend classifies one incoming temperature record as:

- critical at main temperature >= 40.5 C;
- high at main temperature >= 40.0 C, or >= 39.8 C when ambient temperature >= 35 C;
- medium at main temperature >= 39.5 C when ambient temperature >= 35 C.

It uses rectal/body temperature when supplied, otherwise ear temperature. This is a software alert rule, not a veterinary diagnosis.

## Validation-package temporal rule

The validation package separately evaluates a temperature-defined abnormal state using at least two positive observations within a three-hour window at the 39.5 C threshold. This temporal rule is not the same as the current backend single-record classifier and was not found as a production-integrated rule.

The manuscript must distinguish these two implementations or update the platform before claiming exact deployment of the validated temporal rule.
