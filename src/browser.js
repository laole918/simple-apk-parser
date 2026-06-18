import { createBrowserRuntime } from "./runtime/browser.js";
import { createParser } from "./core/api.js";

export function createBrowserParser(options = {}) {
  return createParser(createBrowserRuntime(options));
}

let defaultParser;

function getDefaultParser() {
  defaultParser ||= createBrowserParser();
  return defaultParser;
}

export { createBrowserRuntime, createParser };
export function parseApkFile(...args) {
  return getDefaultParser().parseApkFile(...args);
}

export function parseApkUrl(...args) {
  return getDefaultParser().parseApkUrl(...args);
}
