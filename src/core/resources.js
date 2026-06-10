import { readU16LE, readU32LE } from "./binary.js";
import { normalizeParseOptions } from "./types.js";

const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_TYPE = 0x0003;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const RES_TABLE_PACKAGE_TYPE = 0x0200;
const RES_TABLE_TYPE_TYPE = 0x0201;

const ATTR_PACKAGE = "package";
const ATTR_VERSION_CODE = 0x0101021b;
const ATTR_VERSION_CODE_MAJOR = 0x01010576;
const ATTR_VERSION_NAME = 0x0101021c;
const ATTR_LABEL = 0x01010001;
const ATTR_ICON = 0x01010002;
const RES_TABLE_TYPE_FLAG_SPARSE = 0x01;
const RES_TABLE_TYPE_FLAG_OFFSET16 = 0x02;

export function createResourceTools({ runtime, utf8Decoder, zipTools }) {
  function normalizeScript(script) {
    if (typeof script !== "string") return "";
    const trimmed = script.trim();
    if (!/^[A-Za-z]{4}$/.test(trimmed)) {
      return "";
    }
    return trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase();
  }

  function inferScript(language, region) {
    if (language === "zh") {
      if (region === "CN" || region === "SG") return "Hans";
      if (region === "TW" || region === "HK" || region === "MO") return "Hant";
    }
    return "";
  }

  function parseLocalePreference(locale) {
    if (typeof locale !== "string") {
      return { language: "", script: "", region: "" };
    }

    const normalized = locale.trim().replace(/_/g, "-");
    if (!normalized) {
      return { language: "", script: "", region: "" };
    }

    const parts = normalized.split("-").filter(Boolean);
    const language = (parts[0] || "").toLowerCase();
    let script = "";
    let region = "";

    for (const part of parts.slice(1)) {
      if (!script && /^[A-Za-z]{4}$/.test(part)) {
        script = normalizeScript(part);
        continue;
      }
      if (/^[A-Za-z]{2}$/.test(part) || /^\d{3}$/.test(part)) {
        region = part.toUpperCase();
        break;
      }
    }

    return {
      language,
      script: script || inferScript(language, region),
      region,
    };
  }

  function readUtf16String(data, off, charCount) {
    let s = "";
    for (let i = 0; i < charCount; i++) {
      const c = readU16LE(data, off + i * 2);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }

  function readUtf8Len(data, off) {
    let len = data[off++];
    if (len & 0x80) {
      len = ((len & 0x7f) << 8) | data[off++];
    }
    return { len, off };
  }

  function readUtf16Len(data, off) {
    let len = readU16LE(data, off);
    off += 2;
    if (len & 0x8000) {
      len = ((len & 0x7fff) << 16) | readU16LE(data, off);
      off += 2;
    }
    return { len, off };
  }

  function parseStringPool(data, offset) {
    const headerSize = readU16LE(data, offset + 2);
    const chunkSize = readU32LE(data, offset + 4);
    const stringCount = readU32LE(data, offset + 8);
    const flags = readU32LE(data, offset + 16);
    const stringsStart = readU32LE(data, offset + 20);
    const isUtf8 = (flags & 0x00000100) !== 0;
    const stringOffsets = [];
    const offsetsStart = offset + headerSize;

    for (let i = 0; i < stringCount; i++) {
      stringOffsets.push(readU32LE(data, offsetsStart + i * 4));
    }

    const strings = [];

    for (let i = 0; i < stringCount; i++) {
      let strOff = offset + stringsStart + stringOffsets[i];

      if (isUtf8) {
        strOff = readUtf8Len(data, strOff).off;
        const byteLenInfo = readUtf8Len(data, strOff);
        const byteLen = byteLenInfo.len;
        strOff = byteLenInfo.off;
        const bytes = data.slice(strOff, strOff + byteLen);
        strings.push(utf8Decoder.decode(bytes));
      } else {
        const utf16Len = readUtf16Len(data, strOff);
        strings.push(readUtf16String(data, utf16Len.off, utf16Len.len));
      }
    }

    return { strings, size: chunkSize };
  }

  function typedValueToJs(dataType, dataValue, strings) {
    if (dataType === 0x03) {
      return strings[dataValue] || "";
    }

    if (dataType === 0x10) {
      return dataValue >>> 0;
    }

    if (dataType === 0x11) {
      return `0x${(dataValue >>> 0).toString(16)}`;
    }

    if (dataType === 0x01) {
      return `@0x${(dataValue >>> 0).toString(16).padStart(8, "0")}`;
    }

    if (dataType === 0x12) {
      return dataValue !== 0;
    }

    return dataValue;
  }

  function parseBinaryManifest(data) {
    if (readU16LE(data, 0) !== RES_XML_TYPE) {
      throw new Error("AndroidManifest.xml is not binary XML");
    }

    const rootHeaderSize = readU16LE(data, 2);
    let off = rootHeaderSize;
    let strings = [];
    let resourceMap = [];

    const result = {
      packageName: "",
      versionCode: "",
      versionCodeMajor: 0,
      versionName: "",
      appNameRef: "",
      iconRef: "",
    };

    while (off + 8 <= data.length) {
      const chunkType = readU16LE(data, off);
      const headerSize = readU16LE(data, off + 2);
      const chunkSize = readU32LE(data, off + 4);

      if (chunkSize <= 0) break;

      if (chunkType === RES_STRING_POOL_TYPE) {
        strings = parseStringPool(data, off).strings;
      } else if (chunkType === RES_XML_RESOURCE_MAP_TYPE) {
        resourceMap = [];
        const count = (chunkSize - headerSize) / 4;
        for (let i = 0; i < count; i++) {
          resourceMap.push(readU32LE(data, off + headerSize + i * 4));
        }
      } else if (chunkType === RES_XML_START_ELEMENT_TYPE) {
        const elemNameIdx = readU32LE(data, off + 20);
        const elemName = strings[elemNameIdx] || "";
        const attrStart = readU16LE(data, off + 24);
        const attrSize = readU16LE(data, off + 26);
        const attrCount = readU16LE(data, off + 28);
        const attrsOff = off + 16 + attrStart;

        for (let i = 0; i < attrCount; i++) {
          const aoff = attrsOff + i * attrSize;
          const nameIdx = readU32LE(data, aoff + 4);
          const rawValueIdx = readU32LE(data, aoff + 8);
          const dataType = data[aoff + 15];
          const dataValue = readU32LE(data, aoff + 16);
          const attrName = strings[nameIdx] || "";
          const attrResId = resourceMap[nameIdx] || 0;

          let value;
          if (rawValueIdx !== 0xffffffff) {
            value = strings[rawValueIdx] || "";
          } else {
            value = typedValueToJs(dataType, dataValue, strings);
          }

          if (elemName === "manifest") {
            if (attrName === ATTR_PACKAGE) {
              result.packageName = value;
            }
            if (attrName === "versionCode" || attrResId === ATTR_VERSION_CODE) {
              result.versionCode = value;
            }
            if (attrName === "versionCodeMajor" || attrResId === ATTR_VERSION_CODE_MAJOR) {
              result.versionCodeMajor = typeof value === "number" ? value : Number(value) || 0;
            }
            if (attrName === "versionName" || attrResId === ATTR_VERSION_NAME) {
              result.versionName = value;
            }
          }

          if (elemName === "application") {
            if (attrName === "label" || attrResId === ATTR_LABEL) {
              result.appNameRef = value;
            }
            if (attrName === "icon" || attrResId === ATTR_ICON) {
              result.iconRef = value;
            }
          }
        }
      }

      off += chunkSize;
    }

    return result;
  }

  function parseResTableLanguage(data, off) {
    const b0 = data[off];
    const b1 = data[off + 1];

    if (!b0 && !b1) return "";

    const isAsciiLower = byte => byte >= 0x61 && byte <= 0x7a;
    if (isAsciiLower(b0) && isAsciiLower(b1)) {
      return String.fromCharCode(b0, b1);
    }

    if (b0 & 0x80) {
      const c0 = 0x61 + (b1 & 0x1f);
      const c1 = 0x61 + (((b1 & 0xe0) >> 5) | ((b0 & 0x03) << 3));
      const c2 = 0x61 + ((b0 & 0x7c) >> 2);
      return String.fromCharCode(c0, c1, c2);
    }

    return "";
  }

  function parseResTableRegion(data, off) {
    const b0 = data[off];
    const b1 = data[off + 1];

    if (!b0 && !b1) return "";

    const isAsciiUpper = byte => byte >= 0x41 && byte <= 0x5a;
    if (isAsciiUpper(b0) && isAsciiUpper(b1)) {
      return String.fromCharCode(b0, b1);
    }

    if (b0 & 0x80) {
      const c0 = 0x30 + (b1 & 0x1f);
      const c1 = 0x30 + (((b1 & 0xe0) >> 5) | ((b0 & 0x03) << 3));
      const c2 = 0x30 + ((b0 & 0x7c) >> 2);
      return String.fromCharCode(c0, c1, c2);
    }

    return "";
  }

  function parseResTableScript(data, off, configSize, language, region) {
    if (configSize < 36) {
      return inferScript(language, region);
    }

    const bytes = data.slice(off + 32, off + 36);
    if (bytes.every(byte => byte === 0)) {
      return inferScript(language, region);
    }

    const raw = String.fromCharCode(...bytes).replace(/\0+$/, "");
    const normalized = normalizeScript(raw);
    return normalized || inferScript(language, region);
  }

  function parseResTableDensity(data, off, configSize) {
    if (configSize < 16) return 0;
    return readU16LE(data, off + 14);
  }

  function getLocaleScore(language, script, region, locale) {
    const preference = parseLocalePreference(locale);

    if (preference.language) {
      if (
        language === preference.language &&
        preference.script &&
        script === preference.script &&
        preference.region &&
        region === preference.region
      ) {
        return 8;
      }
      if (language === preference.language && preference.region && region === preference.region) {
        return 7;
      }
      if (language === preference.language && preference.script && script === preference.script && !region) {
        return 6;
      }
      if (language === preference.language && preference.script && script === preference.script) {
        return 5;
      }
      if (language === preference.language && !script && !region) {
        return 4;
      }
      if (!language && !script) {
        return 3;
      }
      if (language === preference.language && !script) {
        return 2;
      }
      if (language === preference.language) {
        return 1;
      }
      return 0;
    }

    if (!language && !script) return 1;
    return 0;
  }

  function getDensityScore(density) {
    if (density === 0xffff) return 10000;
    if (density === 0xfffe) return 50;
    if (!density) return 100;
    return density;
  }

  function getTypeScore(typeName, preferMipmap) {
    if (!preferMipmap) return 0;
    if (typeName === "mipmap") return 2;
    if (typeName === "drawable") return 1;
    return 0;
  }

  function getCandidateScore(candidate, options) {
    const localeScore = getLocaleScore(
      candidate.language,
      candidate.script,
      candidate.region,
      options.locale
    ) * 1_000_000;
    const densityScore = getDensityScore(candidate.density) * 100;
    const typeScore = getTypeScore(candidate.typeName, options.preferMipmap) * 10;
    return localeScore + densityScore + typeScore;
  }

  function chooseBestResourceCandidate(candidates, options) {
    let best = null;

    for (const candidate of candidates) {
      const score = getCandidateScore(candidate, options);
      if (!best || score > best.score) {
        best = { ...candidate, score };
      }
    }

    return best;
  }

  function getPackageTypeNames(data, packageOff, packageChunkSize) {
    const typeStringsOff = readU32LE(data, packageOff + 268);
    if (!typeStringsOff) return [];

    const absoluteOff = packageOff + typeStringsOff;
    const packageEnd = packageOff + packageChunkSize;
    if (absoluteOff + 8 > packageEnd) {
      return [];
    }

    return parseStringPool(data, absoluteOff).strings;
  }

  function parsePackageEntries(data, packageOff, packageChunkSize, pkgId, typeNames) {
    const entriesByResId = new Map();
    const headerSize = readU16LE(data, packageOff + 2);
    let subOff = packageOff + headerSize;
    const pkgEnd = packageOff + packageChunkSize;

    while (subOff < pkgEnd) {
      const subType = readU16LE(data, subOff);
      const subHeaderSize = readU16LE(data, subOff + 2);
      const subChunkSize = readU32LE(data, subOff + 4);

      if (subChunkSize <= 0) break;

      if (subType === RES_TABLE_TYPE_TYPE) {
        const typeId = data[subOff + 8];
        const typeFlags = data[subOff + 9];
        const entryCount = readU32LE(data, subOff + 12);
        const entriesStart = readU32LE(data, subOff + 16);
        const configSize = readU32LE(data, subOff + 20);
        const configOff = subOff + 20;
        const language = configSize >= 12 ? parseResTableLanguage(data, subOff + 28) : "";
        const region = configSize >= 12 ? parseResTableRegion(data, subOff + 30) : "";
        const script = parseResTableScript(data, subOff, configSize, language, region);
        const density = parseResTableDensity(data, configOff, configSize);
        const typeName = typeNames[typeId - 1] || "";
        const isSparse = (typeFlags & RES_TABLE_TYPE_FLAG_SPARSE) !== 0;
        const usesOffset16 = isSparse || (typeFlags & RES_TABLE_TYPE_FLAG_OFFSET16) !== 0;
        const entryMapSize = Math.max(0, entriesStart - subHeaderSize);
        const entryMapOff = subOff + subHeaderSize;

        if (isSparse) {
          const sparseCount = Math.floor(entryMapSize / 4);

          for (let i = 0; i < sparseCount; i++) {
            const entryIndexOff = entryMapOff + i * 4;
            const entryId = readU16LE(data, entryIndexOff);
            if (entryId >= entryCount) continue;

            const entryOffEncoded = readU16LE(data, entryIndexOff + 2);
            if (entryOffEncoded === 0xffff) continue;

            const entryOff = usesOffset16 ? entryOffEncoded * 4 : entryOffEncoded;
            const entryAbsOff = subOff + entriesStart + entryOff;
            const entrySize = readU16LE(data, entryAbsOff);
            const entryFlags = readU16LE(data, entryAbsOff + 2);
            if ((entryFlags & 0x0001) !== 0) continue;

            const valueOff = entryAbsOff + entrySize;
            const valueType = data[valueOff + 3];
            const valueData = readU32LE(data, valueOff + 4);
            const resId = ((pkgId << 24) | (typeId << 16) | entryId) >>> 0;
            const candidates = entriesByResId.get(resId) || [];
            candidates.push({
              valueType,
              valueData,
              language,
              script,
              region,
              density,
              typeName,
            });
            entriesByResId.set(resId, candidates);
          }
        } else {
          const indexSize = usesOffset16 ? 2 : 4;
          const indexedEntryCount = Math.min(entryCount, Math.floor(entryMapSize / indexSize));

          for (let entryId = 0; entryId < indexedEntryCount; entryId++) {
            const entryIndexOff = entryMapOff + entryId * indexSize;
            const entryOffEncoded = usesOffset16
              ? readU16LE(data, entryIndexOff)
              : readU32LE(data, entryIndexOff);
            if (entryOffEncoded === (usesOffset16 ? 0xffff : 0xffffffff)) continue;

            const entryOff = usesOffset16 ? entryOffEncoded * 4 : entryOffEncoded;
            const entryAbsOff = subOff + entriesStart + entryOff;
            const entrySize = readU16LE(data, entryAbsOff);
            const entryFlags = readU16LE(data, entryAbsOff + 2);
            if ((entryFlags & 0x0001) !== 0) continue;

            const valueOff = entryAbsOff + entrySize;
            const valueType = data[valueOff + 3];
            const valueData = readU32LE(data, valueOff + 4);
            const resId = ((pkgId << 24) | (typeId << 16) | entryId) >>> 0;
            const candidates = entriesByResId.get(resId) || [];
            candidates.push({
              valueType,
              valueData,
              language,
              script,
              region,
              density,
              typeName,
            });
            entriesByResId.set(resId, candidates);
          }
        }
      }

      subOff += subChunkSize;
    }

    return entriesByResId;
  }

  function parseResourceTable(data) {
    let off = 12;
    let globalStrings = [];
    const entriesByResId = new Map();

    while (off < data.length) {
      const type = readU16LE(data, off);
      const chunkSize = readU32LE(data, off + 4);

      if (chunkSize <= 0) break;

      if (type === RES_STRING_POOL_TYPE) {
        globalStrings = parseStringPool(data, off).strings;
        break;
      }

      off += chunkSize;
    }

    off = 12;

    while (off < data.length) {
      const type = readU16LE(data, off);
      const headerSize = readU16LE(data, off + 2);
      const chunkSize = readU32LE(data, off + 4);

      if (chunkSize <= 0) break;

      if (type === RES_TABLE_PACKAGE_TYPE) {
        const pkgId = readU32LE(data, off + 8);
        const typeNames = getPackageTypeNames(data, off, chunkSize);
        const packageEntries = parsePackageEntries(data, off, chunkSize, pkgId, typeNames);
        for (const [resId, candidates] of packageEntries) {
          const existing = entriesByResId.get(resId) || [];
          existing.push(...candidates);
          entriesByResId.set(resId, existing);
        }
      }

      off += chunkSize;
    }

    return { globalStrings, entriesByResId };
  }

  function resolveResourceValue(resourceTable, targetResId, options = {}) {
    const seen = new Set();
    let curResId = targetResId >>> 0;

    while (curResId && !seen.has(curResId)) {
      seen.add(curResId);

      const candidates = resourceTable.entriesByResId.get(curResId);
      if (!candidates || !candidates.length) return "";

      const entry = chooseBestResourceCandidate(candidates, options);

      if (entry.valueType === 0x03) {
        return resourceTable.globalStrings[entry.valueData] || "";
      }

      if (entry.valueType === 0x01) {
        curResId = entry.valueData >>> 0;
        continue;
      }

      return "";
    }

    return "";
  }

  function parseResRef(ref) {
    if (typeof ref !== "string") return 0;
    if (!ref.startsWith("@0x")) return 0;
    return parseInt(ref.slice(3), 16) >>> 0;
  }

  function getImageMimeType(path) {
    const normalizedPath = path.toLowerCase();

    if (normalizedPath.endsWith(".webp")) return "image/webp";
    if (normalizedPath.endsWith(".jpg") || normalizedPath.endsWith(".jpeg")) return "image/jpeg";
    if (normalizedPath.endsWith(".png")) return "image/png";
    return "";
  }

  function buildLongVersionCode(versionCodeMajor, versionCode) {
    const low = typeof versionCode === "number" ? versionCode >>> 0 : Number(versionCode) >>> 0;
    const high = typeof versionCodeMajor === "number"
      ? versionCodeMajor >>> 0
      : Number(versionCodeMajor) >>> 0;

    if (!high) {
      return low;
    }

    return (BigInt(high) << 32n) | BigInt(low);
  }

  async function readResourceTable(data, zipInfo, needed) {
    if (!needed) return null;

    const arscEntry = zipInfo.entries.find(entry => entry.name === "resources.arsc");
    if (!arscEntry) return null;

    const arscData = await zipTools.readZipEntry(data, arscEntry);
    return parseResourceTable(arscData);
  }

  async function getSourceResourceResolver(source, needed) {
    if (!needed) return null;
    if (source.resourceResolver) {
      return source.resourceResolver;
    }

    const arscEntry = await source.getEntryByName("resources.arsc");
    if (!arscEntry) {
      source.resourceResolver = null;
      return null;
    }

    const arscData = await source.readEntry(arscEntry);
    const resourceTable = parseResourceTable(arscData);
    source.resourceResolver = {
      async resolve(targetResId, options = {}) {
        return resolveResourceValue(resourceTable, targetResId, options);
      },
    };
    return source.resourceResolver;
  }

  async function getApkBasicInfo(data, options = {}) {
    const parseOptions = normalizeParseOptions(options, runtime);
    const zipInfo = zipTools.parseZipEntries(data);
    const manifestEntry = zipInfo.entries.find(entry => entry.name === "AndroidManifest.xml");
    if (!manifestEntry) {
      throw new Error("AndroidManifest.xml not found");
    }

    const manifestData = await zipTools.readZipEntry(data, manifestEntry);
    const manifest = parseBinaryManifest(manifestData);

    let appName = "";
    let iconPath = "";
    let iconBlob = null;
    const labelResId = parseResRef(manifest.appNameRef);
    const iconResId = parseResRef(manifest.iconRef);
    const resourceTable = parseOptions.loadResources
      ? await readResourceTable(data, zipInfo, labelResId || iconResId)
      : null;

    if (labelResId && resourceTable) {
      appName = resolveResourceValue(resourceTable, labelResId, {
        locale: parseOptions.locale,
      });
    } else if (manifest.appNameRef && !manifest.appNameRef.startsWith("@")) {
      appName = manifest.appNameRef;
    }

    if (iconResId) {
      if (resourceTable) {
        iconPath = resolveResourceValue(resourceTable, iconResId, {
          locale: parseOptions.locale,
          preferMipmap: true,
        });
      }
    } else if (manifest.iconRef && !manifest.iconRef.startsWith("@")) {
      iconPath = manifest.iconRef;
    }

    if (iconPath) {
      const iconEntry = zipInfo.entries.find(entry => entry.name === iconPath);
      if (iconEntry) {
        const iconData = await zipTools.readZipEntry(data, iconEntry);
        const mime = getImageMimeType(iconPath);
        if (mime) {
          iconBlob = new runtime.Blob([iconData], { type: mime });
        }
      }
    }

    return {
      appName,
      packageName: manifest.packageName,
      versionCode: buildLongVersionCode(manifest.versionCodeMajor, manifest.versionCode),
      versionName: manifest.versionName,
      iconBlob,
    };
  }

  async function getSourceApkBasicInfo(source, options = {}) {
    const parseOptions = normalizeParseOptions(options, runtime);
    const manifestEntry = await source.getEntryByName("AndroidManifest.xml");
    if (!manifestEntry) {
      throw new Error("AndroidManifest.xml not found");
    }

    const manifestData = await source.readEntry(manifestEntry);
    const manifest = parseBinaryManifest(manifestData);

    let appName = "";
    let iconPath = "";
    let iconBlob = null;
    const labelResId = parseResRef(manifest.appNameRef);
    const iconResId = parseResRef(manifest.iconRef);
    const resourceResolver = parseOptions.loadResources
      ? await getSourceResourceResolver(source, labelResId || iconResId)
      : null;

    if (labelResId && resourceResolver) {
      appName = await resourceResolver.resolve(labelResId, {
        locale: parseOptions.locale,
      });
    } else if (manifest.appNameRef && !manifest.appNameRef.startsWith("@")) {
      appName = manifest.appNameRef;
    }

    if (iconResId) {
      if (resourceResolver) {
        iconPath = await resourceResolver.resolve(iconResId, {
          locale: parseOptions.locale,
          preferMipmap: true,
        });
      }
    } else if (manifest.iconRef && !manifest.iconRef.startsWith("@")) {
      iconPath = manifest.iconRef;
    }

    if (iconPath) {
      const iconEntry = await source.getEntryByName(iconPath);
      if (iconEntry) {
        const iconData = await source.readEntry(iconEntry);
        const mime = getImageMimeType(iconPath);
        if (mime) {
          iconBlob = new runtime.Blob([iconData], { type: mime });
        }
      }
    }

    return {
      appName,
      packageName: manifest.packageName,
      versionCode: buildLongVersionCode(manifest.versionCodeMajor, manifest.versionCode),
      versionName: manifest.versionName,
      iconBlob,
    };
  }

  return {
    buildLongVersionCode,
    getApkBasicInfo,
    getImageMimeType,
    getSourceApkBasicInfo,
    parsePackageEntries,
    parseResTableLanguage,
    parseResTableRegion,
  };
}
