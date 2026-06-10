export function createBaseRuntime(overrides = {}) {
  const fetchImpl = overrides.fetch ?? globalThis.fetch;
  const getDefaultLocale = overrides.getDefaultLocale || (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().locale || "";
    } catch {
      return "";
    }
  });

  return {
    Blob: overrides.Blob || globalThis.Blob,
    crypto: overrides.crypto || globalThis.crypto,
    fetch: overrides.fetch == null && typeof fetchImpl === "function"
      ? fetchImpl.bind(globalThis)
      : fetchImpl,
    getDefaultLocale,
    kind: overrides.kind || "unknown",
    TextDecoder: overrides.TextDecoder || globalThis.TextDecoder,
    TextEncoder: overrides.TextEncoder || globalThis.TextEncoder,
    inflateRaw: overrides.inflateRaw,
  };
}
