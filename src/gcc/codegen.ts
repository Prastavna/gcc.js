import type { Program, FunctionDeclaration, Expression } from "./types.ts";
import {
  WASM_MAGIC,
  WASM_VERSION,
  Section,
  ValType,
  Op,
  ExportKind,
  FUNC_TYPE_TAG,
  encodeUnsignedLEB128,
  encodeSignedLEB128,
  encodeName,
  makeSection,
} from "./wasm.ts";

/**
 * Generates a WASM binary module from a Program AST.
 *
 * WASM module layout:
 *   magic + version
 *   Type section    (function signatures)
 *   Function section (maps func index -> type index)
 *   Export section   (exports all functions by name)
 *   Code section     (function bodies)
 */
export function generate(ast: Program): Uint8Array {
  const funcs = ast.declarations.filter(
    (d): d is FunctionDeclaration => d.type === "FunctionDeclaration"
  );

  // ── Type section ─────────────────────────────────────────
  // For milestone 1, every function is () -> i32.
  // We emit one shared type entry and all functions reference it.
  const typeSection = buildTypeSection(funcs);

  // ── Function section ─────────────────────────────────────
  // Maps each function index to its type index (all 0 for now).
  const funcSection = buildFunctionSection(funcs);

  // ── Export section ───────────────────────────────────────
  const exportSection = buildExportSection(funcs);

  // ── Code section ─────────────────────────────────────────
  const codeSection = buildCodeSection(funcs);

  // Assemble the full module
  const bytes: number[] = [
    ...WASM_MAGIC,
    ...WASM_VERSION,
    ...typeSection,
    ...funcSection,
    ...exportSection,
    ...codeSection,
  ];

  return new Uint8Array(bytes);
}

/**
 * Type section: declares function signatures.
 * For milestone 1: one type entry () -> i32
 */
function buildTypeSection(_funcs: FunctionDeclaration[]): number[] {
  // () -> i32
  const sig = [
    FUNC_TYPE_TAG,
    0x00,           // 0 params
    0x01,           // 1 result
    ValType.I32,    // result type: i32
  ];

  const content = [
    ...encodeUnsignedLEB128(1), // 1 type entry
    ...sig,
  ];

  return makeSection(Section.TYPE, content);
}

/**
 * Function section: maps function index -> type index.
 * All functions use type index 0 for now.
 */
function buildFunctionSection(funcs: FunctionDeclaration[]): number[] {
  const content = [
    ...encodeUnsignedLEB128(funcs.length),
    ...funcs.map(() => 0x00), // all reference type index 0
  ];

  return makeSection(Section.FUNCTION, content);
}

/**
 * Export section: exports all functions by name.
 */
function buildExportSection(funcs: FunctionDeclaration[]): number[] {
  const entries: number[] = [];
  for (let i = 0; i < funcs.length; i++) {
    entries.push(
      ...encodeName(funcs[i].name),
      ExportKind.FUNC,
      ...encodeUnsignedLEB128(i), // function index
    );
  }

  const content = [
    ...encodeUnsignedLEB128(funcs.length),
    ...entries,
  ];

  return makeSection(Section.EXPORT, content);
}

/**
 * Code section: function bodies.
 */
function buildCodeSection(funcs: FunctionDeclaration[]): number[] {
  const bodies: number[] = [];
  for (const func of funcs) {
    const body = buildFunctionBody(func);
    bodies.push(...body);
  }

  const content = [
    ...encodeUnsignedLEB128(funcs.length),
    ...bodies,
  ];

  return makeSection(Section.CODE, content);
}

/**
 * Build a single function body.
 * Format: [body_size, local_count, ...instructions, end]
 */
function buildFunctionBody(func: FunctionDeclaration): number[] {
  const instructions: number[] = [];

  // Emit instructions for each statement
  for (const stmt of func.body) {
    if (stmt.type === "ReturnStatement") {
      emitExpression(instructions, stmt.expression);
    }
  }

  // Function body content: local declarations + instructions + end
  const bodyContent = [
    0x00, // 0 local declarations (milestone 1)
    ...instructions,
    Op.END,
  ];

  return [
    ...encodeUnsignedLEB128(bodyContent.length),
    ...bodyContent,
  ];
}

/**
 * Emit WASM instructions for an expression.
 */
function emitExpression(out: number[], expr: Expression): void {
  switch (expr.type) {
    case "IntegerLiteral":
      out.push(Op.I32_CONST, ...encodeSignedLEB128(expr.value));
      break;
  }
}
