import type { Program } from "./types.ts";

/**
 * Generates a WASM binary module from a Program AST.
 * Returns the raw bytes as a Uint8Array.
 */
export function generate(_ast: Program): Uint8Array {
  throw new Error("Not implemented");
}
