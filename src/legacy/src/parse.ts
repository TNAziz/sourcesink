export interface StmHeader {
  /** u16 LE at 0x00 — format/serializer version major (observed 6). */
  versionMajor: number;
  /** u16 LE at 0x02 — version minor (observed 6). */
  versionMinor: number;
  /** 4 bytes at 0x04 — constant stamp (observed 80 00 00 80). */
  stamp: string;
  /** 4 bytes at 0x08 — constant signature (observed FA D5 FA DE). */
  signature: string;
  /** 4-char ASCII at 0x0C — "STL2" (.stm) or "ithn" (.itm). */
  appTag: string;
  /** 4-char ASCII at 0x10 — "STM2" (.stm) or "ithm" (.itm). */
  modelTag: string;
  /** u32 LE at 0x14 — format generation (observed 1). */
  generation: number;
}

export interface StmSection {
  /** Directory entry name, e.g. "book", "entity_struct". */
  name: string;
  /** Byte offset of the name within the file. */
  offset: number;
  /** Total chunk length: name + NUL + 4-byte meta trailer. */
  length: number;
  /** `kind` byte (1 = leaf class, 2 = composite class). */
  type: number;
  /** 1-based class id (directory index). */
  typeId: number;
  /** `flags` byte (0 | 1 | 2). */
  flags: number;
}

export interface ParseResult {
  header: StmHeader;
  /** The type directory, in order of appearance. */
  sections: StmSection[];
  /** Offset just past the directory = start of the serialized object graph. */
  bodyOffset: number;
  byteLength: number;
}

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function hex(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

function parseHeader(bytes: Uint8Array, view: DataView): StmHeader {
  return {
    versionMajor: view.getUint16(0, true),
    versionMinor: view.getUint16(2, true),
    stamp: hex(bytes, 4, 8),
    signature: hex(bytes, 8, 12),
    appTag: latin1(bytes, 12, 16),
    modelTag: latin1(bytes, 16, 20),
    generation: view.getUint32(20, true),
  };
}

function isPrint(name: Uint8Array): boolean {
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/**
 * Parse a legacy `.stm`/`.itm` (format version 2) model file.
 *
 * Decodes the 128-byte preamble (header) and the type directory, and reports the
 * offset where the serialized object graph begins. The per-object payloads are
 * not yet decoded (see docs/format/stm.md).
 */
export function parseStm(bytes: Uint8Array): ParseResult {
  if (bytes.length < 0x18) {
    throw new Error(`STM file too short: ${bytes.length} bytes (need >= 24)`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = parseHeader(bytes, view);

  const sections: StmSection[] = [];
  let off = 0x80;

  while (off + 2 <= bytes.length) {
    let end = off;
    while (end < bytes.length && bytes[end] !== 0) end++;
    if (end >= bytes.length) break;

    const nameLen = end - off;
    if (nameLen === 0) break;

    const name = bytes.subarray(off, end);
    if (!isPrint(name)) break;

    if (end + 5 > bytes.length) break;
    if (bytes[end + 1] !== 0) break;

    sections.push({
      name: latin1(name, 0, name.length),
      offset: off,
      length: nameLen + 5,
      type: bytes[end + 3],
      typeId: bytes[end + 2],
      flags: bytes[end + 4],
    });
    off = end + 5;
  }

  return { header, sections, bodyOffset: off, byteLength: bytes.length };
}