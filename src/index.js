import { createNodeRuntime } from "./runtime/node.js";
import { createParser } from "./core/api.js";

export function createNodeParser(options = {}) {
  return createParser(createNodeRuntime(options));
}

const parser = createNodeParser();

export { createParser, createNodeRuntime };
export const parseApkFile = parser.parseApkFile;
export const parseApkUrl = parser.parseApkUrl;
