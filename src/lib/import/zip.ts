import { inflateRawSync } from "node:zlib";

// PL4 — read the entries out of a ZIP, using only Node builtins.
//
// Letterboxd hands the user a ZIP and we take it whole, because making somebody
// unzip an archive and pick the right one of five CSVs is the step where an
// import stops feeling like one click. That means reading ZIP here.
//
// No dependency: `zlib.inflateRawSync` is a builtin and does the decompression,
// so the only thing left is walking the central directory, which is a fixed
// record format. A ZIP library would be a much larger supply-chain surface than
// the ~60 lines below, on a project that keeps nine runtime dependencies.
//
// Reads the CENTRAL DIRECTORY rather than scanning for local file headers.
// Scanning is the shortcut and it is wrong: a local header may declare sizes of
// zero and defer them to a data descriptor AFTER the compressed bytes, so a
// scanner cannot know where an entry ends without decompressing blindly. The
// central directory always carries the real sizes and the real offsets.

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export interface ZipEntry {
  name: string;
  /** Decompressed bytes. */
  data: Buffer;
}

export class ZipError extends Error {}

/** Locate the End Of Central Directory record, scanning back from the tail. */
function findEocd(buf: Buffer): number {
  // The EOCD is last, but a ZIP comment can follow it (max 65,535 bytes), so the
  // search window is that plus the record itself.
  const maxBack = Math.min(buf.length, 0xffff + 22);
  for (let i = buf.length - 22; i >= buf.length - maxBack; i--) {
    if (i < 0) break;
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Read every entry in a ZIP.
 *
 * `maxTotalBytes` bounds the DECOMPRESSED total, which is the number that
 * matters: a small archive can declare a huge expansion (a zip bomb), and this
 * runs on a request path open to anonymous callers. The cap is enforced as
 * entries are inflated, so a hostile archive stops early rather than after it
 * has already allocated.
 */
export function readZip(buf: Buffer, opts: { maxTotalBytes?: number; nameFilter?: (n: string) => boolean } = {}): ZipEntry[] {
  const maxTotal = opts.maxTotalBytes ?? 64 * 1024 * 1024;
  const eocd = findEocd(buf);
  if (eocd < 0) throw new ZipError("That file is not a ZIP archive.");

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  const out: ZipEntry[] = [];
  let totalOut = 0;

  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== CDIR_SIG) break;

    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const uncompSize = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith("/")) continue;                       // directory entry
    if (opts.nameFilter && !opts.nameFilter(name)) continue;

    // The local header's name/extra lengths differ from the central one's, so
    // the data offset has to be read from the local header itself.
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== LOCAL_SIG) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;

    totalOut += uncompSize;
    if (totalOut > maxTotal) throw new ZipError("That archive expands to more than this import accepts.");

    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);              // STORED
    else if (method === 8) data = inflateRawSync(raw);      // DEFLATE
    else continue;                                          // anything exotic: skip rather than guess

    out.push({ name, data });
  }
  return out;
}

/** True when the buffer starts with a ZIP local-file signature. */
export function looksLikeZip(buf: Buffer): boolean {
  return buf.length > 4 && buf.readUInt32LE(0) === LOCAL_SIG;
}
