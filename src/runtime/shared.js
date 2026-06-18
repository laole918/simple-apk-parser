export function createBaseRuntime(overrides = {}) {
  const fetchImpl = overrides.fetch ?? globalThis.fetch;
  const hasOwn = key => Object.prototype.hasOwnProperty.call(overrides, key);
  const getDefaultLocale = overrides.getDefaultLocale || (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().locale || "";
    } catch {
      return "";
    }
  });

  return {
    Blob: hasOwn("Blob") ? overrides.Blob : globalThis.Blob,
    crypto: hasOwn("crypto") ? overrides.crypto : globalThis.crypto,
    digest: hasOwn("digest") ? overrides.digest : undefined,
    fetch: overrides.fetch == null && typeof fetchImpl === "function"
      ? fetchImpl.bind(globalThis)
      : fetchImpl,
    getDefaultLocale,
    kind: overrides.kind || "unknown",
    TextDecoder: hasOwn("TextDecoder") ? overrides.TextDecoder : globalThis.TextDecoder,
    TextEncoder: hasOwn("TextEncoder") ? overrides.TextEncoder : globalThis.TextEncoder,
    inflateRaw: hasOwn("inflateRaw") ? overrides.inflateRaw : undefined,
  };
}
