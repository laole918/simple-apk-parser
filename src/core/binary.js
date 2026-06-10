const MD5_SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_TABLE = Array.from({ length: 64 }, (_, i) => (
  Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0
));

export function readU16LE(buf, off) {
  return buf[off] | (buf[off + 1] << 8);
}

export function readU32LE(buf, off) {
  return (
    buf[off] |
    (buf[off + 1] << 8) |
    (buf[off + 2] << 16) |
    (buf[off + 3] << 24)
  ) >>> 0;
}

export function readU64LE(buf, off) {
  return Number(
    BigInt(buf[off]) |
    (BigInt(buf[off + 1]) << 8n) |
    (BigInt(buf[off + 2]) << 16n) |
    (BigInt(buf[off + 3]) << 24n) |
    (BigInt(buf[off + 4]) << 32n) |
    (BigInt(buf[off + 5]) << 40n) |
    (BigInt(buf[off + 6]) << 48n) |
    (BigInt(buf[off + 7]) << 56n)
  );
}

export function bytesEq(a, off, b) {
  for (let i = 0; i < b.length; i++) {
    if (a[off + i] !== b[i]) return false;
  }
  return true;
}

export function bytesToHex(bytes) {
  return [...bytes]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function digestHex(cryptoSubtle, algorithm, data) {
  const digest = await cryptoSubtle.digest(algorithm, data);
  return bytesToHex(new Uint8Array(digest));
}

export function md5Hex(data) {
  function leftRotate(x, c) {
    return (x << c) | (x >>> (32 - c));
  }

  const originalLength = data.length;
  const bitLength = BigInt(originalLength) * 8n;
  const paddedLength = (Math.floor((originalLength + 8) / 64) + 1) * 64;
  const msg = new Uint8Array(paddedLength);
  msg.set(data);
  msg[originalLength] = 0x80;

  for (let i = 0; i < 8; i++) {
    msg[paddedLength - 8 + i] = Number((bitLength >> BigInt(8 * i)) & 0xffn);
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const m = new Uint32Array(16);
    for (let i = 0; i < 16; i++) {
      m[i] = readU32LE(msg, offset + i * 4);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f;
      let g;

      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      const temp = d;
      d = c;
      c = b;
      const sum = (a + f + MD5_TABLE[i] + m[g]) >>> 0;
      b = (b + leftRotate(sum, MD5_SHIFTS[i])) >>> 0;
      a = temp;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let i = 0; i < words.length; i++) {
    out[i * 4] = words[i] & 0xff;
    out[i * 4 + 1] = (words[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (words[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (words[i] >>> 24) & 0xff;
  }

  return bytesToHex(out);
}

export function concatUint8Arrays(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function findSignatureOffsets(data, signature) {
  const offsets = [];

  for (let i = 0; i <= data.length - signature.length; i++) {
    let ok = true;
    for (let j = 0; j < signature.length; j++) {
      if (data[i + j] !== signature[j]) {
        ok = false;
        break;
      }
    }

    if (ok) {
      offsets.push(i);
    }
  }

  return offsets;
}

export class ByteReader {
  constructor(data) {
    this.data = data;
    this.off = 0;
  }

  remaining() {
    return this.data.length - this.off;
  }

  readLenPrefixed() {
    if (this.remaining() < 4) {
      throw new Error("Not enough bytes for length");
    }

    const len = readU32LE(this.data, this.off);
    this.off += 4;

    if (this.off + len > this.data.length) {
      throw new Error("Length-prefixed field out of range");
    }

    const out = this.data.slice(this.off, this.off + len);
    this.off += len;
    return out;
  }
}

export class ASN1Reader {
  constructor(data) {
    this.data = data;
    this.off = 0;
  }

  eof() {
    return this.off >= this.data.length;
  }

  readTLV() {
    if (this.off + 2 > this.data.length) {
      throw new Error("ASN.1 truncated");
    }

    const start = this.off;
    const tag = this.data[this.off++];
    const firstLen = this.data[this.off++];
    let len;

    if ((firstLen & 0x80) === 0) {
      len = firstLen;
    } else {
      const n = firstLen & 0x7f;
      if (n === 0 || n > 4) {
        throw new Error("Unsupported ASN.1 length");
      }

      if (this.off + n > this.data.length) {
        throw new Error("ASN.1 length truncated");
      }

      len = 0;
      for (let i = 0; i < n; i++) {
        len = (len << 8) | this.data[this.off++];
      }
    }

    const valueStart = this.off;
    const valueEnd = valueStart + len;
    if (valueEnd > this.data.length) {
      throw new Error("ASN.1 value truncated");
    }

    const value = this.data.slice(valueStart, valueEnd);
    const full = this.data.slice(start, valueEnd);
    this.off = valueEnd;
    return { tag, value, full };
  }
}
