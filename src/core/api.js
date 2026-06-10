import { createResourceTools } from "./resources.js";
import { createSignatureTools } from "./signature.js";
import { createZipTools } from "./zip.js";

export function createParser(runtime) {
  if (!runtime?.Blob) {
    throw new Error("Blob is required in the parser runtime");
  }
  if (!runtime?.crypto?.subtle) {
    throw new Error("crypto.subtle is required in the parser runtime");
  }
  if (typeof runtime?.fetch !== "function") {
    throw new Error("fetch is required in the parser runtime");
  }
  if (typeof runtime?.inflateRaw !== "function") {
    throw new Error("inflateRaw is required in the parser runtime");
  }
  if (!runtime?.TextDecoder || !runtime?.TextEncoder) {
    throw new Error("TextDecoder and TextEncoder are required in the parser runtime");
  }

  const apkSigBlockMagic = new runtime.TextEncoder().encode("APK Sig Block 42");
  const textDecoder = new runtime.TextDecoder();
  const utf8Decoder = new runtime.TextDecoder("utf-8", { fatal: false });

  const zipTools = createZipTools({
    runtime,
    textDecoder,
    apkSigBlockMagic,
  });
  const resourceTools = createResourceTools({
    runtime,
    utf8Decoder,
    zipTools,
  });
  const signatureTools = createSignatureTools({
    runtime,
    utf8Decoder,
    zipTools,
  });

  async function parseApkSource(source, options = {}) {
    await source.ensureZipInfo();
    const info = await resourceTools.getSourceApkBasicInfo(source, options);
    const signatures = await signatureTools.parseSourceApkSignatures(source);
    return { ...info, signatures };
  }

  async function parseApkFile(file, options = {}) {
    return parseApkSource(zipTools.createBlobSource(file), options);
  }

  async function parseApkUrl(url, options = {}) {
    return parseApkSource(zipTools.createRemoteSource(url), options);
  }

  return {
    parseApkFile,
    parseApkUrl,
  };
}
