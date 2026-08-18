# PRD Implementation Status

## Implemented

| PRD capability | Implementation |
|---|---|
| Raw idea interpretation | One structured `compile_product` call with a strict Product IR schema |
| Product IR | Types, validation, normalization, canonical persistence defaults, and generated `product-ir.json` |
| Genomes | Tracker, workflow, catalog, planner, and dashboard profiles |
| Capability routing | Compile, hybrid, and custom routes with explicit unsupported requirements |
| Deterministic compiler | Product IR to `product.config.json` and required artifacts |
| Runtime | Accessible responsive CRUD, field validation, search, filters, sorting, category/status grouping, summaries, and local persistence |
| API readiness | Repository interface isolates storage from UI |
| Autonomous QA | Journeys derived from Product IR plus a configuration-driven runtime test |
| Self-review | Tests and production build execute inside the compiler tool and independently in the outer harness |
| Repair | Failure classification, known configuration repair, targeted fallback, and two-attempt ceiling |
| Token governor | Green/yellow/red policy, route estimates, stable prompt prefix, GLM chat-template thinking-off control |
| Telemetry | Audited Pi events, call log reconciliation, and official weighted-token calculation |
| Artifacts | `idea_spec.json`, `product-ir.json`, `summary.md`, `trace.jsonl`, partial report, and final result |
| Benchmarking | 120 diverse raw ideas, public benchmark fixture, per-run metrics, incremental JSON report |
| Launch Mode | Optional deterministic launch kit after verified pass |

## Verified acceptance run

The public development prompt was executed on 2026-08-18 through Berget `zai-org/GLM-5.2` in the pinned Node.js 22.19.0 Docker image.

| Measure | Audited result |
|---|---:|
| Final status | success |
| Build route | compile |
| Model calls | 1 |
| Input tokens | 185 |
| Output tokens | 679 |
| Cache-read tokens | 2,944 |
| Reasoning tokens | 0 |
| Weighted token expenditure | 2,516.4 |
| Derived journeys | 10/10 passed |
| Outer harness checks | 4/4 passed |

`output/app/result.json` passes the committed telemetry validator. The clean image build runs the root suite, grouped public fixture, application journey, and production build before creating the runtime image.

## Pending external validation

These remaining acceptance items require repeated competition-model runs:

- Run the 120-idea model benchmark and verify the PRD targets: >90% final success, >80% first-pass success, >98% build and persistence success, median one normal model call, and <15% repair frequency.
- Tune prompts and schema from measured failures without introducing benchmark vocabulary into reusable modules.
- Submit the final public repository and competition entry.

## Completion rule

Do not mark the competition submission complete until the external benchmark targets pass and the public repository is submitted.
