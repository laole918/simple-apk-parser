import { createNodeRuntime } from "./runtime/node.js";
import { createParser } from "./core/api.js";

export function createNodeParser(options = {}) {
  return createParser(createNodeRuntime(options));
}

let defaultParser;

function getDefaultParser() {
  defaultParser ||= createNodeParser();
  return defaultParser;
}

export { createParser, createNodeRuntime };
export function parseApkFile(...args) {
  return getDefaultParser().parseApkFile(...args);
}

export function parseApkUrl(...args) {
  return getDefaultParser().parseApkUrl(...args);
}
