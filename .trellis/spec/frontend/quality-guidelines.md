# Quality and Verification

Run `npm test` and `npm run build` for package verification. [`package.json`](../../../package.json) also defines watch commands.

| Command | Purpose |
| --- | --- |
| `npm test` | Run Vitest once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run build` | Generate Node ESM, browser ESM, and two browser IIFE bundles with Rollup |
| `npm run dev` | Watch and rebuild with Rollup |

[`vitest.config.js`](../../../vitest.config.js) runs `test/**/*.test.js` in a Node environment. [`smoke.test.js`](../../../test/unit/smoke.test.js) covers public APIs, injected runtime behavior, binary and resource handling, and error cases with constructed inputs. Its ZIP64 test runs the rejection assertion only when the local fixture at `/private/tmp/zip64-test2.apk` exists. Otherwise the test returns early and Vitest counts it as passed.

For coverage with real APKs, run the validation scripts directly with Node.js after `npm run build`. They use the built Node ESM entry and `node:fs`'s `openAsBlob` through [`scripts/validate-sample.mjs`](../../../scripts/validate-sample.mjs).

- `node scripts/validate-sample.mjs <apk-path> [json-options]` parses one APK as a local Blob and from a local HTTP range server.
- [`scripts/batch-validate.mjs`](../../../scripts/batch-validate.mjs) selects representative APKs by size from its hard-coded corpus path.
- [`scripts/validate-all-apks.mjs`](../../../scripts/validate-all-apks.mjs) accepts a corpus root and locale as optional positional arguments. It compares parser output against `aapt2`, `apksigner`, and `jarsigner` results and accepts tool paths via `AAPT2_PATH`, `APKSIGNER_PATH`, and `JARSIGNER_PATH`.

The sample CLI and batch script can throw during JSON serialization when `versionCode` is a `bigint`. The all-APK validator converts version codes to strings before comparison and reporting.

For changes to parser behavior, check both local and remote sources and relevant runtime overrides. Follow the smoke tests' use of small synthetic inputs. For browser-facing changes, check the demo manually in a browser to exercise actual browser APIs. The [README](../../../README.md) lists required APIs and range and CORS constraints.
