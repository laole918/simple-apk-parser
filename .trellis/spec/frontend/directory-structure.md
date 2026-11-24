# Directory Structure

The library is a single ES module package. Keep parser behavior shared and isolate platform dependencies in runtime adapters.

- [`src/core/api.js`](../../../src/core/api.js) composes the parser. [`zip.js`](../../../src/core/zip.js), [`resources.js`](../../../src/core/resources.js), and [`signature.js`](../../../src/core/signature.js) implement APK handling. [`binary.js`](../../../src/core/binary.js) contains binary helpers and [`types.js`](../../../src/core/types.js) normalizes parse options.
- [`src/index.js`](../../../src/index.js) and [`src/browser.js`](../../../src/browser.js) expose platform-specific parser factories and lazy default parsers. [`src/runtime/node.js`](../../../src/runtime/node.js), [`src/runtime/browser.js`](../../../src/runtime/browser.js), and [`src/runtime/shared.js`](../../../src/runtime/shared.js) provide runtime capabilities.
- [`src/browser-global.js`](../../../src/browser-global.js) provides the direct-script API. [`demo/index.html`](../../../demo/index.html) and [`demo/main.js`](../../../demo/main.js) form the browser demo.
- [`test/unit/smoke.test.js`](../../../test/unit/smoke.test.js) contains Vitest coverage. [`scripts/validate-sample.mjs`](../../../scripts/validate-sample.mjs), [`scripts/batch-validate.mjs`](../../../scripts/batch-validate.mjs), and [`scripts/validate-all-apks.mjs`](../../../scripts/validate-all-apks.mjs) are separate APK validation tools.

[`package.json`](../../../package.json) selects Node and browser ESM exports. Make library changes in `src/` and regenerate `dist/` with [`rollup.config.js`](../../../rollup.config.js). When changing the public API, check both ESM entry points, the browser global entry, and the package exports.
