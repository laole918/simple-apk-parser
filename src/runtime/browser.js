import { createBaseRuntime } from "./shared.js";

async function inflateRawBrowser(data) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser does not support DecompressionStream");
  }

  const stream = new Blob([data]).stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export function createBrowserRuntime(overrides = {}) {
  return createBaseRuntime({
    ...overrides,
    kind: overrides.kind || "browser",
    inflateRaw: overrides.inflateRaw || inflateRawBrowser,
  });
}

export const browserRuntime = createBrowserRuntime();
