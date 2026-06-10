import { createBrowserRuntime } from "./runtime/browser.js";
import { createParser } from "./core/api.js";

const parser = createParser(createBrowserRuntime());

export const parseApkFile = parser.parseApkFile;
export const parseApkUrl = parser.parseApkUrl;
