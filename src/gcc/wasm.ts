/**
 * WASM binary format helpers.
 * Encodes integers in LEB128 format and builds WASM sections.
 */

/**
 * Encode an unsigned integer in LEB128 format.
 * https://en.wikipedia.org/wiki/LEB128#Unsigned_LEB128
 */
export function encodeUnsignedLEB128(value: number): number[] {
  const result: number[] = [];
  do {
    let byte = value & 0x7f;
    value >>>= 7;
    if (value !== 0) {
      byte |= 0x80;
    }
    result.push(byte);
  } while (value !== 0);
  return result;
}

/**
 * Encode a signed integer in LEB128 format.
 * https://en.wikipedia.org/wiki/LEB128#Signed_LEB128
 */
export function encodeSignedLEB128(value: number): number[] {
  const result: number[] = [];
  let more = true;
  while (more) {
    let byte = value & 0x7f;
    value >>= 7;
    // If sign bit of byte is set and value is 0, or sign bit is clear and value is -1,
    // we're done. Otherwise, set the high bit to indicate more bytes follow.
    if ((value === 0 && (byte & 0x40) === 0) || (value === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    result.push(byte);
  }
  return result;
}

// ── WASM constants ───────────────────────────────────────────

/** WASM magic number: \0asm */
export const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

/** WASM version 1 */
export const WASM_VERSION = [0x01, 0x00, 0x00, 0x00];

/** WASM section IDs */
export const Section = {
  TYPE: 0x01,
  FUNCTION: 0x03,
  EXPORT: 0x07,
  CODE: 0x0a,
} as const;

/** WASM value types */
export const ValType = {
  I32: 0x7f,
  I64: 0x7e,
  F32: 0x7d,
  F64: 0x7c,
} as const;

/** WASM instruction opcodes */
export const Op = {
  END: 0x0b,
  LOCAL_GET: 0x20,
  LOCAL_SET: 0x21,
  I32_CONST: 0x41,
  I32_ADD: 0x6a,
  I32_SUB: 0x6b,
  I32_MUL: 0x6c,
  I32_DIV_S: 0x6d,
  I32_REM_S: 0x6f,
} as const;

/** WASM export kind */
export const ExportKind = {
  FUNC: 0x00,
} as const;

/** WASM function type tag */
export const FUNC_TYPE_TAG = 0x60;

/** Encodes a string as a WASM name (length-prefixed UTF-8 bytes) */
export function encodeName(name: string): number[] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(name);
  return [...encodeUnsignedLEB128(bytes.length), ...bytes];
}

/** Wraps content bytes into a WASM section: [section_id, size, ...content] */
export function makeSection(id: number, content: number[]): number[] {
  return [id, ...encodeUnsignedLEB128(content.length), ...content];
}
