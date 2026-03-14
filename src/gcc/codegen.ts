import type { Program, FunctionDeclaration, Statement, Expression } from "./types.ts";
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

  const typeSection = buildTypeSection(funcs);
  const funcSection = buildFunctionSection(funcs);
  const exportSection = buildExportSection(funcs);
  const codeSection = buildCodeSection(funcs);

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
 * For now: one type entry () -> i32
 */
function buildTypeSection(_funcs: FunctionDeclaration[]): number[] {
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
      ...encodeUnsignedLEB128(i),
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

// ── Local variable tracking ──────────────────────────────

/**
 * Collect all local variable names from a function body in declaration order.
 * Returns a map of name -> local index.
 */
function collectLocals(body: Statement[]): Map<string, number> {
  const locals = new Map<string, number>();
  for (const stmt of body) {
    if (stmt.type === "VariableDeclaration" && !locals.has(stmt.name)) {
      locals.set(stmt.name, locals.size);
    }
  }
  return locals;
}

/**
 * Build a single function body.
 * Format: [body_size, local_decl_count, ...local_decls, ...instructions, end]
 */
function buildFunctionBody(func: FunctionDeclaration): number[] {
  const locals = collectLocals(func.body);
  const instructions: number[] = [];

  // Emit instructions for each statement
  for (const stmt of func.body) {
    emitStatement(instructions, stmt, locals);
  }

  // Build local declarations section
  // WASM format: count of local decl entries, then each entry is (count, type)
  const localDeclBytes: number[] = [];
  if (locals.size > 0) {
    // One entry: N locals of type i32
    localDeclBytes.push(
      ...encodeUnsignedLEB128(1), // 1 local declaration entry
      ...encodeUnsignedLEB128(locals.size), // count of locals in this entry
      ValType.I32, // all i32
    );
  } else {
    localDeclBytes.push(0x00); // 0 local declaration entries
  }

  const bodyContent = [
    ...localDeclBytes,
    ...instructions,
    Op.END,
  ];

  return [
    ...encodeUnsignedLEB128(bodyContent.length),
    ...bodyContent,
  ];
}

// ── Statement emission ───────────────────────────────────

function emitStatement(
  out: number[],
  stmt: Statement,
  locals: Map<string, number>,
): void {
  switch (stmt.type) {
    case "ReturnStatement":
      emitExpression(out, stmt.expression, locals);
      break;

    case "VariableDeclaration": {
      const idx = locals.get(stmt.name);
      if (idx === undefined) {
        throw new Error(`Unknown local variable '${stmt.name}'`);
      }
      emitExpression(out, stmt.initializer, locals);
      out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
      break;
    }

    case "ExpressionStatement":
      // For assignment expressions, the local.set already consumes the value.
      // For other expressions, we'd need a drop. But for now we only
      // expect AssignmentExpression here.
      emitExpression(out, stmt.expression, locals);
      break;
  }
}

// ── Expression emission ──────────────────────────────────

const BINOP_MAP: Record<string, number> = {
  "+": Op.I32_ADD,
  "-": Op.I32_SUB,
  "*": Op.I32_MUL,
  "/": Op.I32_DIV_S,
  "%": Op.I32_REM_S,
};

/**
 * Emit WASM instructions for an expression.
 *
 * WASM is stack-based: for `a + b` we emit instructions for `a`,
 * then `b`, then the `i32.add` opcode which pops both and pushes the result.
 */
function emitExpression(
  out: number[],
  expr: Expression,
  locals: Map<string, number>,
): void {
  switch (expr.type) {
    case "IntegerLiteral":
      out.push(Op.I32_CONST, ...encodeSignedLEB128(expr.value));
      break;

    case "BinaryExpression":
      emitExpression(out, expr.left, locals);
      emitExpression(out, expr.right, locals);
      out.push(BINOP_MAP[expr.operator]);
      break;

    case "UnaryExpression":
      if (expr.operator === "-") {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(0));
        emitExpression(out, expr.operand, locals);
        out.push(Op.I32_SUB);
      }
      break;

    case "Identifier": {
      const idx = locals.get(expr.name);
      if (idx === undefined) {
        throw new Error(`Unknown variable '${expr.name}'`);
      }
      out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(idx));
      break;
    }

    case "AssignmentExpression": {
      const idx = locals.get(expr.name);
      if (idx === undefined) {
        throw new Error(`Unknown variable '${expr.name}'`);
      }
      emitExpression(out, expr.value, locals);
      out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
      break;
    }
  }
}
