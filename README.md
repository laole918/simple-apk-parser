# simple-apk-parser

Parse APK metadata and signature information in Node.js and modern browsers.

This project was developed entirely with AI assistance.

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

### `createBrowserParser(options?)`

Create a browser parser with optional runtime overrides. This is the recommended way to inject a custom `digest()` fallback.

```js
import { createBrowserParser } from "simple-apk-parser";
import { sha1 } from "@noble/hashes/sha1";
import { sha256 } from "@noble/hashes/sha256";

const parser = createBrowserParser({
  digest(algorithm, data) {
    if (algorithm === "SHA-1") return sha1(data);
    if (algorithm === "SHA-256") return sha256(data);
    throw new Error(`Unsupported digest algorithm: ${algorithm}`);
  },
});

const result = await parser.parseApkFile(file);
```

### `createNodeParser(options?)`

Create a Node.js parser. In most Node.js environments you do not need to pass anything, but the hook remains available for advanced overrides.

```js
import { createNodeParser } from "simple-apk-parser";

const parser = createNodeParser();
```

### `createParser(runtime)`

Advanced API for building a parser from a fully custom runtime.

Node.js low-level entry:

```js
import { createNodeRuntime, createParser } from "simple-apk-parser";

const parser = createParser(createNodeRuntime());
```

Browser low-level entry:

```js
import { createBrowserRuntime, createParser } from "simple-apk-parser";

const parser = createParser(createBrowserRuntime());
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

## `digest()` contract

When you provide `digest`, the parser calls it as:

```js
await digest(algorithm, data)
```

- `algorithm` is currently `"SHA-1"` or `"SHA-256"`
- `data` is a `Uint8Array`
- the return value may be a `Uint8Array`, `ArrayBuffer`, or a hex string
- hex strings may be uppercase or lowercase; the parser normalizes them to lowercase internally

If `digest` is omitted, the parser falls back to `crypto.subtle.digest()` when available. If both are provided, `digest` wins.

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
- `crypto.subtle` or a custom `digest(algorithm, data)` implementation
- `DecompressionStream` for deflate-raw ZIP entries

In browsers, `crypto.subtle` is usually only available in a secure context such as `https://` or `http://localhost`. If you run the page from an insecure origin and `crypto.subtle` is missing, you can inject a third-party digest implementation instead.

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
