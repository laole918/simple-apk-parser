# simple-apk-parser

Parse APK metadata and signature information in Node.js and modern browsers.

## Features

- Parse APK files in browsers with `File` / `Blob`
- Parse remote APK URLs with HTTP `Range` requests
- Read:
  - app name
  - package name
  - version code
  - version name
  - app icon
  - signature info for v1 / v2 / v3
- Works in:
  - Node.js 18+
  - modern browsers

## Install

```bash
npm install simple-apk-parser
```

## API

### `parseApkFile(file, options?)`

Parse a local APK `File` / `Blob`.

```js
import { parseApkFile } from "simple-apk-parser";

const result = await parseApkFile(file);
console.log(result.packageName);
```

### `parseApkUrl(url, options?)`

Parse a remote APK by URL.

```js
import { parseApkUrl } from "simple-apk-parser";

const result = await parseApkUrl("https://example.com/app.apk");
console.log(result.packageName);
```

## Options

### `loadResources`

Type: `boolean`  
Default: `true`

Controls whether `resources.arsc` is loaded and resolved.

- `true`:
  resolves resource references for app name and icon
- `false`:
  skips `resources.arsc`

When `loadResources: false`, the parser still reads manifest and signature info, but it usually cannot resolve the final human-readable `appName` or `icon`.

```js
const result = await parseApkUrl(url, {
  loadResources: false,
});
```

### `locale`

Type: `string`  
Default: system locale

Controls which localized resource variant is preferred when resolving values from `resources.arsc`.

- defaults to the current runtime locale, such as `en-US` or `zh-CN`
- can be set explicitly to make parsing deterministic across environments

```js
const result = await parseApkFile(file, {
  locale: "en-US",
});
```

When `locale` is set, the parser prefers exact language-region matches first, then same-language fallbacks, then non-localized resources.

## Result shape

Typical result:

```js
{
  appName: "Example App",
  packageName: "com.example.app",
  versionCode: 123,
  versionName: "1.2.3",
  iconBlob: Blob | null,
  signatures: [
    {
      scheme: "v3",
      found: true,
      certificate: {
        dn: "...",
        sha256: "...",
        sha1: "...",
        md5: "..."
      }
    },
    {
      scheme: "v2",
      found: true,
      certificate: { ... }
    },
    {
      scheme: "v1",
      found: false,
      certificate: null
    }
  ]
}
```

Signature fields indicate that the parser detected the corresponding signature structure and extracted its certificate information. They are not intended to mean the APK would necessarily pass strict verification by `apksigner` or `jarsigner`.

## Browser requirements

Modern bundlers should pick the browser ESM build automatically through the package `browser` export condition. For direct `<script>` usage, the IIFE bundles remain available at `dist/simple-apk-parser.iife.js` and `dist/simple-apk-parser.iife.min.js`.

The browser runtime expects these APIs:

- `fetch`
- `Blob`
- `TextDecoder`
- `TextEncoder`
- `crypto.subtle`
- `DecompressionStream` for deflate-raw ZIP entries

## Important limits

### Remote URL parsing requires `Range`

`parseApkUrl` depends on HTTP range requests.

The server must support:

- `Range: bytes=...`
- `206 Partial Content`
- `Content-Range`

If the server ignores range requests or always returns `200`, parsing will fail.

### Browser remote parsing may still be blocked

In browsers, `parseApkUrl` can fail because of:

- CORS
- mixed-content restrictions
- certificate errors
- network failures
- browser or extension policy interference

### ZIP64 APK is not supported

This library supports normal ZIP32 APKs only.

If a target APK uses ZIP64, parsing fails with:

```text
ZIP64 APK is not supported
```

This is intentional. In practice, Android APK tooling and installation behavior around ZIP64 is not reliable enough to treat it as a normal supported APK format.

## Development

Install dependencies:

```bash
npm install
```

Build:

```bash
npm run build
```

Test:

```bash
npm test
```

## Demo

Start a static server from the repository root:

```bash
npx serve .
```

Then open:

- [http://localhost:3000/demo/](http://localhost:3000/demo/)

The demo imports source modules directly, so the server should be started from the repository root instead of from the `demo/` directory.
