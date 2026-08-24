# Test Plan: AgentCofounder Product Compiler

## Test Cases

| ID | Description | Type | Priority | Automated coverage |
|---|---|---|---|---|
| TC-001 | Reject malformed Product IR | Unit | P0 | `test/product-compiler.test.ts` |
| TC-002 | Normalize identifiers and defaults | Unit | P0 | `test/product-compiler.test.ts` |
| TC-003 | Route supported, hybrid, and custom ideas | Unit | P0 | `test/product-compiler.test.ts` |
| TC-004 | Compile filters and derived summaries | Unit | P0 | `test/product-compiler.test.ts` |
| TC-005 | Complete supported product in one terminating tool call | Integration | P0 | `test/product-compiler-tool.test.ts` |
| TC-006 | Create, persist, reload, edit/save/reload, positive filter, return-state mutation, delete, and undo | UI component | P0 | `app-template/src/App.test.tsx` |
| TC-007 | Resolve the public category ambiguity with suggestions plus custom input | Integration | P0 | `test/public-fixture.test.ts` |
| TC-008 | Build the public fixture successfully | Build | P0 | `test/public-fixture.test.ts` |
| TC-009 | Classify failures and apply known deterministic repair | Unit | P1 | `test/product-compiler.test.ts` |
| TC-010 | Validate specification, summary, Product IR, and trace | Contract | P0 | `test/validate-artifacts.test.ts` |
| TC-011 | Reconcile model usage and weighted tokens | Contract | P0 | `test/result.test.ts`, `test/usage.test.ts` |
| TC-012 | Verify tests, build, live HTTP startup, and port cleanup | Harness | P0 | `test/verify-app.test.ts`, `test/process-tree.test.ts` |
| TC-013 | Preserve protected paths and runner-owned result | Security | P0 | `test/run-challenge.test.ts` |
| TC-014 | Provide at least 100 unique diverse benchmark ideas | Benchmark | P1 | `test/product-compiler.test.ts` |
| TC-015 | Complete and exhaust the bounded hybrid/custom finalization lifecycle | Integration | P0 | `test/product-compiler-tool.test.ts` |
| TC-016 | Recover corrupt storage and keep failed writes atomic | UI/repository | P1 | `app-template/src/App.test.tsx` |
| TC-017 | Accept text and website-style idea JSON; fail fast on missing provider configuration | Contract | P0 | `test/run-challenge.test.ts` |

## Application-readiness rubric coverage

| Rubric | Weight | Evidence |
|---|---:|---|
| Usability & UX | 30 | Responsive CSS, accessible dialogs/controls, validation focus, search/filter/sort, empty and notice states; component journeys in `App.test.tsx` |
| Data & persistence | 20 | Versioned repository boundary, reload journey, malformed-data recovery, atomic failed writes, full repository contract |
| Robustness | 20 | Invalid input, repeated restore, missing-id update, delete/undo, provider failure, process cleanup, bounded repair |
| API & integration readiness | 15 | Swappable `Repository` interface and contract test; Product IR/runtime boundary |
| Maintainability & extensibility | 15 | Typed IR, capability router, five genomes, deterministic compiler, isolated QA/repair/telemetry modules |

## Release Gate

Run:

```bash
npm ci --ignore-scripts
npm --prefix app-template ci --ignore-scripts
npm run check
npm run challenge
npm run validate:result -- output/app/result.json
npm run submission:freeze
```

Require every command to pass on Node.js 22.19.x. Then run `npm run benchmark -- --limit 120`, inspect the frozen bundle, and commit it only when it contains no secret or machine-specific data. Browser-based hidden evaluation remains the final authority for responsive and product-specific UX.
