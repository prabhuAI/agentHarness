# Submission evidence

`verification/` is created only from a real successful scored run by:

```bash
npm run submission:freeze
```

The command refuses partial/failed runs, requires every product journey and outer harness check to pass, and scans the copied files for credentials and machine-specific paths. It includes the final result, Product IR, idea specification, summary, trace, and reproducibility metadata. Raw Pi events and session logs remain local because they can contain prompts, paths, or secrets.

To replace an older frozen bundle after a newer successful run, use `npm run submission:freeze -- --replace`, review the diff, and commit it deliberately.

The varied 20-case report is generated separately with `npm run benchmark -- --limit 20` and copied here with `npm run benchmark:freeze`. It records aggregate success, first-pass, one-call, persistence, runtime, and weighted-token statistics alongside every categorized input.
