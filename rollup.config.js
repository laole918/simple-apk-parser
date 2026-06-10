import { nodeResolve } from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";

const extensions = [".js"];

export default [
  {
    input: "src/index.js",
    output: {
      file: "dist/simple-apk-parser.js",
      format: "esm",
      sourcemap: true,
    },
    plugins: [nodeResolve({ extensions, preferBuiltins: true })],
  },
  {
    input: "src/browser.js",
    output: {
      file: "dist/simple-apk-parser.browser.js",
      format: "esm",
      sourcemap: true,
    },
    plugins: [nodeResolve({ extensions, browser: true, preferBuiltins: false })],
  },
  {
    input: "src/browser-global.js",
    output: {
      file: "dist/simple-apk-parser.iife.js",
      format: "iife",
      name: "SimpleApkParser",
      sourcemap: true,
    },
    plugins: [nodeResolve({ extensions, browser: true, preferBuiltins: false })],
  },
  {
    input: "src/browser-global.js",
    output: {
      file: "dist/simple-apk-parser.iife.min.js",
      format: "iife",
      name: "SimpleApkParser",
      sourcemap: true,
    },
    plugins: [
      nodeResolve({ extensions, browser: true, preferBuiltins: false }),
      terser(),
    ],
  },
];
