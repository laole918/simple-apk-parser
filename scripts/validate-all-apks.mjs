import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { validateSample } from "./validate-sample.mjs";

const execFile = promisify(execFileCallback);

const ROOT = process.argv[2] || "/Users/laole918/workspace/py/get_hw_store_app_info/output";
const LOCALE = process.argv[3] || "zh-CN";
const AAPT2 = process.env.AAPT2_PATH || "/Users/laole918/develop/Android/sdk/build-tools/34.0.0/aapt2";
const APKSIGNER = process.env.APKSIGNER_PATH || "/Users/laole918/develop/Android/sdk/build-tools/34.0.0/apksigner";
const JARSIGNER = process.env.JARSIGNER_PATH || "/opt/homebrew/opt/openjdk@17/bin/jarsigner";
const PARSE_OPTIONS = { locale: LOCALE };

async function listApks(root) {
  const rows = [];

  async function walk(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".apk")) {
        rows.push(fullPath);
      }
    }
  }

  await walk(root);
  rows.sort((a, b) => a.localeCompare(b));
  return rows;
}

function parsePackageLine(line) {
  const fields = {};
  const regex = /([A-Za-z0-9_.-]+)='([^']*)'/g;

  for (const match of line.matchAll(regex)) {
    fields[match[1]] = match[2];
  }

  return fields;
}

function parseAaptBadging(stdout, locale) {
  const lines = stdout.split(/\r?\n/);
  const packageLine = lines.find(line => line.startsWith("package:"));
  const fields = packageLine ? parsePackageLine(packageLine) : {};
  const exactLabelPrefix = `application-label-${locale}:`;
  const languagePrefix = `application-label-${locale.split("-")[0]}:`;
  const exactLabelLine = lines.find(line => line.startsWith(exactLabelPrefix));
  const languageLabelLine = locale.includes("-")
    ? lines.find(line => line.startsWith(languagePrefix))
    : null;
  const defaultLabelLine = lines.find(line => line.startsWith("application-label:"));
  const applicationLine = lines.find(line => line.startsWith("application:"));

  const extractQuotedValue = line => {
    const match = line?.match(/'([^']*)'/);
    return match ? match[1] : "";
  };

  return {
    packageName: fields.name || "",
    versionCode: fields.versionCode || "",
    versionName: fields.versionName || "",
    appName:
      extractQuotedValue(exactLabelLine) ||
      extractQuotedValue(languageLabelLine) ||
      extractQuotedValue(defaultLabelLine) ||
      extractQuotedValue(applicationLine),
  };
}

function parseApkSigner(stdout) {
  const lines = stdout.split(/\r?\n/);
  const findBool = prefix => {
    const line = lines.find(item => item.startsWith(prefix));
    if (!line) return false;
    return line.slice(prefix.length).trim() === "true";
  };
  const certSha256Line = lines.find(line => line.startsWith("Signer #1 certificate SHA-256 digest:"));
  const certDnLine = lines.find(line => line.startsWith("Signer #1 certificate DN:"));

  return {
    v1: findBool("Verified using v1 scheme (JAR signing):"),
    v2: findBool("Verified using v2 scheme (APK Signature Scheme v2):"),
    v3: findBool("Verified using v3 scheme (APK Signature Scheme v3):") ||
      findBool("Verified using v3.1 scheme (APK Signature Scheme v3.1):"),
    certificateSha256: certSha256Line ? certSha256Line.split(": ").slice(1).join(": ").trim().toLowerCase() : "",
    certificateDn: certDnLine ? certDnLine.split(": ").slice(1).join(": ").trim() : "",
  };
}

function parseJarSigner(stdout) {
  const verified =
    stdout.includes("jar verified.") ||
    stdout.includes("jar verified") ||
    stdout.includes("jar 已验证。") ||
    stdout.includes("jar 已验证");

  const signerMatch =
    stdout.match(/- 由 "([^"]+)" 签名/) ||
    stdout.match(/- Signed by "([^"]+)"/);

  return {
    v1: verified,
    certificateDn: signerMatch ? signerMatch[1].trim() : "",
  };
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
  };
}

async function runTool(command, args, options, parser) {
  try {
    const { stdout } = await execFile(command, args, options);
    return {
      ok: true,
      value: parser(stdout),
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: serializeError(error),
    };
  }
}

async function getLocalTruth(filePath, locale) {
  const [aapt2Result, apksignerResult, jarsignerResult] = await Promise.all([
    runTool(AAPT2, ["dump", "badging", filePath], { maxBuffer: 32 * 1024 * 1024 }, stdout => parseAaptBadging(stdout, locale)),
    runTool(APKSIGNER, ["verify", "--verbose", "--print-certs", filePath], { maxBuffer: 32 * 1024 * 1024 }, parseApkSigner),
    runTool(JARSIGNER, ["-verify", "-verbose", "-certs", filePath], { maxBuffer: 128 * 1024 * 1024 }, parseJarSigner),
  ]);

  return {
    aapt2: aapt2Result.value,
    apksigner: apksignerResult.value,
    jarsigner: jarsignerResult.value,
    toolErrors: {
      aapt2: aapt2Result.error,
      apksigner: apksignerResult.error,
      jarsigner: jarsignerResult.error,
    },
  };
}

