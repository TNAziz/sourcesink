/**
 * Object-stream tokenizer for the `.stm`/`.itm` body (docs/format/stm.md §3).
 *
 * After the type directory the file is a flat sequence of tagged objects. Each
 * object starts with a *form* byte (0xC0–0xFF) and a class id; the form says
 * which header fields follow and where the payload size comes from:
 *
 *  - some forms **declare** a class's record size (`d9`, `e5`, `e8`), which
 *    later `c1`/`cb`/`d1`/`d2` objects of that class reuse;
 *  - some carry a **one-off explicit size** (`cc`, `d3`, `d4`, `de`, `f4`);
 *  - some carry **no payload** (`c0` null, `ca`/`d0` back-references).
 *
 * Every form below was derived by observation and is validated by tokenizing
 * every sample model byte-for-byte to end of file.
 */

/** One serialized object. */
export interface StmObject {
  /** Byte offset of the form byte. */
  offset: number;
  /** The form byte, e.g. 0xd9. */
  form: number;
  /** 1-based class id (index into the type directory). */
  typeId: number;
  /** Class name from the directory, or `#<id>` when unknown. */
  type: string;
  /** Payload bytes (empty for null/reference forms). */
  data: Uint8Array;
  /** Object number referenced by a `ca`/`d0` back-reference. */
  ref?: number;
}

const u16 = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1];
const u24 = (b: Uint8Array, i: number): number => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];

/**
 * Tokenize the object stream starting at `start`. `typeNames` maps class id ->
 * name (from the directory). Throws on an unknown form or a reuse of a record
 * size that was never declared, reporting the offset.
 */
export function readObjects(
  bytes: Uint8Array,
  start: number,
  typeNames: ReadonlyMap<number, string>,
): StmObject[] {
  const sizes = new Map<number, number>([[0, 0]]);
  const out: StmObject[] = [];
  const isString = (t: number) => typeNames.get(t) === "C_String";
  const fail = (i: number, why: string): never => {
    throw new Error(`stm: ${why} at offset 0x${i.toString(16)}`);
  };
  const nulEnd = (at: number): number => {
    let j = at;
    while (j < bytes.length && bytes[j] !== 0) j++;
    return j + 1;
  };
  /** End of a payload that reuses the class's declared record size. Strings
   * with no declared size are NUL-terminated. */
  const declaredEnd = (t: number, at: number, i: number): number => {
    const n = sizes.get(t);
    if (n !== undefined) return at + n;
    if (isString(t)) return nulEnd(at);
    return fail(i, `record size of class ${typeNames.get(t) ?? t} used before declaration`);
  };
  const push = (offset: number, form: number, typeId: number, from: number, to: number, ref?: number) => {
    if (to > bytes.length) fail(offset, "object runs past end of file");
    out.push({
      offset,
      form,
      typeId,
      type: typeNames.get(typeId) ?? `#${typeId}`,
      data: bytes.subarray(from, to),
      ...(ref === undefined ? {} : { ref }),
    });
  };

  let i = start;
  while (i < bytes.length - 1) {
    const form = bytes[i];
    const t = bytes[i + 1];
    switch (form) {
      case 0xc0: // null / absent field
        push(i, form, t, i + 2, i + 2);
        i += 2;
        break;
      case 0xc1: {
        // payload of the declared size; strings are always NUL-terminated
        const end = isString(t) ? nulEnd(i + 2) : declaredEnd(t, i + 2, i);
        push(i, form, t, i + 2, end);
        i = end;
        break;
      }
      case 0xc9: // u8 field + declared payload
      case 0xcb: {
        const end = declaredEnd(t, i + 3, i);
        push(i, form, t, i + 3, end);
        i = end;
        break;
      }
      case 0xca: // back-reference to object #u8
        push(i, form, t, i + 3, i + 3, bytes[i + 2]);
        i += 3;
        break;
      case 0xcc: {
        const n = bytes[i + 2];
        push(i, form, t, i + 3, i + 3 + n);
        i += 3 + n;
        break;
      }
      case 0xd0: // back-reference to object #u16
        push(i, form, t, i + 4, i + 4, u16(bytes, i + 2));
        i += 4;
        break;
      case 0xd1: // u16 field + declared payload
      case 0xd2: {
        const end = declaredEnd(t, i + 4, i);
        push(i, form, t, i + 4, end);
        i = end;
        break;
      }
      case 0xd3: {
        // u8 capacity, u8 size (one-off)
        const n = bytes[i + 3];
        push(i, form, t, i + 4, i + 4 + n);
        i += 4 + n;
        break;
      }
      case 0xd4: {
        const n = u16(bytes, i + 2);
        push(i, form, t, i + 4, i + 4 + n);
        i += 4 + n;
        break;
      }
      case 0xd9: {
        // declare: u8 capacity, u8 size, u8 tag
        const n = bytes[i + 3];
        sizes.set(t, n);
        push(i, form, t, i + 5, i + 5 + n);
        i += 5 + n;
        break;
      }
      case 0xde: {
        // u16 capacity, u16 size (one-off)
        const n = u16(bytes, i + 4);
        push(i, form, t, i + 6, i + 6 + n);
        i += 6 + n;
        break;
      }
      case 0xe5: {
        // declare: u16 capacity, u16 size, u8 tag
        const n = u16(bytes, i + 4);
        sizes.set(t, n);
        push(i, form, t, i + 7, i + 7 + n);
        i += 7 + n;
        break;
      }
      case 0xe8: {
        // declare: u16 capacity, u16 size, u16 tag
        const n = u16(bytes, i + 4);
        sizes.set(t, n);
        push(i, form, t, i + 8, i + 8 + n);
        i += 8 + n;
        break;
      }
      case 0xf4: {
        // large blob (pictures): u16 class id, u24 capacity, u24 size, u24 tag,
        // payload, then one trailing byte
        const tt = u16(bytes, i + 1);
        const n = u24(bytes, i + 6);
        push(i, form, tt, i + 12, i + 12 + n);
        i += 13 + n;
        break;
      }
      default:
        fail(i, `unknown object form 0x${form.toString(16)}`);
    }
  }
  if (i !== bytes.length) fail(i, "trailing bytes after last object");
  return out;
}
