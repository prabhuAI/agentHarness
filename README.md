# AgentCofounder starter

> Participant entry: **CompileKit** — a token-aware product compiler. One model call resolves product ambiguity into a compact configuration; deterministic software supplies polished application behavior and verification. See [PRD.md](PRD.md) for the product strategy.

A forkable baseline for the AgentCofounder challenge. It gives every team the same pinned Pi runtime, neutral web application seed, execution command, telemetry collector, and public contract while leaving the actual agent strategy participant-owned.

This repository installs Pi as a local dependency at exactly `@earendil-works/pi-coding-agent@0.84.1`. Do not use the floating shell installer and do not run `pi update` during the challenge.

## Repository boundary

- `solution/` is the main participant surface: change the prompt, extension, skill, or replace the runner strategy.
- `app-template/` is the neutral application seed copied into a fresh generated workspace for every run.
- `contract-public/` contains the replaceable public idea, domain-neutral journey guidance, and the result schema.
- `src/` is the baseline runner and auditable result assembly.
- `output/app/` is disposable generated application code and is reset before every run.
- `artifacts/runs/` contains Pi JSON events, session JSONL files, stderr, and the run input.

Official hidden prompts, hidden tests, model credentials, and final scoring code must remain outside participant repositories.

`contract-public/development-idea.txt` contains the finalized published book-lending prompt. Hidden judging ideas remain outside this repository and are supplied with `--idea-file`; `.json` inputs with an `idea`, `description`, or `prompt` field are also accepted.

## Prerequisites

- Node.js 22.19.x. The repository deliberately rejects other major versions.
- npm 10.9.3, matching the committed lockfiles and container image.
- Provider authentication supported by Pi, or organizer-provided provider/model environment variables.

## Setup

The runtime is pinned to **Node.js 22.19.x**. If you use a version manager, the correct version is selected automatically from `.nvmrc`:

```bash
nvm install && nvm use     # or: fnm use --install-if-missing
```

Then install and verify:

```bash
npm ci --ignore-scripts
npm --prefix app-template ci --ignore-scripts
npm run check
```

If you are on the wrong Node major, `npm run challenge` stops immediately with a message telling you how to switch — it will not fail cryptically mid-install.

### No version manager? Use Docker (zero Node setup)

The committed `Dockerfile` pins Node 22.19.0 and runs the full check suite at build time, so judges need only Docker and a provider key:

```bash
docker build -t compilekit .
docker run --rm \
  -e BERGET_API_KEY -e CHALLENGE_PROVIDER=berget -e CHALLENGE_MODEL=zai-org/GLM-5.2 \
  compilekit --idea-file contract-public/development-idea.txt
```

Provider-specific credentials are read by Pi. The optional challenge variables select the organizer's runtime configuration:

```bash
export CHALLENGE_PROVIDER="provider-name"
export CHALLENGE_MODEL="model-id"
export CHALLENGE_THINKING="off"
```

For the Berget endpoint shown in the competition dashboard, create a key there and configure the shell that will run the challenge:

```bash
export BERGET_API_KEY="your-key-from-the-Berget-dashboard"
export CHALLENGE_PROVIDER="berget"
export CHALLENGE_MODEL="zai-org/GLM-5.2"
export CHALLENGE_THINKING="off"
```

The checked-in `solution/provider-config/models.json` contains only the public endpoint and model metadata. For each run, the runner copies it into an isolated audit directory and Pi resolves the key from `BERGET_API_KEY`; the secret is never written into the repository configuration.

Never commit credentials. `.env.example` documents variable names, but the runner intentionally does not load `.env` files.

The default thinking level is `off` to avoid multiplying output-token cost in the efficiency ranking. Raise it only when measurements show the extra reasoning improves completion quality.

The strict Node engine is intentional. `npm ci` fails on Node 23+ (including Node 26); use `.nvmrc` or the provided container rather than regenerating the lockfile with a newer runtime.

The Docker build runs the full check suite, including short-lived Vite servers over the builder's loopback interface. The image declares port 3000 for organizer-controlled browser evaluation; publishing that port still requires an explicit container port mapping or shared container network.

## Run the public challenge

The runner uses the finalized public prompt in `contract-public/development-idea.txt` by default.

```bash
npm run challenge
```

Use `--idea-file /path/to/idea.txt` to override the default for organizer testing or hidden evaluation.

For a setup-only check that does not call a model:

```bash
npm run challenge -- --prepare-only
```

After a complete run, start the generated application with a single command — either from the repository root or from inside the generated app:

```bash
npm run dev                 # from the repository root (proxies to output/app)
# or, equivalently:
cd output/app && npm run dev
```

The app must be available at `http://localhost:3000`. In another terminal, validate the machine-readable result:

```bash
npm run validate:result -- output/app/result.json
```

## Compiler execution

The Product Agent does not generate React source for normal ideas. It submits one compact Product IR through the terminating `compile_product` tool:

```text
raw idea → Product IR → validate → normalize → capability route
                                      ├─ compile → QA → deliver
                                      ├─ hybrid  → focused patch → finalize
                                      └─ custom  → bounded patch → finalize
```

The compiler writes `product.config.json`, `product-ir.json`, `idea_spec.json`, `summary.md`, `trace.jsonl`, and `report.partial.json`. The domain-neutral runtime interprets the configuration. Supported routes terminate after the initial tool call, avoiding a paid follow-up response. Hybrid and custom routes permit at most two focused repair turns.

