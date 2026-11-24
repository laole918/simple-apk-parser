# Parser and Runtime Contracts

## Composition and boundaries

[`createParser`](../../../src/core/api.js) receives a runtime, validates required capabilities, and constructs ZIP, resource, and signature tools. Access platform capabilities through the injected runtime in shared code. [`createNodeRuntime`](../../../src/runtime/node.js) supplies raw inflate through `node:zlib`. [`createBrowserRuntime`](../../../src/runtime/browser.js) uses `DecompressionStream`. Both build on [`createBaseRuntime`](../../../src/runtime/shared.js), which accepts overrides.

Given an APK `blob`, pass `loadResources: false` to skip reading the resource table.

```js
import { createNodeRuntime, createParser } from "simple-apk-parser";

const parser = createParser(createNodeRuntime());
const result = await parser.parseApkFile(blob, { loadResources: false });
```

The [README](../../../README.md) documents the public factories and runtime overrides. The shared runtime binds the default `fetch` to `globalThis`. When supplied, an injected `fetch` keeps its original function identity, as covered by the [smoke tests](../../../test/unit/smoke.test.js). A custom `digest(algorithm, data)` takes precedence over `crypto.subtle`. [`binary.js`](../../../src/core/binary.js) normalizes custom digest results to lowercase hex. The README documents the algorithms and accepted return forms.

## Sources and results

The parser wraps local Blob input and remote URLs as ZIP sources, then runs the same basic-info and signature steps. [`zip.js`](../../../src/core/zip.js) implements Blob reads and HTTP range requests, including response and range validation. Preserve both paths when changing shared source behavior. Remote servers need range support and browser requests are subject to CORS, as described in the [README](../../../README.md).

[`normalizeParseOptions`](../../../src/core/types.js) handles resource loading and locale defaults. [`resources.js`](../../../src/core/resources.js) resolves metadata and can return a `bigint` for `versionCode`. Handle both `number` and `bigint` in consumers. The `signatures` result reports detection and certificate extraction by [`signature.js`](../../../src/core/signature.js). Use a signature verification tool such as `apksigner` for strict APK verification, as described in the [README](../../../README.md).

The JavaScript parser uses runtime checks at its boundaries. `createParser` checks capabilities at construction, and binary and ZIP readers report invalid or unsupported data. Keep error messages actionable and test observable behavior.
