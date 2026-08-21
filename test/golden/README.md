# Golden transcripts

A keyless regression gate for the deterministic compile pipeline, modeled on
DeepSeek Harness's snapshot replay (`test:snapshot` / `test:snapshot:record`).

Each fixture in `fixtures/` is a recorded `compile_product` input — the Product
IR the model emitted for one idea. The harness replays that IR through the
**production** deterministic path (validate → normalize → route → derive
journeys → compile artifacts) with no model call and no `npm` run, then compares
the result to the committed snapshot in `expected/`.

This locks everything a prompt, schema, genome, design, or compiler change can
move — routing decisions, auto-derived per-option filters and counts, resolved
design, generated artifacts, and derived journeys — so a regression shows up as a
reviewable diff instead of a silent change discovered only in a live benchmark run.

## Commands

```sh
npm run test:golden          # verify against committed snapshots (also runs in `npm test` / `npm run check`)
npm run test:golden:record   # re-record snapshots after an intended change
```

## Workflow

1. Change a prompt, schema, genome, design rule, or compiler step.
2. Run `npm run test:golden`. A failure prints the exact artifact diff.
3. If the change is intended, run `npm run test:golden:record` and review the
   resulting `expected/*.snapshot.json` diff before committing it.

## Adding a transcript

Record a real Product IR from an actual model run (or hand-write one that mirrors
model output) and drop it in `fixtures/<name>.json` as `{ "idea": "...", "ir": { ... } }`.
Then run `npm run test:golden:record` to mint its snapshot. Prefer fixtures that
cover distinct genomes and routes; `roadmap-graph-hybrid.json` locks the hybrid
routing decision rather than a compile pass.
