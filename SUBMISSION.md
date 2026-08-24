# CompileKit competition submission

Submit this participant repository: **https://github.com/prabhuAI/agentHarness**. The `origin` remote points to the organizer starter and must not be used for participant pushes.

## Reproduce

Docker is optional. The native path requires Node 22.19.x and npm 10.9.3:

```bash
npm ci --ignore-scripts
npm --prefix app-template ci --ignore-scripts
npm run check
export BERGET_API_KEY="..."
export CHALLENGE_PROVIDER="berget"
export CHALLENGE_MODEL="zai-org/GLM-5.2"
npm run challenge
npm run validate:result -- output/app/result.json
npm run submission:freeze
```

The equivalent Docker workflow is documented in `README.md`; it exists for reproducibility, not as a competition requirement.

## What the evidence bundle means

“Freeze the sanitized submission evidence bundle” means copying the artifacts from one completed, successful, independently verified run into a stable committed directory after removing sensitive/raw logs. It does not mean inventing results, committing an API key, or committing disposable `output/` files. Until a real provider-backed run succeeds, `submission/verification/` should remain absent.

Before the final push, review `submission/verification/result.json`, confirm its commit metadata, and ensure `git diff --check`, `npm run check`, and CI are green.
