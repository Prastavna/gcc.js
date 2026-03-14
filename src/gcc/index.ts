import type { CompileResult } from "./types.ts";
import { tokenize } from "./lexer.ts";
import { parse } from "./parser.ts";
import { generate } from "./codegen.ts";

/**
 * Compiles C source code to a WASM binary module.
 *
 * @param source - C source code string
 * @returns CompileResult - either { ok: true, wasm: Uint8Array } or { ok: false, errors: CompileError[] }
 */
export function compile(source: string): CompileResult {
  try {
    const tokens = tokenize(source);
    const ast = parse(tokens);
    const wasm = generate(ast);
    return { ok: true, wasm };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      errors: [{ stage: "lexer", message, line: 0, col: 0 }],
    };
  }
}

export { tokenize } from "./lexer.ts";
export { parse } from "./parser.ts";
export { generate } from "./codegen.ts";
export type {
  Token,
  TokenType,
  Program,
  FunctionDeclaration,
  VariableDeclaration,
  ExpressionStatement,
  Statement,
  Expression,
  Identifier,
  AssignmentExpression,
  CompileResult,
  CompileError,
} from "./types.ts";
