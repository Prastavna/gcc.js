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
  IMPORT: 0x02,
  FUNCTION: 0x03,
  MEMORY: 0x05,
  GLOBAL: 0x06,
  EXPORT: 0x07,
  CODE: 0x0a,
  DATA: 0x0b,
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
  // Control flow
  BLOCK: 0x02,
  LOOP: 0x03,
  IF: 0x04,
  ELSE: 0x05,
  END: 0x0b,
  BR: 0x0c,
  BR_IF: 0x0d,
  RETURN: 0x0f,
  CALL: 0x10,

  // Parametric
  DROP: 0x1a,
  SELECT: 0x1b,

  // Variables
  LOCAL_GET: 0x20,
  LOCAL_SET: 0x21,
  LOCAL_TEE: 0x22,
  GLOBAL_GET: 0x23,
  GLOBAL_SET: 0x24,

  // Constants
  I32_CONST: 0x41,

  // Comparison
  I32_EQZ: 0x45,
  I32_EQ: 0x46,
  I32_NE: 0x47,
  I32_LT_S: 0x48,
  I32_GT_S: 0x4a,
  I32_LE_S: 0x4c,
  I32_GE_S: 0x4e,

  // Memory
  I32_LOAD: 0x28,
  I32_STORE: 0x36,

  // Arithmetic
  I32_ADD: 0x6a,
  I32_SUB: 0x6b,
  I32_MUL: 0x6c,
  I32_DIV_S: 0x6d,
  I32_REM_S: 0x6f,
} as const;

/** WASM block type: void (no result) */
export const BLOCK_VOID = 0x40;

/** WASM block type: i32 result */
export const BLOCK_I32 = ValType.I32;

/** WASM export kind */
export const ExportKind = {
  FUNC: 0x00,
  MEMORY: 0x02,
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
