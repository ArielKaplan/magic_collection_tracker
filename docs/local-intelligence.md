# Mana Local Intelligence

Mana Local Intelligence is an optional, embedded inference engine for Mana Ledger. It is disabled by default and can be enabled only through **Settings → Features → Local Intelligence**. Enabling it also enables the Insights workspace it lives within.

## Privacy and execution

- Inference runs inside the installed application.
- It makes no network requests and requires no API key or model account.
- Collection records are not uploaded, retained as training examples, or shared between users.
- Disabling the feature hides the workspace. It does not delete reports or collection data.

## Model jobs

The bundled `mana-local-intelligence` v1 model is a small, explainable hybrid ensemble rather than a general-purpose language model.

1. **Local Data Guardian** combines schema checks with robust historical outlier statistics. It reviews owned records and aggregated Secret Lair source quality, then flags records for human inspection.
2. **Cross-source entity matcher** uses normalized-name, token, trigram, number, finish, and grouping features to score possible joins between owned sealed products and the exact Secret Lair product model.
3. **Opportunity attention model** re-ranks existing deterministic scanner signals using magnitude, direct user intent, evidence quality, and product-identity exactness.
4. **Natural-language report interpreter** classifies a request into one supported local dataset and extracts bounded filters and sorting. The interpreted recipe is always displayed beside its results.

## Boundaries

- Scores are review priorities, not future-price forecasts or financial advice.
- Match suggestions never create or change links automatically.
- Guardian findings never rewrite prices or identities.
- Natural-language requests can only query supported local datasets and fields; the engine cannot browse or generate unconstrained answers.
- The deterministic Secret Lair product model and its source-confidence rules remain authoritative.
