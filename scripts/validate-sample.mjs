import { createServer } from "node:http";
import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { parseApkFile, parseApkUrl } from "../dist/simple-apk-parser.js";

function sanitizeResult(result) {
  return {
    appName: result.appName,
    packageName: result.packageName,
    versionCode: result.versionCode,
    versionName: result.versionName,
    hasIcon: Boolean(result.iconBlob),
    iconType: result.iconBlob?.type || "",
    signatures: result.signatures,
  };
}

function parseRangeHeader(rangeHeader, size) {
  if (!rangeHeader?.startsWith("bytes=")) {
    return null;
  }

  const value = rangeHeader.slice(6).trim();
  const [startStr, endStr] = value.split("-", 2);

  if (startStr === "") {
    const suffixLength = Number(endStr);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    const start = Math.max(0, size - suffixLength);
    return { start, end: size - 1 };
  }

  const start = Number(startStr);
  if (!Number.isFinite(start) || start < 0 || start >= size) {
    return null;
  }

  const end = endStr === "" ? size - 1 : Math.min(size - 1, Number(endStr));
  if (!Number.isFinite(end) || end < start) {
    return null;
  }

  return { start, end };
}

export async function createRangeServer(filePath) {
  const fileStat = await stat(filePath);
  const metrics = {
    requestCount: 0,
    totalBytesServed: 0,
    ranges: [],
  };

  const server = createServer(async (req, res) => {
    const range = parseRangeHeader(req.headers.range, fileStat.size);
    const blob = await openAsBlob(filePath);

    if (!range) {
      const buf = Buffer.from(await blob.arrayBuffer());
      res.writeHead(200, {
        "Content-Length": buf.length,
        "Content-Type": "application/vnd.android.package-archive",
      });
      res.end(buf);
      return;
    }

    const { start, end } = range;
    const slice = blob.slice(start, end + 1);
    const bytes = Buffer.from(await slice.arrayBuffer());
    metrics.requestCount += 1;
    metrics.totalBytesServed += bytes.length;
    metrics.ranges.push({
      start,
      end,
      length: bytes.length,
      rangeHeader: req.headers.range,
    });

    res.writeHead(206, {
      "Accept-Ranges": "bytes",
      "Content-Length": bytes.length,
      "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
      "Content-Type": "application/vnd.android.package-archive",
    });
    res.end(bytes);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/${encodeURIComponent(basename(filePath))}`;

  return {
    close: () => new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
    metrics,
    url,
  };
}

export async function validateSample(filePath, options = {}) {
  const fileBlob = await openAsBlob(filePath);
  const fileResult = await parseApkFile(fileBlob, options);

  const server = await createRangeServer(filePath);
  let urlResult;

  try {
    urlResult = await parseApkUrl(server.url, options);
  } finally {
    await server.close();
  }

  return {
    filePath,
    fileSize: fileBlob.size,
    parseApkFile: sanitizeResult(fileResult),
    parseApkUrl: sanitizeResult(urlResult),
    urlMetrics: server.metrics,
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const filePath = process.argv[2];
  const optionsArg = process.argv[3];
  if (!filePath) {
    console.error("Usage: node scripts/validate-sample.mjs /path/to/app.apk [jsonOptions]");
    process.exit(1);
  }

  const options = optionsArg ? JSON.parse(optionsArg) : {};
  const result = await validateSample(filePath, options);
  console.log(JSON.stringify(result, null, 2));
}
