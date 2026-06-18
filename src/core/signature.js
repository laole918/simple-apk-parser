import {
  ASN1Reader,
  ByteReader,
  bytesToHex,
  digestHexWithRuntime,
  md5Hex,
  readU32LE,
  readU64LE,
} from "./binary.js";

const APK_SIG_SCHEME_V2_ID = 0x7109871a;
const APK_SIG_SCHEME_V3_ID = 0xf05368c0;
const PKCS7_SIGNED_DATA_OID = "1.2.840.113549.1.7.2";

const OID_TO_DN = {
  "2.5.4.3": "CN",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.5": "SERIALNUMBER",
  "2.5.4.9": "STREET",
  "2.5.4.17": "POSTALCODE",
  "2.5.4.42": "GIVENNAME",
  "2.5.4.4": "SN",
  "2.5.4.12": "T",
  "1.2.840.113549.1.9.1": "EMAILADDRESS",
};

export function createSignatureTools({ runtime, utf8Decoder, zipTools }) {
  async function digestHex(algorithm, data) {
    return digestHexWithRuntime(runtime, algorithm, data);
  }

  function parseIdValuePairs(block) {
    const map = new Map();
    let off = 8;
    const end = block.length - 24;

    while (off < end) {
      const pairSize = readU64LE(block, off);
      off += 8;

      if (pairSize < 4) throw new Error("Invalid pair size");

      const pairEnd = off + pairSize;
      if (pairEnd > end) throw new Error("Pair out of range");

      const id = readU32LE(block, off);
      const value = block.slice(off + 4, pairEnd);

      map.set(id, value);
      off = pairEnd;
    }

    return map;
  }

  function parseV2OrV3CertDer(block) {
    const r = new ByteReader(block);
    const signers = r.readLenPrefixed();
    const signersR = new ByteReader(signers);
    const signer = signersR.readLenPrefixed();
    const signerR = new ByteReader(signer);
    const signedData = signerR.readLenPrefixed();
    const signedR = new ByteReader(signedData);

    signedR.readLenPrefixed();
    const certificates = signedR.readLenPrefixed();

    const certsR = new ByteReader(certificates);
    return certsR.readLenPrefixed();
  }

  function asn1Oid(value) {
    if (!value.length) return "";

    const nums = [Math.floor(value[0] / 40), value[0] % 40];
    let cur = 0;

    for (let i = 1; i < value.length; i++) {
      const byte = value[i];
      cur = (cur << 7) | (byte & 0x7f);

      if ((byte & 0x80) === 0) {
        nums.push(cur);
        cur = 0;
      }
    }

    return nums.join(".");
  }

  function decodeAsn1String(tag, value) {
    if (tag === 0x0c || tag === 0x13 || tag === 0x14 || tag === 0x16) {
      return utf8Decoder.decode(value);
    }

    if (tag === 0x1e) {
      let out = "";
      for (let i = 0; i + 1 < value.length; i += 2) {
        out += String.fromCharCode((value[i] << 8) | value[i + 1]);
      }
      return out;
    }

    return bytesToHex(value);
  }

  function formatDnValue(value) {
    if (!value) return "";
    if (!/[",+;<>\\]/.test(value) && !value.includes(",")) {
      return value;
    }

    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  function parseDnSequence(nameValue) {
    const rdns = [];
    const nameReader = new ASN1Reader(nameValue);

    while (!nameReader.eof()) {
      const setTlv = nameReader.readTLV();
      if (setTlv.tag !== 0x31) continue;

      const setReader = new ASN1Reader(setTlv.value);
      while (!setReader.eof()) {
        const attrTlv = setReader.readTLV();
        if (attrTlv.tag !== 0x30) continue;

        const attrReader = new ASN1Reader(attrTlv.value);
        const oidTlv = attrReader.readTLV();
        const valueTlv = attrReader.readTLV();
        if (oidTlv.tag !== 0x06) continue;

        const oid = asn1Oid(oidTlv.value);
        const key = OID_TO_DN[oid] || oid;
        const val = decodeAsn1String(valueTlv.tag, valueTlv.value);
        rdns.push(`${key}=${formatDnValue(val)}`);
      }
    }

    return rdns.reverse().join(", ");
  }

  function parseCertificateDn(certDer) {
    const certReader = new ASN1Reader(certDer);
    const certTlv = certReader.readTLV();
    if (certTlv.tag !== 0x30) {
      throw new Error("Certificate is not SEQUENCE");
    }

    const topReader = new ASN1Reader(certTlv.value);
    const tbsTlv = topReader.readTLV();
    if (tbsTlv.tag !== 0x30) {
      throw new Error("TBSCertificate is not SEQUENCE");
    }

    const tbsReader = new ASN1Reader(tbsTlv.value);
    const first = tbsReader.readTLV();
    if (first.tag !== 0xa0) {
      tbsReader.off = 0;
    }

    tbsReader.readTLV();
    tbsReader.readTLV();
    tbsReader.readTLV();
    tbsReader.readTLV();
    const subjectTlv = tbsReader.readTLV();
    if (subjectTlv.tag !== 0x30) {
      throw new Error("Certificate subject is not SEQUENCE");
    }

    return parseDnSequence(subjectTlv.value);
  }

  async function buildCertificateInfo(certDer) {
    const sha1 = await digestHex("SHA-1", certDer);
    const sha256 = await digestHex("SHA-256", certDer);
    const md5 = md5Hex(certDer);
    let dn = "";

    try {
      dn = parseCertificateDn(certDer);
    } catch {
      dn = "";
    }

    return { dn, sha1, sha256, md5 };
  }

  function findFirstX509CertDer(data) {
    const r = new ASN1Reader(data);

    while (!r.eof()) {
      const { tag, value, full } = r.readTLV();

      if (tag === 0x30) {
        try {
          const rr = new ASN1Reader(value);
          const a = rr.readTLV();
          const b = rr.readTLV();
          const c = rr.readTLV();

          if (a.tag === 0x30 && b.tag === 0x30 && c.tag === 0x03) {
            return full;
          }
        } catch {}

        try {
          const found = findFirstX509CertDer(value);
          if (found) return found;
        } catch {}
      } else if (tag & 0x20) {
        try {
          const found = findFirstX509CertDer(value);
          if (found) return found;
        } catch {}
      }
    }

    return null;
  }

  function readDerFromPkcs7V1(data) {
    const r = new ASN1Reader(data);
    const contentInfo = r.readTLV();
    if (contentInfo.tag !== 0x30) {
      throw new Error("PKCS7 ContentInfo is not SEQUENCE");
    }

    const cr = new ASN1Reader(contentInfo.value);
    const oidTlv = cr.readTLV();
    if (oidTlv.tag !== 0x06) {
      throw new Error("PKCS7 contentType is not OID");
    }

    const oid = asn1Oid(oidTlv.value);
    if (oid !== PKCS7_SIGNED_DATA_OID) {
      throw new Error(`Unsupported PKCS7 contentType: ${oid}`);
    }

    const content = cr.readTLV();
    if (content.tag !== 0xa0) {
      throw new Error("PKCS7 signedData wrapper not found");
    }

    const certDer = findFirstX509CertDer(content.value);
    if (!certDer) {
      throw new Error("No X.509 certificate found in PKCS7");
    }

    return certDer;
  }

  function missingSignature(scheme) {
    return { scheme, found: false, certificate: null };
  }

  async function certificateSignature(scheme, certDer) {
    return {
      scheme,
      found: true,
      certificate: await buildCertificateInfo(certDer),
    };
  }

  async function parseV2V3Signature(pairs, schemeId, scheme) {
    if (!pairs.has(schemeId)) {
      return missingSignature(scheme);
    }

    try {
      const certDer = parseV2OrV3CertDer(pairs.get(schemeId));
      return await certificateSignature(scheme, certDer);
    } catch {
      return missingSignature(scheme);
    }
  }

  function isV1SignatureEntry(entry) {
    const name = entry.name.toUpperCase();
    return (
      name.startsWith("META-INF/") &&
      (name.endsWith(".RSA") || name.endsWith(".DSA") || name.endsWith(".EC"))
    );
  }

  async function parseV1Signature(data, zipInfo) {
    try {
      const info = zipInfo || zipTools.parseZipEntries(data);
      const sigEntry = info.entries.find(isV1SignatureEntry);
      if (!sigEntry) {
        return missingSignature("v1");
      }

      const pkcs7Data = await zipTools.readZipEntry(data, sigEntry);
      const certDer = readDerFromPkcs7V1(pkcs7Data);
      return await certificateSignature("v1", certDer);
    } catch {
      return missingSignature("v1");
    }
  }

  async function parseApkSignatures(data) {
    const results = [];
    let zipInfo = null;

    try {
      zipInfo = zipTools.parseZipEntries(data);
      const signingBlock = zipTools.findApkSigningBlock(data, zipInfo.centralDirOff);
      const pairs = parseIdValuePairs(signingBlock);
      results.push(await parseV2V3Signature(pairs, APK_SIG_SCHEME_V3_ID, "v3"));
      results.push(await parseV2V3Signature(pairs, APK_SIG_SCHEME_V2_ID, "v2"));
    } catch {
      results.push(missingSignature("v3"));
      results.push(missingSignature("v2"));
    }

    results.push(await parseV1Signature(data, zipInfo));
    return results;
  }

  async function parseSourceV1Signature(source) {
    try {
      let sigEntry = await source.findEntryFromEnd(isV1SignatureEntry);
      if (!sigEntry) {
        sigEntry = await source.findEntry(isV1SignatureEntry);
      }
      if (!sigEntry) {
        return missingSignature("v1");
      }

      const pkcs7Data = await source.readEntry(sigEntry);
      const certDer = readDerFromPkcs7V1(pkcs7Data);
      return await certificateSignature("v1", certDer);
    } catch {
      return missingSignature("v1");
    }
  }

  async function parseSourceApkSignatures(source) {
    const results = [];
    const info = await source.ensureZipInfo();

    try {
      const signingBlock = await source.readSigningBlock(info.centralDirOff);
      const pairs = parseIdValuePairs(signingBlock);
      results.push(await parseV2V3Signature(pairs, APK_SIG_SCHEME_V3_ID, "v3"));
      results.push(await parseV2V3Signature(pairs, APK_SIG_SCHEME_V2_ID, "v2"));
    } catch {
      results.push(missingSignature("v3"));
      results.push(missingSignature("v2"));
    }

    results.push(await parseSourceV1Signature(source));
    return results;
  }

  return {
    parseApkSignatures,
    parseSourceApkSignatures,
  };
}
