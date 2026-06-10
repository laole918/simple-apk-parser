import {
  bytesEq,
  concatUint8Arrays,
  findSignatureOffsets,
  readU16LE,
  readU32LE,
  readU64LE,
} from "./binary.js";

const REMOTE_CENTRAL_DIR_CHUNK_SIZE = 512 * 1024;
const REMOTE_CENTRAL_DIR_OVERLAP = 256 * 1024;
const CENTRAL_DIRECTORY_HEADER = new Uint8Array([0x50, 0x4b, 0x01, 0x02]);
const EOCD_SIG = 0x06054b50;

export function createZipTools({ runtime, textDecoder, apkSigBlockMagic }) {
  function initIndexedZipInfo(source, centralDirOff, centralDirSize) {
    source.zipInfo = {
      centralDirOff,
      centralDirSize,
      entryByName: new Map(),
      scannedBytes: 0,
      carry: new Uint8Array(0),
      fullyScanned: false,
      fullDirectoryLoaded: false,
    };

    return source.zipInfo;
  }

  function findEOCD(data) {
    const maxComment = 0xffff;
    const start = Math.max(0, data.length - 22 - maxComment);

    for (let i = data.length - 22; i >= start; i--) {
      if (
        data[i] === 0x50 &&
        data[i + 1] === 0x4b &&
        data[i + 2] === 0x05 &&
        data[i + 3] === 0x06
      ) {
        const commentLen = readU16LE(data, i + 20);
        if (i + 22 + commentLen === data.length) return i;
      }
    }

    throw new Error("EOCD not found");
  }

  function parseZipMetadataFromEocdBytes(eocdBytes, eocdOffInBytes) {
    const centralDirOff32 = readU32LE(eocdBytes, eocdOffInBytes + 16);
    const centralDirSize32 = readU32LE(eocdBytes, eocdOffInBytes + 12);
    const needsZip64 = (
      centralDirOff32 === 0xffffffff ||
      centralDirSize32 === 0xffffffff ||
      readU16LE(eocdBytes, eocdOffInBytes + 8) === 0xffff ||
      readU16LE(eocdBytes, eocdOffInBytes + 10) === 0xffff
    );

    return {
      centralDirOff: centralDirOff32,
      centralDirSize: centralDirSize32,
      needsZip64,
    };
  }

  function throwZip64Unsupported() {
    throw new Error("ZIP64 APK is not supported");
  }

  function parseContentRangeSize(contentRange) {
    if (!contentRange) return 0;
    const match = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(contentRange.trim());
    return match ? Number(match[1]) : 0;
  }

  function getRangeFailureMessage(status) {
    if (status === 200) {
      return "The server ignored the Range header and returned 200 instead of 206 Partial Content.";
    }
    if (status === 206) {
      return "";
    }
    if (status === 416) {
      return "The server rejected the requested byte range with 416 Range Not Satisfiable.";
    }
    return `The server returned HTTP ${status} instead of 206 Partial Content.`;
  }

  function getMissingContentRangeMessage() {
    return "The server returned 206 Partial Content but did not include a valid Content-Range header.";
  }

  function getRangeLengthMismatchMessage(start, endExclusive, actualLength) {
    return (
      `The server returned ${actualLength} bytes for Range ${start}-${endExclusive - 1}, ` +
      `but ${endExclusive - start} bytes were requested.`
    );
  }

  function tryParseCentralDirectoryEntry(directoryData, off) {
    if (off + 46 > directoryData.length) {
      return null;
    }

    if (
      directoryData[off] !== 0x50 ||
      directoryData[off + 1] !== 0x4b ||
      directoryData[off + 2] !== 0x01 ||
      directoryData[off + 3] !== 0x02
    ) {
      throw new Error("Invalid central directory header");
    }

    const compression = readU16LE(directoryData, off + 10);
    const compressedSize32 = readU32LE(directoryData, off + 20);
    const uncompressedSize32 = readU32LE(directoryData, off + 24);
    const nameLen = readU16LE(directoryData, off + 28);
    const extraLen = readU16LE(directoryData, off + 30);
    const commentLen = readU16LE(directoryData, off + 32);
    const localHeaderOff32 = readU32LE(directoryData, off + 42);
    const entrySize = 46 + nameLen + extraLen + commentLen;

    if (off + entrySize > directoryData.length) {
      return null;
    }

    const nameBytes = directoryData.slice(off + 46, off + 46 + nameLen);
    const name = textDecoder.decode(nameBytes);
    if (
      compressedSize32 === 0xffffffff ||
      uncompressedSize32 === 0xffffffff ||
      localHeaderOff32 === 0xffffffff
    ) {
      throwZip64Unsupported();
    }

    return {
      entry: {
        name,
        compression,
        compressedSize: compressedSize32,
        localHeaderOff: localHeaderOff32,
      },
      nextOff: off + entrySize,
    };
  }

  function startsWithCentralDirectoryHeader(data) {
    return (
      data.length >= 4 &&
      data[0] === 0x50 &&
      data[1] === 0x4b &&
      data[2] === 0x01 &&
      data[3] === 0x02
    );
  }

  function parseCentralDirectoryEntries(directoryData, baseOffset) {
    let off = 0;
    const entries = [];

    while (off < directoryData.length) {
      const parsed = tryParseCentralDirectoryEntry(directoryData, off);
      if (!parsed) {
        throw new Error("Truncated central directory entry");
      }

      entries.push(parsed.entry);
      off = parsed.nextOff;
    }

    return { entries, centralDirOff: baseOffset };
  }

  function parseZipEntries(data) {
    const eocdOff = findEOCD(data);
    const metadata = parseZipMetadataFromEocdBytes(data, eocdOff);
    if (metadata.needsZip64) {
      throwZip64Unsupported();
    }

    const directoryData = data.slice(
      metadata.centralDirOff,
      metadata.centralDirOff + metadata.centralDirSize
    );
    return parseCentralDirectoryEntries(directoryData, metadata.centralDirOff);
  }

  function findApkSigningBlock(data, centralDirOff) {
    if (centralDirOff < 32) {
      throw new Error("APK Signing Block not found");
    }

    const magicOff = centralDirOff - 16;
    if (!bytesEq(data, magicOff, apkSigBlockMagic)) {
      throw new Error("APK Signing Block magic not found");
    }

    const size2Off = centralDirOff - 24;
    const size2 = readU64LE(data, size2Off);
    const blockStart = centralDirOff - size2 - 8;
    if (blockStart < 0) {
      throw new Error("Invalid APK Signing Block size");
    }

    const size1 = readU64LE(data, blockStart);
    if (size1 !== size2) {
      throw new Error("APK Signing Block sizes mismatch");
    }

    return data.slice(blockStart, centralDirOff);
  }

  function createRemoteSource(url) {
    const source = {
      kind: "remote",
      url,
      size: 0,
      rangeCache: new Map(),
      zipInfo: null,
    };

    source.readRange = (start, endExclusive) => fetchRange(source, start, endExclusive);
    source.readSuffix = suffixLength => fetchSuffixRange(source, suffixLength);
    source.ensureZipInfo = () => ensureRemoteZipInfo(source);
    source.readEntry = entry => readRemoteZipEntry(source, entry);
    source.getEntryByName = name => getRemoteEntryByName(source, name);
    source.findEntry = predicate => findRemoteEntry(source, predicate);
    source.findEntryFromEnd = predicate => findRemoteEntryFromEnd(source, predicate);
    source.readSigningBlock = centralDirOff => readRemoteSigningBlock(source, centralDirOff);

    return source;
  }

  function createBlobSource(blob) {
    const source = {
      kind: "blob",
      blob,
      size: blob.size,
      rangeCache: new Map(),
      zipInfo: null,
    };

    source.readRange = (start, endExclusive) => readBlobRange(source, start, endExclusive);
    source.readSuffix = suffixLength => readBlobSuffixRange(source, suffixLength);
    source.ensureZipInfo = () => ensureBlobZipInfo(source);
    source.readEntry = entry => readBlobZipEntry(source, entry);
    source.getEntryByName = name => getBlobEntryByName(source, name);
    source.findEntry = predicate => findBlobEntry(source, predicate);
    source.findEntryFromEnd = predicate => findBlobEntryFromEnd(source, predicate);
    source.readSigningBlock = centralDirOff => readBlobSigningBlock(source, centralDirOff);

    return source;
  }

  async function fetchRange(source, start, endExclusive) {
    if (start < 0 || endExclusive < start) {
      throw new Error("Invalid byte range");
    }

    if (endExclusive === start) {
      return new Uint8Array(0);
    }

    const cacheKey = `${start}:${endExclusive}`;
    if (source.rangeCache.has(cacheKey)) {
      return source.rangeCache.get(cacheKey);
    }

    let response;
    try {
      response = await runtime.fetch(source.url, {
        headers: {
          Range: `bytes=${start}-${endExclusive - 1}`,
        },
      });
    } catch (err) {
      throw wrapRemoteFetchError(source, err);
    }

    if (response.status !== 206) {
      throw new Error(
        `Remote APK range request failed for ${source.url}. ${getRangeFailureMessage(response.status)}`
      );
    }

    const contentRange = response.headers.get("content-range");
    const totalSize = parseContentRangeSize(contentRange);
    if (!totalSize) {
      throw new Error(
        `Remote APK range request failed for ${source.url}. ${getMissingContentRangeMessage()}`
      );
    }
    source.size = totalSize;

    const buf = await response.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length !== endExclusive - start) {
      throw new Error(
        `Remote APK range request failed for ${source.url}. ` +
        getRangeLengthMismatchMessage(start, endExclusive, bytes.length)
      );
    }

    source.rangeCache.set(cacheKey, bytes);
    return bytes;
  }

  async function fetchSuffixRange(source, suffixLength) {
    const cacheKey = `suffix:${suffixLength}`;
    if (source.rangeCache.has(cacheKey)) {
      return source.rangeCache.get(cacheKey);
    }

    let response;
    try {
      response = await runtime.fetch(source.url, {
        headers: {
          Range: `bytes=-${suffixLength}`,
        },
      });
    } catch (err) {
      throw wrapRemoteFetchError(source, err);
    }

    if (response.status !== 206) {
      throw new Error(
        `Remote APK suffix range request failed for ${source.url}. ${getRangeFailureMessage(response.status)}`
      );
    }

    const contentRange = response.headers.get("content-range");
    const totalSize = parseContentRangeSize(contentRange);
    if (!totalSize) {
      throw new Error(
        `Remote APK suffix range request failed for ${source.url}. ${getMissingContentRangeMessage()}`
      );
    }
    source.size = totalSize;

    const buf = await response.arrayBuffer();
    const bytes = new Uint8Array(buf);
    source.rangeCache.set(cacheKey, bytes);
    return bytes;
  }

  async function readBlobRange(source, start, endExclusive) {
    if (start < 0 || endExclusive < start) {
      throw new Error("Invalid byte range");
    }

    if (endExclusive === start) {
      return new Uint8Array(0);
    }

    const cacheKey = `${start}:${endExclusive}`;
    if (source.rangeCache.has(cacheKey)) {
      return source.rangeCache.get(cacheKey);
    }

    const blobSlice = source.blob.slice(start, endExclusive);
    const buf = await blobSlice.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length !== endExclusive - start) {
      throw new Error("Local APK returned an unexpected range length");
    }

    source.rangeCache.set(cacheKey, bytes);
    return bytes;
  }

  async function readBlobSuffixRange(source, suffixLength) {
    const size = source.size;
    const start = Math.max(0, size - suffixLength);
    return readBlobRange(source, start, size);
  }

  function wrapRemoteFetchError(source, err) {
    if (err instanceof TypeError) {
      const details = err.message ? ` Underlying error: ${err.message}` : "";

      if (runtime.kind === "browser") {
        return new Error(
          `Failed to fetch remote APK URL: ${source.url}. ` +
          "The browser failed the request before a response was received. " +
          "Possible causes include an invalid URL, CORS, mixed-content restrictions, " +
          `certificate problems, network failures, or browser/extension policy interference.${details}`
        );
      }

      return new Error(
        `Failed to fetch remote APK URL: ${source.url}. ` +
        "The Node.js runtime failed the request before a response was received. " +
        "Possible causes include an invalid URL, DNS failure, proxy issues, TLS/certificate problems, " +
        `or general network connectivity issues.${details}`
      );
    }

    return err;
  }

  async function readZipEntry(data, entry) {
    const off = entry.localHeaderOff;

    if (
      data[off] !== 0x50 ||
      data[off + 1] !== 0x4b ||
      data[off + 2] !== 0x03 ||
      data[off + 3] !== 0x04
    ) {
      throw new Error("Invalid local file header");
    }

    const nameLen = readU16LE(data, off + 26);
    const extraLen = readU16LE(data, off + 28);
    const dataOff = off + 30 + nameLen + extraLen;
    const compressed = data.slice(dataOff, dataOff + entry.compressedSize);

    if (entry.compression === 0) {
      return compressed;
    }

    if (entry.compression === 8) {
      return await runtime.inflateRaw(compressed);
    }

    throw new Error(`Unsupported ZIP compression method: ${entry.compression}`);
  }

  async function readRemoteZipEntry(source, entry) {
    const localHeader = await fetchRange(source, entry.localHeaderOff, entry.localHeaderOff + 30);

    if (
      localHeader[0] !== 0x50 ||
      localHeader[1] !== 0x4b ||
      localHeader[2] !== 0x03 ||
      localHeader[3] !== 0x04
    ) {
      throw new Error("Invalid local file header");
    }

    const nameLen = readU16LE(localHeader, 26);
    const extraLen = readU16LE(localHeader, 28);
    const dataOff = entry.localHeaderOff + 30 + nameLen + extraLen;
    const compressed = await fetchRange(source, dataOff, dataOff + entry.compressedSize);

    if (entry.compression === 0) {
      return compressed;
    }

    if (entry.compression === 8) {
      return await runtime.inflateRaw(compressed);
    }

    throw new Error(`Unsupported ZIP compression method: ${entry.compression}`);
  }

  async function readBlobZipEntry(source, entry) {
    const localHeader = await readBlobRange(source, entry.localHeaderOff, entry.localHeaderOff + 30);

    if (
      localHeader[0] !== 0x50 ||
      localHeader[1] !== 0x4b ||
      localHeader[2] !== 0x03 ||
      localHeader[3] !== 0x04
    ) {
      throw new Error("Invalid local file header");
    }

    const nameLen = readU16LE(localHeader, 26);
    const extraLen = readU16LE(localHeader, 28);
    const dataOff = entry.localHeaderOff + 30 + nameLen + extraLen;
    const compressed = await readBlobRange(source, dataOff, dataOff + entry.compressedSize);

    if (entry.compression === 0) {
      return compressed;
    }

    if (entry.compression === 8) {
      return await runtime.inflateRaw(compressed);
    }

    throw new Error(`Unsupported ZIP compression method: ${entry.compression}`);
  }

  async function ensureRemoteZipInfo(source) {
    if (source.zipInfo) {
      return source.zipInfo;
    }

    const maxComment = 0xffff;
    const tailData = await fetchSuffixRange(source, 22 + maxComment);
    const eocdRelOff = findEOCD(tailData);
    const metadata = parseZipMetadataFromEocdBytes(tailData, eocdRelOff);
    if (metadata.needsZip64) {
      throwZip64Unsupported();
    }

    return initIndexedZipInfo(source, metadata.centralDirOff, metadata.centralDirSize);
  }

  async function ensureBlobZipInfo(source) {
    if (source.zipInfo) {
      return source.zipInfo;
    }

    const maxComment = 0xffff;
    const tailData = await readBlobSuffixRange(source, 22 + maxComment);
    const size = source.size;
    const eocdRelOff = findEOCD(tailData);
    const tailStart = size - tailData.length;
    const eocdAbsOff = tailStart + eocdRelOff;
    const metadata = parseZipMetadataFromEocdBytes(tailData, eocdRelOff);

    if (eocdAbsOff < 0) {
      throw new Error("EOCD offset is invalid");
    }

    if (metadata.needsZip64) {
      throwZip64Unsupported();
    }

    return initIndexedZipInfo(source, metadata.centralDirOff, metadata.centralDirSize);
  }

  async function scanRemoteCentralDirectory(source, matcher) {
    const zipInfo = await ensureRemoteZipInfo(source);

    while (!zipInfo.fullyScanned) {
      const remaining = zipInfo.centralDirSize - zipInfo.scannedBytes;
      if (remaining <= 0) {
        if (zipInfo.carry.length !== 0) {
          if (startsWithCentralDirectoryHeader(zipInfo.carry)) {
            throw new Error("Truncated central directory entry");
          }
          zipInfo.carry = new Uint8Array(0);
        }
        zipInfo.fullyScanned = true;
        break;
      }

      const chunkSize = Math.min(REMOTE_CENTRAL_DIR_CHUNK_SIZE, remaining);
      const chunkStart = zipInfo.centralDirOff + zipInfo.scannedBytes;
      const chunk = await fetchRange(source, chunkStart, chunkStart + chunkSize);
      const data = concatUint8Arrays(zipInfo.carry, chunk);

      let off = 0;
      while (off < data.length) {
        const parsed = tryParseCentralDirectoryEntry(data, off);
        if (!parsed) {
          break;
        }

        zipInfo.entryByName.set(parsed.entry.name, parsed.entry);
        if (matcher(parsed.entry)) {
          zipInfo.scannedBytes += chunkSize;
          zipInfo.carry = data.slice(parsed.nextOff);
          return parsed.entry;
        }

        off = parsed.nextOff;
      }

      zipInfo.scannedBytes += chunkSize;
      zipInfo.carry = data.slice(off);
      if (zipInfo.scannedBytes >= zipInfo.centralDirSize) {
        if (zipInfo.carry.length !== 0) {
          if (startsWithCentralDirectoryHeader(zipInfo.carry)) {
            throw new Error("Truncated central directory entry");
          }
          zipInfo.carry = new Uint8Array(0);
        }
        zipInfo.fullyScanned = true;
      }
    }

    return null;
  }

  async function loadFullRemoteCentralDirectory(source) {
    const zipInfo = await ensureRemoteZipInfo(source);
    if (zipInfo.fullDirectoryLoaded) {
      return zipInfo;
    }

    const directoryData = await fetchRange(
      source,
      zipInfo.centralDirOff,
      zipInfo.centralDirOff + zipInfo.centralDirSize
    );
    const parsed = parseCentralDirectoryEntries(directoryData, zipInfo.centralDirOff);
    for (const entry of parsed.entries) {
      zipInfo.entryByName.set(entry.name, entry);
    }
    zipInfo.scannedBytes = zipInfo.centralDirSize;
    zipInfo.carry = new Uint8Array(0);
    zipInfo.fullyScanned = true;
    zipInfo.fullDirectoryLoaded = true;
    return zipInfo;
  }

  async function getRemoteEntryByName(source, name) {
    const zipInfo = await ensureRemoteZipInfo(source);
    if (zipInfo.entryByName.has(name)) {
      return zipInfo.entryByName.get(name);
    }

    try {
      return await scanRemoteCentralDirectory(source, entry => entry.name === name);
    } catch {
      const fullZipInfo = await loadFullRemoteCentralDirectory(source);
      return fullZipInfo.entryByName.get(name) || null;
    }
  }

  async function findRemoteEntry(source, predicate) {
    const zipInfo = await ensureRemoteZipInfo(source);

    for (const entry of zipInfo.entryByName.values()) {
      if (predicate(entry)) {
        return entry;
      }
    }

    try {
      return await scanRemoteCentralDirectory(source, predicate);
    } catch {
      const fullZipInfo = await loadFullRemoteCentralDirectory(source);
      for (const entry of fullZipInfo.entryByName.values()) {
        if (predicate(entry)) {
          return entry;
        }
      }
      return null;
    }
  }

  function findEntryInDirectoryWindow(windowBytes, predicate) {
    const offsets = findSignatureOffsets(windowBytes, CENTRAL_DIRECTORY_HEADER);

    for (let i = offsets.length - 1; i >= 0; i--) {
      const off = offsets[i];
      const parsed = tryParseCentralDirectoryEntry(windowBytes, off);
      if (parsed && predicate(parsed.entry)) {
        return parsed.entry;
      }
    }

    return null;
  }

  async function findRemoteEntryFromEnd(source, predicate) {
    const zipInfo = await ensureRemoteZipInfo(source);
    const dirStart = zipInfo.centralDirOff;
    const dirEnd = zipInfo.centralDirOff + zipInfo.centralDirSize;
    let end = dirEnd;

    while (end > dirStart) {
      const start = Math.max(dirStart, end - REMOTE_CENTRAL_DIR_CHUNK_SIZE);
      const chunk = await fetchRange(source, start, end);
      const entry = findEntryInDirectoryWindow(chunk, predicate);
      if (entry) {
        zipInfo.entryByName.set(entry.name, entry);
        return entry;
      }

      if (start === dirStart) {
        break;
      }

      end = start + REMOTE_CENTRAL_DIR_OVERLAP;
    }

    return null;
  }

  async function readRemoteSigningBlock(source, centralDirOff) {
    if (centralDirOff < 32) {
      throw new Error("APK Signing Block not found");
    }

    const footer = await fetchRange(source, centralDirOff - 24, centralDirOff);
    if (!bytesEq(footer, 8, apkSigBlockMagic)) {
      throw new Error("APK Signing Block magic not found");
    }

    const size2 = readU64LE(footer, 0);
    const blockStart = centralDirOff - size2 - 8;
    if (blockStart < 0) {
      throw new Error("Invalid APK Signing Block size");
    }

    const signingBlock = await fetchRange(source, blockStart, centralDirOff);
    const size1 = readU64LE(signingBlock, 0);
    if (size1 !== size2) {
      throw new Error("APK Signing Block sizes mismatch");
    }

    return signingBlock;
  }

  async function readBlobSigningBlock(source, centralDirOff) {
    if (centralDirOff < 32) {
      throw new Error("APK Signing Block not found");
    }

    const footer = await readBlobRange(source, centralDirOff - 24, centralDirOff);
    if (!bytesEq(footer, 8, apkSigBlockMagic)) {
      throw new Error("APK Signing Block magic not found");
    }

    const size2 = readU64LE(footer, 0);
    const blockStart = centralDirOff - size2 - 8;
    if (blockStart < 0) {
      throw new Error("Invalid APK Signing Block size");
    }

    const signingBlock = await readBlobRange(source, blockStart, centralDirOff);
    const size1 = readU64LE(signingBlock, 0);
    if (size1 !== size2) {
      throw new Error("APK Signing Block sizes mismatch");
    }

    return signingBlock;
  }

  async function scanIndexedCentralDirectory(source, matcher, ensureZipInfo, readRange) {
    const zipInfo = await ensureZipInfo(source);

    while (!zipInfo.fullyScanned) {
      const remaining = zipInfo.centralDirSize - zipInfo.scannedBytes;
      if (remaining <= 0) {
        if (zipInfo.carry.length !== 0) {
          if (startsWithCentralDirectoryHeader(zipInfo.carry)) {
            throw new Error("Truncated central directory entry");
          }
          zipInfo.carry = new Uint8Array(0);
        }
        zipInfo.fullyScanned = true;
        break;
      }

      const chunkSize = Math.min(REMOTE_CENTRAL_DIR_CHUNK_SIZE, remaining);
      const chunkStart = zipInfo.centralDirOff + zipInfo.scannedBytes;
      const chunk = await readRange(source, chunkStart, chunkStart + chunkSize);
      const data = concatUint8Arrays(zipInfo.carry, chunk);

      let off = 0;
      while (off < data.length) {
        const parsed = tryParseCentralDirectoryEntry(data, off);
        if (!parsed) {
          break;
        }

        zipInfo.entryByName.set(parsed.entry.name, parsed.entry);
        if (matcher(parsed.entry)) {
          zipInfo.scannedBytes += chunkSize;
          zipInfo.carry = data.slice(parsed.nextOff);
          return parsed.entry;
        }

        off = parsed.nextOff;
      }

      zipInfo.scannedBytes += chunkSize;
      zipInfo.carry = data.slice(off);
      if (zipInfo.scannedBytes >= zipInfo.centralDirSize) {
        if (zipInfo.carry.length !== 0) {
          if (startsWithCentralDirectoryHeader(zipInfo.carry)) {
            throw new Error("Truncated central directory entry");
          }
          zipInfo.carry = new Uint8Array(0);
        }
        zipInfo.fullyScanned = true;
      }
    }

    return null;
  }

  async function loadFullIndexedCentralDirectory(source, ensureZipInfo, readRange) {
    const zipInfo = await ensureZipInfo(source);
    if (zipInfo.fullDirectoryLoaded) {
      return zipInfo;
    }

    const directoryData = await readRange(
      source,
      zipInfo.centralDirOff,
      zipInfo.centralDirOff + zipInfo.centralDirSize
    );
    const parsed = parseCentralDirectoryEntries(directoryData, zipInfo.centralDirOff);
    for (const entry of parsed.entries) {
      zipInfo.entryByName.set(entry.name, entry);
    }
    zipInfo.scannedBytes = zipInfo.centralDirSize;
    zipInfo.carry = new Uint8Array(0);
    zipInfo.fullyScanned = true;
    zipInfo.fullDirectoryLoaded = true;
    return zipInfo;
  }

  async function getIndexedEntryByName(source, name, ensureZipInfo, scanDirectory, loadFullDirectory) {
    const zipInfo = await ensureZipInfo(source);
    if (zipInfo.entryByName.has(name)) {
      return zipInfo.entryByName.get(name);
    }

    try {
      return await scanDirectory(source, entry => entry.name === name);
    } catch {
      const fullZipInfo = await loadFullDirectory(source);
      return fullZipInfo.entryByName.get(name) || null;
    }
  }

  async function findIndexedEntry(source, predicate, ensureZipInfo, scanDirectory, loadFullDirectory) {
    const zipInfo = await ensureZipInfo(source);

    for (const entry of zipInfo.entryByName.values()) {
      if (predicate(entry)) {
        return entry;
      }
    }

    try {
      return await scanDirectory(source, predicate);
    } catch {
      const fullZipInfo = await loadFullDirectory(source);
      for (const entry of fullZipInfo.entryByName.values()) {
        if (predicate(entry)) {
          return entry;
        }
      }
      return null;
    }
  }

  async function findIndexedEntryFromEnd(source, predicate, ensureZipInfo, readRange) {
    const zipInfo = await ensureZipInfo(source);
    const dirStart = zipInfo.centralDirOff;
    const dirEnd = zipInfo.centralDirOff + zipInfo.centralDirSize;
    let end = dirEnd;

    while (end > dirStart) {
      const start = Math.max(dirStart, end - REMOTE_CENTRAL_DIR_CHUNK_SIZE);
      const chunk = await readRange(source, start, end);
      const entry = findEntryInDirectoryWindow(chunk, predicate);
      if (entry) {
        zipInfo.entryByName.set(entry.name, entry);
        return entry;
      }

      if (start === dirStart) {
        break;
      }

      end = start + REMOTE_CENTRAL_DIR_OVERLAP;
    }

    return null;
  }

  async function scanBlobCentralDirectory(source, matcher) {
    return scanIndexedCentralDirectory(source, matcher, ensureBlobZipInfo, readBlobRange);
  }

  async function loadFullBlobCentralDirectory(source) {
    return loadFullIndexedCentralDirectory(source, ensureBlobZipInfo, readBlobRange);
  }

  async function getBlobEntryByName(source, name) {
    return getIndexedEntryByName(
      source,
      name,
      ensureBlobZipInfo,
      scanBlobCentralDirectory,
      loadFullBlobCentralDirectory
    );
  }

  async function findBlobEntry(source, predicate) {
    return findIndexedEntry(
      source,
      predicate,
      ensureBlobZipInfo,
      scanBlobCentralDirectory,
      loadFullBlobCentralDirectory
    );
  }

  async function findBlobEntryFromEnd(source, predicate) {
    return findIndexedEntryFromEnd(source, predicate, ensureBlobZipInfo, readBlobRange);
  }

  return {
    createBlobSource,
    createRemoteSource,
    ensureBlobZipInfo,
    ensureRemoteZipInfo,
    findApkSigningBlock,
    findBlobEntry,
    findBlobEntryFromEnd,
    findEntryInDirectoryWindow,
    findIndexedEntry,
    findIndexedEntryFromEnd,
    findRemoteEntry,
    findRemoteEntryFromEnd,
    getBlobEntryByName,
    getIndexedEntryByName,
    getRemoteEntryByName,
    loadFullBlobCentralDirectory,
    loadFullIndexedCentralDirectory,
    parseZipEntries,
    readBlobRange,
    readBlobSigningBlock,
    readBlobSuffixRange,
    readBlobZipEntry,
    readRemoteSigningBlock,
    readRemoteZipEntry,
    readZipEntry,
    scanBlobCentralDirectory,
    scanIndexedCentralDirectory,
  };
}
