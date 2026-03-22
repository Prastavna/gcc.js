import type { CompileResult } from "./types.ts";
import { preprocess } from "./preprocessor.ts";
import type { PreprocessorOptions } from "./preprocessor.ts";
import { tokenize } from "./lexer.ts";
import { parse } from "./parser.ts";
import { generate } from "./codegen.ts";

/**
 * Compiles C source code to a WASM binary module.
 *
 * @param source - C source code string
 * @param options - Optional preprocessor options (virtual files, predefined macros)
 * @returns CompileResult - either { ok: true, wasm: Uint8Array } or { ok: false, errors: CompileError[] }
 */
export function compile(source: string, options?: PreprocessorOptions): CompileResult {
  try {
    const preprocessed = preprocess(source, options);
    const tokens = tokenize(preprocessed);
    const ast = parse(tokens);
    const wasm = generate(ast);
    return { ok: true, wasm };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Detect stage from error message
    let stage: "preprocessor" | "lexer" | "parser" | "codegen" = "lexer";
    if (message.startsWith("Preprocessor error")) stage = "preprocessor";
    return {
      ok: false,
      errors: [{ stage, message, line: 0, col: 0 }],
    };
  }
}

export { preprocess } from "./preprocessor.ts";
export type { PreprocessorOptions } from "./preprocessor.ts";
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
