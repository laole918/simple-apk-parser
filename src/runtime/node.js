import { createBaseRuntime } from "./shared.js";

async function inflateRawNode(data) {
  const { inflateRaw } = await import("node:zlib");

  return await new Promise((resolve, reject) => {
    inflateRaw(Buffer.from(data), (err, out) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(new Uint8Array(out));
    });
  });
}

export function createNodeRuntime(overrides = {}) {
  return createBaseRuntime({
    ...overrides,
    kind: overrides.kind || "node",
    inflateRaw: overrides.inflateRaw || inflateRawNode,
  });
}
