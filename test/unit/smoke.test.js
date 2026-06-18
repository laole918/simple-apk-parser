import { describe, expect, it } from "vitest";
import { createParser } from "../../src/core/api.js";
import { normalizeParseOptions } from "../../src/core/types.js";
import { openAsBlob } from "node:fs";
import { existsSync } from "node:fs";
import { createNodeRuntime } from "../../src/runtime/node.js";
import { createBrowserRuntime } from "../../src/runtime/browser.js";
import { createBaseRuntime } from "../../src/runtime/shared.js";
import { createNodeParser, parseApkFile, parseApkUrl } from "../../src/index.js";
import { createBrowserParser } from "../../src/browser.js";
import { createZipTools } from "../../src/core/zip.js";
import { createResourceTools } from "../../src/core/resources.js";
import { digestHexWithRuntime } from "../../src/core/binary.js";

describe("public API", () => {
  it("exposes the public functions", () => {
    expect(typeof parseApkFile).toBe("function");
    expect(typeof parseApkUrl).toBe("function");
    expect(typeof createNodeParser).toBe("function");
    expect(typeof createBrowserParser).toBe("function");
  });

  it("defaults to loading resources and supports disabling them", () => {
    expect(normalizeParseOptions(undefined, {
      getDefaultLocale: () => "en-US",
    })).toEqual({
      loadResources: true,
      locale: "en-US",
    });

    expect(normalizeParseOptions({
      loadResources: false,
      locale: "zh-CN",
    }, {
      getDefaultLocale: () => "en-US",
    })).toEqual({
      loadResources: false,
      locale: "zh-CN",
    });
  });

  it("surfaces runtime-specific remote fetch errors", async () => {
    const nodeParser = createParser(createNodeRuntime({
      fetch: async () => {
        throw new TypeError("getaddrinfo ENOTFOUND example.com");
      },
    }));
    const browserParser = createParser(createBrowserRuntime({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    }));

    await expect(nodeParser.parseApkUrl("https://example.com/app.apk")).rejects.toThrow(
      "The Node.js runtime failed the request before a response was received"
    );
    await expect(browserParser.parseApkUrl("https://example.com/app.apk")).rejects.toThrow(
      "The browser failed the request before a response was received"
    );
  });

  it("preserves the original this binding for injected fetch implementations", async () => {
    const injectedFetch = () => {
      throw new Error("injected fetch called");
    };

    const runtime = createBaseRuntime({
      fetch: injectedFetch,
    });

    expect(runtime.fetch).toBe(injectedFetch);
    expect(() => runtime.fetch()).toThrow("injected fetch called");
  });

  it("accepts a custom digest implementation when crypto.subtle is unavailable", async () => {
    const runtime = createBaseRuntime({
      Blob,
      TextDecoder,
      TextEncoder,
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
      inflateRaw: async () => {
        throw new Error("inflateRaw should not be called");
      },
      crypto: undefined,
      digest: async (algorithm, data) => {
        expect(algorithm).toBe("SHA-1");
        expect(data).toBeInstanceOf(Uint8Array);
        return new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
      },
    });

    const parser = createParser(runtime);
    expect(parser).toMatchObject({
      parseApkFile: expect.any(Function),
      parseApkUrl: expect.any(Function),
    });

    await expect(digestHexWithRuntime(runtime, "SHA-1", new Uint8Array([1, 2, 3]))).resolves.toBe("deadbeef");
  });

  it("normalizes custom digest hex strings", async () => {
    const runtime = createBaseRuntime({
      digest: async () => "AABBCCDD",
      Blob,
      TextDecoder,
      TextEncoder,
      fetch,
      inflateRaw: async data => data,
    });

    const parser = createParser(runtime);
    expect(parser).toBeTruthy();

    await expect(digestHexWithRuntime(runtime, "SHA-1", new Uint8Array([1, 2, 3]))).resolves.toBe("aabbccdd");
  });

  it("prefers digest() over crypto.subtle when both are available", async () => {
    const runtime = createBaseRuntime({
      Blob,
      TextDecoder,
      TextEncoder,
      fetch,
      inflateRaw: async data => data,
      digest: async () => "AAAAAAAA",
      crypto: {
        subtle: {
          digest: async () => new Uint8Array([0xbb, 0xbb, 0xbb, 0xbb]),
        },
      },
    });

    await expect(digestHexWithRuntime(runtime, "SHA-256", new Uint8Array([1, 2, 3]))).resolves.toBe("aaaaaaaa");
  });

  it("rejects invalid custom digest return values", async () => {
    const runtime = createBaseRuntime({
      Blob,
      TextDecoder,
      TextEncoder,
      fetch,
      inflateRaw: async data => data,
      digest: async () => ({ bad: true }),
    });

    await expect(digestHexWithRuntime(runtime, "SHA-1", new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "Custom digest() must return a hex string, ArrayBuffer, or typed array"
    );
  });

  it("throws a clearer error when neither crypto.subtle nor custom digest is available", () => {
    expect(() => createParser(createBaseRuntime({
      Blob,
      TextDecoder,
      TextEncoder,
      fetch,
      inflateRaw: async data => data,
      crypto: undefined,
    }))).toThrow(
      "A digest implementation is required. Provide runtime.digest(), or ensure crypto.subtle is available."
    );
  });

  it("decodes packed three-letter locale codes from resource configs", () => {
    const resourceTools = createResourceTools({
      runtime: createNodeRuntime(),
      utf8Decoder: new TextDecoder("utf-8"),
      zipTools: {},
    });

    function packThreeLetterCode(value, baseCharCode) {
      const a = value.charCodeAt(0) - baseCharCode;
      const b = value.charCodeAt(1) - baseCharCode;
      const c = value.charCodeAt(2) - baseCharCode;

      return new Uint8Array([
        0x80 | ((c & 0x1f) << 2) | ((b >> 3) & 0x03),
        ((b & 0x07) << 5) | (a & 0x1f),
      ]);
    }

    const packedLanguage = packThreeLetterCode("fil", 0x61);
    const packedRegion = packThreeLetterCode("419", 0x30);
    const data = new Uint8Array([
      packedLanguage[0],
      packedLanguage[1],
      packedRegion[0],
      packedRegion[1],
    ]);

    expect(resourceTools.parseResTableLanguage(data, 0)).toBe("fil");
    expect(resourceTools.parseResTableRegion(data, 2)).toBe("419");
  });

  it("parses sparse resource type chunks", () => {
    const resourceTools = createResourceTools({
      runtime: createNodeRuntime(),
      utf8Decoder: new TextDecoder("utf-8"),
      zipTools: {},
    });

    const packageData = new Uint8Array(128);
    packageData[2] = 0x08;
    packageData[3] = 0x00;

    const subOff = 8;
    packageData[subOff] = 0x01;
    packageData[subOff + 1] = 0x02;
    packageData[subOff + 2] = 0x24;
    packageData[subOff + 3] = 0x00;
    packageData[subOff + 4] = 0x78;
    packageData[subOff + 8] = 0x01;
    packageData[subOff + 9] = 0x01;
    packageData[subOff + 12] = 0x08;
    packageData[subOff + 16] = 0x2c;
    packageData[subOff + 20] = 0x10;

    const mapOff = subOff + 0x24;
    packageData[mapOff] = 0x03;
    packageData[mapOff + 1] = 0x00;
    packageData[mapOff + 2] = 0x00;
    packageData[mapOff + 3] = 0x00;
    packageData[mapOff + 4] = 0x07;
    packageData[mapOff + 5] = 0x00;
    packageData[mapOff + 6] = 0x04;
    packageData[mapOff + 7] = 0x00;

    const firstEntryOff = subOff + 0x2c;
    packageData[firstEntryOff] = 0x08;
    packageData[firstEntryOff + 8 + 3] = 0x03;
    packageData[firstEntryOff + 8 + 4] = 0x0b;

    const secondEntryOff = subOff + 0x2c + 16;
    packageData[secondEntryOff] = 0x08;
    packageData[secondEntryOff + 8 + 3] = 0x03;
    packageData[secondEntryOff + 8 + 4] = 0x16;

    const entries = resourceTools.parsePackageEntries(packageData, 0, packageData.length, 0x7f, ["string"]);

    expect(entries.get(0x7f010003)?.[0]?.valueData).toBe(0x0b);
    expect(entries.get(0x7f010007)?.[0]?.valueData).toBe(0x16);
  });

  it("does not treat xml icon resources as bitmap blobs", () => {
    const resourceTools = createResourceTools({
      runtime: createNodeRuntime(),
      utf8Decoder: new TextDecoder("utf-8"),
      zipTools: {},
    });

    expect(resourceTools.getImageMimeType("res/mipmap-anydpi-v26/ic_launcher.xml")).toBe("");
    expect(resourceTools.getImageMimeType("res/mipmap-xxhdpi/ic_launcher.png")).toBe("image/png");
  });

  it("combines versionCodeMajor with versionCode into a long version code", () => {
    const resourceTools = createResourceTools({
      runtime: createNodeRuntime(),
      utf8Decoder: new TextDecoder("utf-8"),
      zipTools: {},
    });

    expect(resourceTools.buildLongVersionCode(0, 123)).toBe(123);
    expect(resourceTools.buildLongVersionCode(2, 5)).toBe((2n << 32n) | 5n);
  });

  it("finds the last matching entry in a directory window", async () => {
    const textEncoder = new TextEncoder();
    const zipTools = createZipTools({
      runtime: createNodeRuntime(),
      textDecoder: new TextDecoder(),
      apkSigBlockMagic: textEncoder.encode("APK Sig Block 42"),
    });

    function createCentralDirectoryEntry(name, localHeaderOff) {
      const nameBytes = textEncoder.encode(name);
      const bytes = new Uint8Array(46 + nameBytes.length);

      bytes.set([0x50, 0x4b, 0x01, 0x02], 0);
      bytes[10] = 0;
      bytes[11] = 0;
      bytes[20] = 0;
      bytes[21] = 0;
      bytes[22] = 0;
      bytes[23] = 0;
      bytes[24] = 0;
      bytes[25] = 0;
      bytes[26] = 0;
      bytes[27] = 0;
      bytes[28] = nameBytes.length & 0xff;
      bytes[29] = (nameBytes.length >> 8) & 0xff;
      bytes[42] = localHeaderOff & 0xff;
      bytes[43] = (localHeaderOff >> 8) & 0xff;
      bytes[44] = (localHeaderOff >> 16) & 0xff;
      bytes[45] = (localHeaderOff >> 24) & 0xff;
      bytes.set(nameBytes, 46);

      return bytes;
    }

    const directoryWindow = new Uint8Array([
      ...createCentralDirectoryEntry("META-INF/OLD.RSA", 1),
      ...createCentralDirectoryEntry("META-INF/NEW.RSA", 2),
    ]);

    const entry = zipTools.findEntryInDirectoryWindow(directoryWindow, candidate =>
      candidate.name.startsWith("META-INF/") && candidate.name.endsWith(".RSA")
    );

    expect(entry?.name).toBe("META-INF/NEW.RSA");
  });

  it("throws a clear error for ZIP64 APKs", async () => {
    const zip64Path = "/private/tmp/zip64-test2.apk";

    if (!existsSync(zip64Path)) {
      return;
    }

    const parser = createParser(createNodeRuntime());
    const blob = await openAsBlob(zip64Path);

    await expect(parser.parseApkFile(blob)).rejects.toThrow("ZIP64 APK is not supported");
  });
});
