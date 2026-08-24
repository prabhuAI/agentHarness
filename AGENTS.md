# AGENTS.md

Guidance for AI coding agents working in this repository. (`CLAUDE.md` is a symlink to this file, so Claude Code reads the same content.) For the full product strategy, architecture rationale, and the six-stage execution loop, see **[PRD.md](PRD.md)** — this file is the operational summary.

## What this is

**AgentCofounder / CompileKit** — a token-aware autonomous product compiler. It takes a raw, informal startup idea and produces a working, tested, persistent micro-application runnable at `http://localhost:3000` via `npm run dev`, with no human intervention.

Core thesis (see [PRD.md](PRD.md) §2, §51–53): **LLMs resolve ambiguity; deterministic software handles known engineering patterns.** One model call converts the idea into a compact **Product IR**; deterministic code compiles the IR into a real app and verifies it.

```
Idea → Product IR (1 model call) → normalize + validate → capability router
     → deterministic compiler (+ selective LLM for novel features)
     → automated QA journeys → deterministic repair (LLM fallback) → VERIFIED APP
     → idea_spec.json + summary.md + trace.jsonl + result.json
```

## Runtime constraints (do not violate)

- **Node 22.19.x only.** The engine is deliberately strict; `npm ci` fails on Node 23+. Use `.nvmrc`.
- **npm 10.9.3**, matching the committed lockfiles.
- **Pi is pinned** at `@earendil-works/pi-coding-agent@0.84.1`. Do **not** run `pi update` or use the floating shell installer.
- **Never commit credentials.** The runner intentionally does **not** load `.env` files; `.env.example` only documents variable names. Provider keys (e.g. `BERGET_API_KEY`) are read from the shell at runtime, never written into the repo.

## Common commands

| Command | Purpose |
|---|---|
| `npm run check` | Repository gate: `typecheck` + `test` + `app:test` + `app:build`. A scored release additionally requires the challenge run, result validation, and frozen evidence. |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `solution/`, `benchmarks/`, `test/`. |
| `npm test` | Vitest unit/integration suite. |
| `npm run test:golden` | Golden-transcript replay tests (`test/golden/`). |
| `npm run test:golden:record` | Re-record golden snapshots (`UPDATE_GOLDEN=1`). Only when a change is intentional. |
| `npm run challenge` | Full run against `contract-public/development-idea.txt`. Override with `-- --idea-file <path>`. |
| `npm run challenge -- --prepare-only` | Reset the app from the seed without calling a model. |
| `npm run dev` | Serve the generated app (`output/app`) at `http://localhost:3000`. Proxies to `output/app`; also works via `cd output/app && npm run dev`. |
| `npm run validate:result` | Validate a produced `result.json` against the schema. |
| `npm run benchmark` | Run the internal benchmark suite. |

App-template lives in its own npm project: `npm run app:test` / `npm run app:build` proxy into it via `--prefix app-template`.

## Repository boundaries

- **`solution/`** — the primary surface to change. Product IR schema/normalization (`ir/`), deterministic compiler (`compiler/`), application genomes (`genomes/`), QA journey derivation + failure classification (`qa/`), deterministic repair (`repair/`), token budget governor (`orchestrator/`), telemetry/trace (`telemetry/`), and the Pi tool + system prompt (`extensions/product-compiler.ts`, `system-prompt.md`). Provider metadata (no secrets) lives in `provider-config/models.json`.
- **`app-template/`** — neutral application seed (React + Vite + Vitest) copied into a fresh workspace each run. Driven by `product.config.json` / `product-config.ts`; UI never touches `localStorage` directly (goes through `repository.ts`).
- **`contract-public/`** — replaceable public idea, domain-neutral journey guidance, and `result.schema.json`. No hidden judging material belongs here.
- **`src/`** — baseline runner and auditable result assembly (`run-challenge.ts`, `result.ts`, `verify-app.ts`, `usage.ts`, telemetry reconciliation). Generally stable infrastructure.
- **`output/app/`** — disposable generated app, reset before every run (gitignored).
- **`artifacts/runs/`** — Pi events, session JSONL, stderr, run input (gitignored).
- **`test/golden/`** — fixtures (IR inputs) + expected snapshots for deterministic replay.

## Conventions

- **Deterministic-first.** Every model call must justify its weighted-token cost: `weighted = input + output×3 + cacheRead×0.1`. Default thinking level is `off`. Do not add optional model calls; prefer deterministic fixes and prompt caching.
- **Product IR is the contract** between intent and implementation. It describes product/entities/fields/capabilities/workflows/persistence — never React implementation details. Validate deterministically; correct trivial schema issues in code, not with another model call.
- **Field-type vocabulary** (see `extensions/product-compiler.ts`): `text, longText, number, currency, date, datetime, boolean, category, status, email, url`. A dropdown/single-select is `category`; a fixed lifecycle is `status`. Never emit `select`, `dropdown`, or `enum`.
- **No overfitting.** Reusable infrastructure must stay domain-neutral (`entity`, `field`, `category`, `filter`, `derivedValue`) — never Book-Tracker-specific behavior. No benchmark-specific hacks.
- **Never regenerate reusable boilerplate.** Send the coding model only the specific feature, relevant IR subset, interfaces, and acceptance criteria — not the whole repo.
- **Tests, not confidence, determine done.** A generated app is not finished just because it compiles. Telemetry must reconcile with real session usage, never model estimates.

## Related docs

- **[PRD.md](PRD.md)** — product strategy, architecture, IR spec, genomes, QA/repair, metrics, and the definition of done.
- **[README.md](README.md)** — setup, prerequisites, provider configuration, and run instructions.
- **[contract-public/README.md](contract-public/README.md)** — public contract, journey guidance, and `result.json` schema semantics.
- **[TEST_PLAN.md](TEST_PLAN.md)** — test strategy.
- **[test/golden/README.md](test/golden/README.md)** — golden-transcript harness.