function sanitizeParsedResult(result) {
  return {
    appName: result.appName || "",
    packageName: result.packageName || "",
    versionCode: typeof result.versionCode === "bigint" ? result.versionCode.toString() : String(result.versionCode ?? ""),
    versionName: result.versionName || "",
    signatures: {
      v1: result.signatures.find(item => item.scheme === "v1") || null,
      v2: result.signatures.find(item => item.scheme === "v2") || null,
      v3: result.signatures.find(item => item.scheme === "v3") || null,
    },
  };
}

function compareAgainstLocalTruth(parsed, truth) {
  const mismatches = [];
  const { aapt2, apksigner, jarsigner } = truth;

  if (aapt2 && parsed.packageName !== aapt2.packageName) {
    mismatches.push({
      field: "packageName",
      expected: aapt2.packageName,
      actual: parsed.packageName,
    });
  }

  if (aapt2 && parsed.versionCode !== aapt2.versionCode) {
    mismatches.push({
      field: "versionCode",
      expected: aapt2.versionCode,
      actual: parsed.versionCode,
    });
  }

  if (aapt2 && (parsed.versionName || "") !== (aapt2.versionName || "")) {
    mismatches.push({
      field: "versionName",
      expected: aapt2.versionName,
      actual: parsed.versionName,
    });
  }

  if (aapt2?.appName && parsed.appName !== aapt2.appName) {
    mismatches.push({
      field: "appName",
      expected: aapt2.appName,
      actual: parsed.appName,
    });
  }

  if (apksigner) {
    for (const scheme of ["v2", "v3"]) {
      const actualEntry = parsed.signatures[scheme];
      const actualFound = Boolean(actualEntry?.found);
      const expectedFound = apksigner[scheme];

      if (actualFound !== expectedFound) {
        mismatches.push({
          field: `signature.${scheme}.found`,
          expected: expectedFound,
          actual: actualFound,
        });
        continue;
      }

      const expectedSha256 = scheme === "v3" && apksigner.v3
        ? apksigner.certificateSha256
        : scheme === "v2" && !apksigner.v3 && apksigner.v2
          ? apksigner.certificateSha256
          : "";
      const actualSha256 = actualEntry?.certificate?.sha256?.toLowerCase?.() || "";

      if (expectedFound && expectedSha256 && actualSha256 !== expectedSha256) {
        mismatches.push({
          field: `signature.${scheme}.certificateSha256`,
          expected: expectedSha256,
          actual: actualSha256,
        });
      }
    }
  }

  if (jarsigner) {
    const actualEntry = parsed.signatures.v1;
    const actualFound = Boolean(actualEntry?.found);
    const expectedFound = jarsigner.v1;

    if (actualFound !== expectedFound) {
      mismatches.push({
        field: "signature.v1.found",
        expected: expectedFound,
        actual: actualFound,
      });
    }
  }

  return mismatches;
}

async function validateOne(filePath) {
  const sample = await validateSample(filePath, PARSE_OPTIONS);
  const truth = await getLocalTruth(filePath, LOCALE);
  const parsedFile = sanitizeParsedResult(sample.parseApkFile);
  const parsedUrl = sanitizeParsedResult(sample.parseApkUrl);
  const parseMethodMismatch = JSON.stringify(parsedFile) !== JSON.stringify(parsedUrl);
  const localMismatches = compareAgainstLocalTruth(parsedFile, truth);

  return {
    filePath,
    fileName: basename(filePath),
    parseMethodMismatch,
    localMismatch: localMismatches.length > 0,
    parsedFile,
    parsedUrl,
    urlMetrics: sample.urlMetrics,
    localTruth: truth,
    localToolErrors: truth.toolErrors,
    mismatches: [
      ...(parseMethodMismatch ? [{
        field: "parseApkFile_vs_parseApkUrl",
        expected: parsedFile,
        actual: parsedUrl,
      }] : []),
      ...localMismatches,
    ],
  };
}

const apkPaths = await listApks(ROOT);
const results = [];

for (let index = 0; index < apkPaths.length; index += 1) {
  const filePath = apkPaths[index];
  try {
    const result = await validateOne(filePath);
    results.push(result);
    const status = result.mismatches.length === 0
      ? (Object.values(result.localToolErrors || {}).some(Boolean) ? "ok-with-tool-errors" : "ok")
      : "mismatch";
    console.error(`[${index + 1}/${apkPaths.length}] ${status} ${filePath}`);
  } catch (error) {
    const failure = {
      filePath,
      fileName: basename(filePath),
      parseMethodMismatch: false,
      localMismatch: false,
      error: serializeError(error),
      mismatches: [],
    };
    results.push(failure);
    console.error(`[${index + 1}/${apkPaths.length}] error ${filePath}: ${failure.error.message}`);
  }
}

const summary = {
  root: ROOT,
  locale: LOCALE,
  apkCount: apkPaths.length,
  okCount: results.filter(item => !item.error && item.mismatches.length === 0).length,
  mismatchCount: results.filter(item => !item.error && item.mismatches.length > 0).length,
  errorCount: results.filter(item => item.error).length,
  parseMethodMismatchCount: results.filter(item => item.parseMethodMismatch).length,
  localMismatchCount: results.filter(item => item.localMismatch).length,
  localToolErrorCount: results.filter(item => Object.values(item.localToolErrors || {}).some(Boolean)).length,
};

console.log(JSON.stringify({
  summary,
  results,
}, null, 2));
