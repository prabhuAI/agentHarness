# Submission evidence

`verification/` is created only from a real successful scored run by:

```bash
npm run submission:freeze
```

The command refuses partial/failed runs, requires every product journey and outer harness check to pass, and scans the copied files for credentials and machine-specific paths. It includes the final result, Product IR, idea specification, summary, trace, and reproducibility metadata. Raw Pi events and session logs remain local because they can contain prompts, paths, or secrets.

To replace an older frozen bundle after a newer successful run, use `npm run submission:freeze -- --replace`, review the diff, and commit it deliberately.
