import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { validateSample } from "./validate-sample.mjs";

const ROOT = "/Users/laole918/workspace/py/get_hw_store_app_info/output";

async function listApks(root) {
  const dirs = await readdir(root, { withFileTypes: true });
  const rows = [];

  for (const dirent of dirs) {
    if (!dirent.isDirectory()) continue;
    const subdir = join(root, dirent.name);
    const entries = await readdir(subdir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".apk")) {
        const filePath = join(subdir, entry.name);
        const stat = await import("node:fs/promises").then(m => m.stat(filePath));
        rows.push({ filePath, size: stat.size });
      }
    }
  }

  rows.sort((a, b) => a.size - b.size);
  return rows;
}

function uniqueByPath(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (seen.has(row.filePath)) continue;
    seen.add(row.filePath);
    out.push(row);
  }
  return out;
}

function selectRepresentativeSamples(rows) {
  const picks = [];
  const percentiles = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.98, 0.99, 1];

  for (const p of percentiles) {
    const index = p === 1 ? rows.length - 1 : Math.floor(rows.length * p);
    picks.push(rows[Math.max(0, Math.min(rows.length - 1, index))]);
  }

  const largest = rows.slice(-10);
  picks.push(...largest);

  const buckets = [
    rows.filter(row => row.size < 50 * 1024 * 1024),
    rows.filter(row => row.size >= 50 * 1024 * 1024 && row.size < 200 * 1024 * 1024),
    rows.filter(row => row.size >= 200 * 1024 * 1024 && row.size < 500 * 1024 * 1024),
    rows.filter(row => row.size >= 500 * 1024 * 1024 && row.size < 1024 * 1024 * 1024),
    rows.filter(row => row.size >= 1024 * 1024 * 1024),
  ];

  for (const bucket of buckets) {
    if (bucket.length === 0) continue;
    picks.push(bucket[0]);
    picks.push(bucket[Math.floor(bucket.length / 2)]);
    picks.push(bucket[bucket.length - 1]);
  }

  return uniqueByPath(picks);
}

function summarizeResult(result) {
  return {
    filePath: result.filePath,
    fileSize: result.fileSize,
    packageName: result.parseApkFile.packageName,
    appName: result.parseApkFile.appName,
    versionCode: result.parseApkFile.versionCode,
    versionName: result.parseApkFile.versionName,
    parseMatch: JSON.stringify(result.parseApkFile) === JSON.stringify(result.parseApkUrl),
    urlRequestCount: result.urlMetrics.requestCount,
    urlTotalBytesServed: result.urlMetrics.totalBytesServed,
    urlLargestRange: Math.max(...result.urlMetrics.ranges.map(item => item.length), 0),
    v1: result.parseApkFile.signatures.find(item => item.scheme === "v1")?.found ?? false,
    v2: result.parseApkFile.signatures.find(item => item.scheme === "v2")?.found ?? false,
    v3: result.parseApkFile.signatures.find(item => item.scheme === "v3")?.found ?? false,
  };
}

const allRows = await listApks(ROOT);
const sampleRows = selectRepresentativeSamples(allRows);
const results = [];

for (const row of sampleRows) {
  const result = await validateSample(row.filePath);
  results.push(result);
  console.error(`validated ${row.filePath}`);
}

const summary = results.map(summarizeResult);
console.log(JSON.stringify({
  root: ROOT,
  sampleCount: sampleRows.length,
  selectedSamples: sampleRows,
  summary,
}, null, 2));
