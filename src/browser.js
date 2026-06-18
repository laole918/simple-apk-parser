import { createBrowserRuntime } from "./runtime/browser.js";
import { createParser } from "./core/api.js";

export function createBrowserParser(options = {}) {
  return createParser(createBrowserRuntime(options));
}

const parser = createBrowserParser();

export { createBrowserRuntime, createParser };
export const parseApkFile = parser.parseApkFile;
export const parseApkUrl = parser.parseApkUrl;