The “agents” in the trace are logical, specialized stages—product interpretation, routing, compilation, QA, repair, and delivery—coordinated inside one Pi session. This preserves multi-agent separation of responsibilities without paying for six independent model conversations; only stages facing genuine ambiguity use the model.

The five supported interaction genomes are tracker, workflow, catalog, planner, and dashboard. Reusable behavior includes fields, CRUD, search, preset filters, sorting, category/status grouping, status transitions through editing, count/count-where/sum summaries, validation, and browser-local persistence.

## Result and telemetry ownership

The deterministic compiler writes `report.partial.json`, containing the product summary, assumptions, features, and derived journeys. The runner writes `result.json` after parsing Pi's completed `message_end` events. This prevents the model from inventing headline token totals.

The runner appends the canonical domain-neutral journey guidance from `contract-public/journeys.md` to Pi's built-in system prompt. The protected-paths extension removes only Pi's documentation-reference block, retaining its tool list and usage guidance without steering the model toward package internals. The challenge guidance prevents implied behaviors from being dropped for simplicity while explicitly rejecting unrelated substitute features; the input idea remains authoritative.

The runner independently executes the pinned Vitest binary, requires at least one completed passing test with no skipped or todo tests, runs `npm run build`, starts the application, probes the published `http://localhost:3000` URL only while the spawned server is alive, and terminates the full process group. Product-journey records remain in the specification-defined `tests_run` field; `success` requires at least one such journey and no failed entries. Independent Vitest, build, and startup evidence is recorded in `harness_checks`. The runner also owns `app_url` and a location-aware `start_command`, so harmless formatting differences in the partial report cannot invalidate a run.

The runner records whether port 3000 was occupied before Pi starts. If Pi leaves a listener behind, cleanup only targets same-user listener processes whose working directory is the generated app; Linux uses `/proc`, while macOS uses bounded, non-blocking `lsof` calls. A listener that predates Pi is never reclaimed. The `port_reclamation` result field records whether cleanup was considered, attempted, and successful, plus the affected process IDs.

A provisional result is written before app verification starts. Verification failures degrade a completed model run to `partial`; Pi startup or telemetry failures remain `failed`. Equivalent final results are emitted at the generated app root (`output/app/result.json`) and repository root (`result.json`); only `start_command` differs so each command works from the directory containing its result. Failure to write either required destination makes the harness exit non-zero. Port 3000 must be free on both IPv4 and IPv6 loopback addresses before verification begins.

The raw event stream and Pi session files are retained for audit. Official judging must independently recompute usage and compare it with `result.json`; the participant-controlled report is never the final scoring authority.

`reasoning_tokens` and `cost_total` are included as additional audit fields. `weighted_token_expenditure` is reconciled from audited telemetry using `input + output × 3 + cache read × 0.1`; cache writes remain separately reported because the published formula does not weight them.

## Develop the harness

The starter deliberately makes one autonomous Pi invocation. Possible participant improvements include:

- a shorter or more reliable prompt;
- specialized extensions or tools;
- reusable but domain-neutral application primitives;
- test-and-repair orchestration;
- deliberate prompt caching;
- a different Pi integration through its SDK or RPC mode.

Do not add a challenge idea's domain vocabulary or expected records to reusable code. The official judging idea will be different.

### Participant strategy

The generated workspace starts with a domain-neutral application runtime driven by `product.config.json`. Supported ideas require no model-authored application code. The runtime includes:

- accessible create, edit, delete, validation, empty, and error states;
- text search and category/status filtering;
- responsive cards and derived collection summaries;
- a repository boundary over versioned browser-local persistence;
- recovery from malformed stored data;
- a configuration-driven end-to-end component test.

Novel core interactions can still take the fallback path: the same Pi session may add a focused component and tests, then invoke deterministic finalization. This preserves generality while minimizing the output tokens weighted most heavily by the competition formula.

## Commands

| Command | Purpose |
|---|---|
| `npm run challenge` | Execute the public idea through Pi and the product compiler |
| `npm run challenge -- --prepare-only` | Reset the generated workspace without a model call |
| `npm run check` | Run the repository gate: type checks, harness tests, runtime journeys, and template build |
| `npm run benchmark -- --limit 20` | Run an audited multi-idea benchmark; use `--limit 120` for the full suite |
| `npm run validate:result -- output/app/result.json` | Validate schema and telemetry reconciliation |
| `npm run submission:freeze` | Freeze a sanitized bundle from a fully successful scored run |
| `npm --prefix output/app run dev` | Serve the generated product on port 3000 |

Set `CHALLENGE_LAUNCH_MODE=1` to generate the optional post-verification `launch-kit.md`. Keep it disabled for scored runs.

See [PRESENTATION_GUIDE.md](PRESENTATION_GUIDE.md) for the architecture, demo, and judge Q&A; [TEST_PLAN.md](TEST_PLAN.md) for acceptance coverage; and [SUBMISSION.md](SUBMISSION.md) for the final evidence workflow.

## Security

Pi and participant extensions execute with the permissions of the current process. Scored runs expose only the bounded `read`, `write`, `edit`, `compile_product`, and `finalize_product` tools; the protected-path extension confines file operations to the generated app and blocks credentials and runner-owned paths. This is defense in depth, not an OS sandbox, so evaluation should still use an isolated container or VM with bounded resources and network access.
