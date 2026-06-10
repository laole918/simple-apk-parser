import { createNodeRuntime } from "./runtime/node.js";
import { createParser } from "./core/api.js";

const parser = createParser(createNodeRuntime());

export const parseApkFile = parser.parseApkFile;
export const parseApkUrl = parser.parseApkUrl;
