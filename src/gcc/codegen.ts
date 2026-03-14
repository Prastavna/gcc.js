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
 */
export function generate(ast: Program): Uint8Array {
  const funcs = ast.declarations.filter(
    (d): d is FunctionDeclaration => d.type === "FunctionDeclaration"
  );

  // Build function name -> index map (needed for call instructions)
  const funcIndex = new Map<string, number>();
  for (let i = 0; i < funcs.length; i++) {
    funcIndex.set(funcs[i].name, i);
  }

  // Deduplicate type signatures. Key: "paramCount" (all i32 for now)
  const typeSigs: number[][] = [];
  const typeSigMap = new Map<string, number>(); // signature key -> type index
  const funcTypeIndices: number[] = []; // func index -> type index

  for (const func of funcs) {
    const paramCount = func.params.length;
    const key = `${paramCount}`;
    let typeIdx = typeSigMap.get(key);
    if (typeIdx === undefined) {
      typeIdx = typeSigs.length;
      typeSigMap.set(key, typeIdx);
      typeSigs.push(buildTypeSig(paramCount));
    }
    funcTypeIndices.push(typeIdx);
  }

  const typeSection = buildTypeSection(typeSigs);
  const funcSection = buildFunctionSection(funcTypeIndices);
  const exportSection = buildExportSection(funcs);
  const codeSection = buildCodeSection(funcs, funcIndex);

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

// ── Type signatures ──────────────────────────────────────

/** Build a single type signature: (i32, i32, ...) -> i32 */
function buildTypeSig(paramCount: number): number[] {
  return [
    FUNC_TYPE_TAG,
    ...encodeUnsignedLEB128(paramCount),
    ...Array(paramCount).fill(ValType.I32),
    0x01,        // 1 result
    ValType.I32, // result type: i32
  ];
}

function buildTypeSection(typeSigs: number[][]): number[] {
  const content: number[] = [
    ...encodeUnsignedLEB128(typeSigs.length),
  ];
  for (const sig of typeSigs) {
    content.push(...sig);
  }
  return makeSection(Section.TYPE, content);
}

function buildFunctionSection(funcTypeIndices: number[]): number[] {
  const content: number[] = [
    ...encodeUnsignedLEB128(funcTypeIndices.length),
  ];
  for (const idx of funcTypeIndices) {
    content.push(...encodeUnsignedLEB128(idx));
  }
  return makeSection(Section.FUNCTION, content);
}

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

function buildCodeSection(
  funcs: FunctionDeclaration[],
  funcIndex: Map<string, number>,
): number[] {
  const bodies: number[] = [];
  for (const func of funcs) {
    bodies.push(...buildFunctionBody(func, funcIndex));
  }
  const content = [
    ...encodeUnsignedLEB128(funcs.length),
    ...bodies,
  ];
  return makeSection(Section.CODE, content);
}

// ── Local variable tracking ──────────────────────────────

/**
 * Build local variable name -> index map.
 * In WASM, params occupy indices 0..N-1, then declared locals start at N.
 */
function collectLocals(func: FunctionDeclaration): Map<string, number> {
  const locals = new Map<string, number>();

  // Params first
  for (let i = 0; i < func.params.length; i++) {
    locals.set(func.params[i].name, i);
  }

  // Then declared locals
  const offset = func.params.length;
  let localIdx = 0;
  for (const stmt of func.body) {
    if (stmt.type === "VariableDeclaration" && !locals.has(stmt.name)) {
      locals.set(stmt.name, offset + localIdx);
      localIdx++;
    }
  }

  return locals;
}

/** Count declared locals (not params) */
function countDeclaredLocals(func: FunctionDeclaration): number {
  const seen = new Set<string>();
  let count = 0;
  for (const stmt of func.body) {
    if (stmt.type === "VariableDeclaration" && !seen.has(stmt.name)) {
      seen.add(stmt.name);
      count++;
    }
  }
  return count;
}

function buildFunctionBody(
  func: FunctionDeclaration,
  funcIndex: Map<string, number>,
): number[] {
  const locals = collectLocals(func);
  const declaredLocalCount = countDeclaredLocals(func);
  const instructions: number[] = [];

  for (const stmt of func.body) {
    emitStatement(instructions, stmt, locals, funcIndex);
  }

  // Local declarations (only declared locals, not params — params are implicit)
  const localDeclBytes: number[] = [];
  if (declaredLocalCount > 0) {
    localDeclBytes.push(
      ...encodeUnsignedLEB128(1),
      ...encodeUnsignedLEB128(declaredLocalCount),
      ValType.I32,
    );
  } else {
    localDeclBytes.push(0x00);
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
  funcIndex: Map<string, number>,
): void {
  switch (stmt.type) {
    case "ReturnStatement":
      emitExpression(out, stmt.expression, locals, funcIndex);
      break;

    case "VariableDeclaration": {
      const idx = locals.get(stmt.name);
      if (idx === undefined) {
        throw new Error(`Unknown local variable '${stmt.name}'`);
      }
      emitExpression(out, stmt.initializer, locals, funcIndex);
      out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
      break;
    }

    case "ExpressionStatement":
      emitExpression(out, stmt.expression, locals, funcIndex);
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

function emitExpression(
  out: number[],
  expr: Expression,
  locals: Map<string, number>,
  funcIndex: Map<string, number>,
): void {
  switch (expr.type) {
    case "IntegerLiteral":
      out.push(Op.I32_CONST, ...encodeSignedLEB128(expr.value));
      break;

    case "BinaryExpression":
      emitExpression(out, expr.left, locals, funcIndex);
      emitExpression(out, expr.right, locals, funcIndex);
      out.push(BINOP_MAP[expr.operator]);
      break;

    case "UnaryExpression":
      if (expr.operator === "-") {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(0));
        emitExpression(out, expr.operand, locals, funcIndex);
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
      emitExpression(out, expr.value, locals, funcIndex);
      out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
      break;
    }

    case "CallExpression": {
      const fIdx = funcIndex.get(expr.callee);
      if (fIdx === undefined) {
        throw new Error(`Unknown function '${expr.callee}'`);
      }
      // Push all arguments onto the stack
      for (const arg of expr.args) {
        emitExpression(out, arg, locals, funcIndex);
      }
      out.push(Op.CALL, ...encodeUnsignedLEB128(fIdx));
      break;
    }
  }
}
