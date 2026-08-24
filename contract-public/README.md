# Public challenge contract

`development-idea.txt` is the runner's default, finalized public input. Hidden judging prompts remain outside this repository and are supplied through `--idea-file`; the runner accepts plain text as well as a JSON object containing `idea`, `description`, or `prompt`.

The domain-neutral [public journey guidance](journeys.md) helps identify common behaviors without making them mandatory for every idea. The input idea remains authoritative: implement every journey it details or implies, and omit unrelated features. The runner appends that exact guidance to Pi's system prompt, keeping participant documentation and runtime guidance aligned.

`result.schema.json` validates the complete final result emitted by this starter harness, not only the minimum fields from the challenge specification. It keeps product-journey records in `tests_run`; `success` requires at least one journey and every recorded journey must pass. The schema also requires the additional audit fields `harness_checks`, `reasoning_tokens`, `cost_total`, `pi_exit_code`, `telemetry_source`, and `port_reclamation`. A replacement runner may add fields but must preserve these fields and their semantics.

Official judging supplies a different idea and private browser journeys. No hidden prompt, selector, threshold, expected copy, or score implementation belongs in this public directory.
