# Test Plan: AgentCofounder Product Compiler

## Test Cases

| ID | Description | Type | Priority | Automated coverage |
|---|---|---|---|---|
| TC-001 | Reject malformed Product IR | Unit | P0 | `test/product-compiler.test.ts` |
| TC-002 | Normalize identifiers and defaults | Unit | P0 | `test/product-compiler.test.ts` |
| TC-003 | Route supported, hybrid, and custom ideas | Unit | P0 | `test/product-compiler.test.ts` |
| TC-004 | Compile filters and derived summaries | Unit | P0 | `test/product-compiler.test.ts` |
| TC-005 | Complete supported product in one terminating tool call | Integration | P0 | `test/product-compiler-tool.test.ts` |
| TC-006 | Create, persist, reload, edit, search, filter, and delete | UI component | P0 | `app-template/src/App.test.tsx` |
| TC-007 | Resolve the public category ambiguity with suggestions plus custom input | Integration | P0 | `test/public-fixture.test.ts` |
| TC-008 | Build the public fixture successfully | Build | P0 | `test/public-fixture.test.ts` |
| TC-009 | Classify failures and apply known deterministic repair | Unit | P1 | `test/product-compiler.test.ts` |
| TC-010 | Validate specification, summary, Product IR, and trace | Contract | P0 | `test/validate-artifacts.test.ts` |
| TC-011 | Reconcile model usage and weighted tokens | Contract | P0 | `test/result.test.ts`, `test/usage.test.ts` |
| TC-012 | Verify tests, build, live HTTP startup, and port cleanup | Harness | P0 | `test/verify-app.test.ts`, `test/process-tree.test.ts` |
| TC-013 | Preserve protected paths and runner-owned result | Security | P0 | `test/run-challenge.test.ts` |
| TC-014 | Provide at least 100 unique diverse benchmark ideas | Benchmark | P1 | `test/product-compiler.test.ts` |

## Release Gate

Run:

```bash
npm ci --ignore-scripts
npm --prefix app-template ci --ignore-scripts
npm run check
npm run challenge
npm run validate:result -- output/app/result.json
```

Require every command to pass on Node.js 22.19.x. Then run `npm run benchmark -- --limit 120` and compare the report with the targets in `IMPLEMENTATION_STATUS.md`.
