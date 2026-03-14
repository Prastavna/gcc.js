import type { Program, FunctionDeclaration, Statement, Expression } from "./types.ts";
import {
  WASM_MAGIC,
  WASM_VERSION,
  Section,
  ValType,
  Op,
  ExportKind,
  FUNC_TYPE_TAG,
  BLOCK_VOID,
  encodeUnsignedLEB128,
  encodeSignedLEB128,
  encodeName,
  makeSection,
} from "./wasm.ts";

// ── Memory layout ────────────────────────────────────────
// Address-taken variables live in WASM linear memory.
// Each gets 4 bytes (i32). Addresses are assigned per-function
// starting from a global bump pointer that persists across functions.

let memoryUsed = false; // tracks if any function uses memory

/**
 * Generates a WASM binary module from a Program AST.
 */
export function generate(ast: Program): Uint8Array {
  memoryUsed = false;

  const funcs = ast.declarations.filter(
    (d): d is FunctionDeclaration => d.type === "FunctionDeclaration"
  );

  const funcIndex = new Map<string, number>();
  for (let i = 0; i < funcs.length; i++) {
    funcIndex.set(funcs[i].name, i);
  }

  const typeSigs: number[][] = [];
  const typeSigMap = new Map<string, number>();
  const funcTypeIndices: number[] = [];

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

  // Pre-scan to detect if memory is needed
  for (const func of funcs) {
    if (functionUsesMemory(func)) {
      memoryUsed = true;
      break;
    }
  }

  const typeSection = buildTypeSection(typeSigs);
  const funcSection = buildFunctionSection(funcTypeIndices);
  const memorySection = memoryUsed ? buildMemorySection() : [];
  const exportSection = buildExportSection(funcs);
  const codeSection = buildCodeSection(funcs, funcIndex);

  const bytes: number[] = [
    ...WASM_MAGIC,
    ...WASM_VERSION,
    ...typeSection,
    ...funcSection,
    ...memorySection,
    ...exportSection,
    ...codeSection,
  ];

  return new Uint8Array(bytes);
}

function functionUsesMemory(func: FunctionDeclaration): boolean {
  return statementsUseMemory(func.body);
}

function statementsUseMemory(stmts: Statement[]): boolean {
  for (const s of stmts) {
    if (expressionsInStatementUseMemory(s)) return true;
  }
  return false;
}

function expressionsInStatementUseMemory(stmt: Statement): boolean {
  switch (stmt.type) {
    case "ReturnStatement": return exprUsesMemory(stmt.expression);
    case "VariableDeclaration": return exprUsesMemory(stmt.initializer);
    case "ExpressionStatement": return exprUsesMemory(stmt.expression);
    case "IfStatement":
      return exprUsesMemory(stmt.condition) ||
        statementsUseMemory(stmt.consequent) ||
        (stmt.alternate ? statementsUseMemory(stmt.alternate) : false);
    case "WhileStatement":
      return exprUsesMemory(stmt.condition) || statementsUseMemory(stmt.body);
    case "ForStatement":
      return expressionsInStatementUseMemory(stmt.init) ||
        exprUsesMemory(stmt.condition) || exprUsesMemory(stmt.update) ||
        statementsUseMemory(stmt.body);
  }
}

function exprUsesMemory(expr: Expression): boolean {
  switch (expr.type) {
    case "AddressOfExpression":
    case "DereferenceExpression":
    case "DereferenceAssignment":
      return true;
    case "BinaryExpression":
      return exprUsesMemory(expr.left) || exprUsesMemory(expr.right);
    case "UnaryExpression":
      return exprUsesMemory(expr.operand);
    case "AssignmentExpression":
      return exprUsesMemory(expr.value);
    case "CallExpression":
      return expr.args.some(exprUsesMemory);
    default:
      return false;
  }
}

// ── Sections ─────────────────────────────────────────────

function buildTypeSig(paramCount: number): number[] {
  return [
    FUNC_TYPE_TAG,
    ...encodeUnsignedLEB128(paramCount),
    ...Array(paramCount).fill(ValType.I32),
    0x01,
    ValType.I32,
  ];
}

function buildTypeSection(typeSigs: number[][]): number[] {
  const content: number[] = [...encodeUnsignedLEB128(typeSigs.length)];
  for (const sig of typeSigs) content.push(...sig);
  return makeSection(Section.TYPE, content);
}

function buildFunctionSection(funcTypeIndices: number[]): number[] {
  const content: number[] = [...encodeUnsignedLEB128(funcTypeIndices.length)];
  for (const idx of funcTypeIndices) content.push(...encodeUnsignedLEB128(idx));
  return makeSection(Section.FUNCTION, content);
}

/** Memory section: 1 memory, min 1 page (64KB), no max */
function buildMemorySection(): number[] {
  const content = [
    ...encodeUnsignedLEB128(1), // 1 memory
    0x00,                        // limits: flags=0 (min only, no max)
    ...encodeUnsignedLEB128(1), // min 1 page
  ];
  return makeSection(Section.MEMORY, content);
}

function buildExportSection(funcs: FunctionDeclaration[]): number[] {
  const entries: number[] = [];
  let exportCount = funcs.length;

  for (let i = 0; i < funcs.length; i++) {
    entries.push(
      ...encodeName(funcs[i].name),
      ExportKind.FUNC,
      ...encodeUnsignedLEB128(i),
    );
  }

  // Also export memory if used
  if (memoryUsed) {
    exportCount++;
    entries.push(
      ...encodeName("memory"),
      ExportKind.MEMORY,
      ...encodeUnsignedLEB128(0), // memory index 0
    );
  }

  const content = [...encodeUnsignedLEB128(exportCount), ...entries];
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
  const content = [...encodeUnsignedLEB128(funcs.length), ...bodies];
  return makeSection(Section.CODE, content);
}

// ── Variable analysis ────────────────────────────────────

/** Find all variables whose address is taken (&x) in a function */
function findAddressTakenVars(func: FunctionDeclaration): Set<string> {
  const taken = new Set<string>();
  findATInStatements(func.body, taken);
  return taken;
}

function findATInStatements(stmts: Statement[], taken: Set<string>): void {
  for (const s of stmts) findATInStatement(s, taken);
}

function findATInStatement(stmt: Statement, taken: Set<string>): void {
  switch (stmt.type) {
    case "ReturnStatement": findATInExpr(stmt.expression, taken); break;
    case "VariableDeclaration": findATInExpr(stmt.initializer, taken); break;
    case "ExpressionStatement": findATInExpr(stmt.expression, taken); break;
    case "IfStatement":
      findATInExpr(stmt.condition, taken);
      findATInStatements(stmt.consequent, taken);
      if (stmt.alternate) findATInStatements(stmt.alternate, taken);
      break;
    case "WhileStatement":
      findATInExpr(stmt.condition, taken);
      findATInStatements(stmt.body, taken);
      break;
    case "ForStatement":
      findATInStatement(stmt.init, taken);
      findATInExpr(stmt.condition, taken);
      findATInExpr(stmt.update, taken);
      findATInStatements(stmt.body, taken);
      break;
  }
}

function findATInExpr(expr: Expression, taken: Set<string>): void {
  switch (expr.type) {
    case "AddressOfExpression": taken.add(expr.name); break;
    case "BinaryExpression": findATInExpr(expr.left, taken); findATInExpr(expr.right, taken); break;
    case "UnaryExpression": findATInExpr(expr.operand, taken); break;
    case "DereferenceExpression": findATInExpr(expr.operand, taken); break;
    case "DereferenceAssignment": findATInExpr(expr.pointer, taken); findATInExpr(expr.value, taken); break;
    case "AssignmentExpression": findATInExpr(expr.value, taken); break;
    case "CallExpression": expr.args.forEach((a) => findATInExpr(a, taken)); break;
    default: break;
  }
}

// ── Local variable tracking ──────────────────────────────

/**
 * Context for code generation within a function.
 * - `locals`: variable name -> WASM local index (for non-address-taken vars)
 * - `memVars`: variable name -> memory address (for address-taken vars)
 * - `funcIndex`: function name -> WASM function index
 */
type Ctx = {
  locals: Map<string, number>;
  memVars: Map<string, number>;
  funcIndex: Map<string, number>;
};

function collectLocalsFromStatements(
  stmts: Statement[],
  locals: Map<string, number>,
  addressTaken: Set<string>,
  offset: number,
): number {
  let count = 0;
  for (const stmt of stmts) {
    if (stmt.type === "VariableDeclaration" && !locals.has(stmt.name) && !addressTaken.has(stmt.name)) {
      locals.set(stmt.name, offset + count);
      count++;
    }
    if (stmt.type === "IfStatement") {
      count += collectLocalsFromStatements(stmt.consequent, locals, addressTaken, offset + count);
      if (stmt.alternate) count += collectLocalsFromStatements(stmt.alternate, locals, addressTaken, offset + count);
    }
    if (stmt.type === "WhileStatement") {
      count += collectLocalsFromStatements(stmt.body, locals, addressTaken, offset + count);
    }
    if (stmt.type === "ForStatement") {
      count += collectLocalsFromStatements([stmt.init], locals, addressTaken, offset + count);
      count += collectLocalsFromStatements(stmt.body, locals, addressTaken, offset + count);
    }
  }
  return count;
}

/** Global memory address counter — persists across functions in one generate() call */
let nextMemAddr = 0;

function buildFunctionBody(
  func: FunctionDeclaration,
  funcIndex: Map<string, number>,
): number[] {
  const addressTaken = findAddressTakenVars(func);

  // Build locals map (non-address-taken vars)
  const locals = new Map<string, number>();
  for (let i = 0; i < func.params.length; i++) {
    if (!addressTaken.has(func.params[i].name)) {
      locals.set(func.params[i].name, i);
    }
  }
  const paramLocalCount = func.params.length; // params always occupy local slots
  const declaredCount = collectLocalsFromStatements(func.body, locals, addressTaken, paramLocalCount);

  // Assign memory addresses for address-taken vars
  const memVars = new Map<string, number>();
  // Address-taken params: need a local to receive the param, then store to memory
  const atParamIndices: { paramIdx: number; memAddr: number; name: string }[] = [];
  for (let i = 0; i < func.params.length; i++) {
    if (addressTaken.has(func.params[i].name)) {
      const addr = nextMemAddr;
      nextMemAddr += 4;
      memVars.set(func.params[i].name, addr);
      atParamIndices.push({ paramIdx: i, memAddr: addr, name: func.params[i].name });
    }
  }
  // Address-taken local vars
  const allVarNames = new Set<string>();
  collectAllVarNames(func.body, allVarNames);
  for (const name of allVarNames) {
    if (addressTaken.has(name) && !memVars.has(name)) {
      memVars.set(name, nextMemAddr);
      nextMemAddr += 4;
    }
  }

  const ctx: Ctx = { locals, memVars, funcIndex };
  const instructions: number[] = [];

  // Copy address-taken params from WASM local to memory
  for (const ap of atParamIndices) {
    // i32.const <addr>; local.get <paramIdx>; i32.store
    instructions.push(Op.I32_CONST, ...encodeSignedLEB128(ap.memAddr));
    instructions.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(ap.paramIdx));
    instructions.push(Op.I32_STORE, 0x02, 0x00); // align=2 (4-byte), offset=0
  }

  emitStatements(instructions, func.body, ctx);

  // Local declarations
  const localDeclBytes: number[] = [];
  if (declaredCount > 0) {
    localDeclBytes.push(
      ...encodeUnsignedLEB128(1),
      ...encodeUnsignedLEB128(declaredCount),
      ValType.I32,
    );
  } else {
    localDeclBytes.push(0x00);
  }

  instructions.push(Op.I32_CONST, ...encodeSignedLEB128(0));
  const bodyContent = [...localDeclBytes, ...instructions, Op.END];
  return [...encodeUnsignedLEB128(bodyContent.length), ...bodyContent];
}

function collectAllVarNames(stmts: Statement[], names: Set<string>): void {
  for (const s of stmts) {
    if (s.type === "VariableDeclaration") names.add(s.name);
    if (s.type === "IfStatement") {
      collectAllVarNames(s.consequent, names);
      if (s.alternate) collectAllVarNames(s.alternate, names);
    }
    if (s.type === "WhileStatement") collectAllVarNames(s.body, names);
    if (s.type === "ForStatement") {
      collectAllVarNames([s.init], names);
      collectAllVarNames(s.body, names);
    }
  }
}

// ── Statement emission ───────────────────────────────────

function emitStatements(out: number[], stmts: Statement[], ctx: Ctx): void {
  for (const stmt of stmts) emitStatement(out, stmt, ctx);
}

function emitStatement(out: number[], stmt: Statement, ctx: Ctx): void {
  switch (stmt.type) {
    case "ReturnStatement":
      emitExpression(out, stmt.expression, ctx);
      out.push(Op.RETURN);
      break;

    case "VariableDeclaration": {
      if (ctx.memVars.has(stmt.name)) {
        // Memory-backed variable: i32.const <addr>, <value>, i32.store
        const addr = ctx.memVars.get(stmt.name)!;
        out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
        emitExpression(out, stmt.initializer, ctx);
        out.push(Op.I32_STORE, 0x02, 0x00);
      } else {
        const idx = ctx.locals.get(stmt.name);
        if (idx === undefined) throw new Error(`Unknown local '${stmt.name}'`);
        emitExpression(out, stmt.initializer, ctx);
        out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
      }
      break;
    }

    case "ExpressionStatement":
      emitExpression(out, stmt.expression, ctx);
      break;

    case "IfStatement":
      emitIf(out, stmt, ctx);
      break;

    case "WhileStatement":
      emitWhile(out, stmt, ctx);
      break;

    case "ForStatement":
      emitFor(out, stmt, ctx);
      break;
  }
}

function emitIf(
  out: number[],
  stmt: { condition: Expression; consequent: Statement[]; alternate: Statement[] | null },
  ctx: Ctx,
): void {
  emitExpression(out, stmt.condition, ctx);
  out.push(Op.IF, BLOCK_VOID);
  for (const s of stmt.consequent) emitStatement(out, s, ctx);
  if (stmt.alternate) {
    out.push(Op.ELSE);
    for (const s of stmt.alternate) emitStatement(out, s, ctx);
  }
  out.push(Op.END);
}

function emitWhile(
  out: number[],
  stmt: { condition: Expression; body: Statement[] },
  ctx: Ctx,
): void {
  out.push(Op.BLOCK, BLOCK_VOID);
  out.push(Op.LOOP, BLOCK_VOID);
  emitExpression(out, stmt.condition, ctx);
  out.push(Op.I32_EQZ);
  out.push(Op.BR_IF, ...encodeUnsignedLEB128(1));
  for (const s of stmt.body) emitStatement(out, s, ctx);
  out.push(Op.BR, ...encodeUnsignedLEB128(0));
  out.push(Op.END);
  out.push(Op.END);
}

function emitFor(
  out: number[],
  stmt: { init: Statement; condition: Expression; update: Expression; body: Statement[] },
  ctx: Ctx,
): void {
  emitStatement(out, stmt.init, ctx);
  out.push(Op.BLOCK, BLOCK_VOID);
  out.push(Op.LOOP, BLOCK_VOID);
  emitExpression(out, stmt.condition, ctx);
  out.push(Op.I32_EQZ);
  out.push(Op.BR_IF, ...encodeUnsignedLEB128(1));
  for (const s of stmt.body) emitStatement(out, s, ctx);
  emitExpression(out, stmt.update, ctx);
  out.push(Op.BR, ...encodeUnsignedLEB128(0));
  out.push(Op.END);
  out.push(Op.END);
}

// ── Expression emission ──────────────────────────────────

const BINOP_MAP: Record<string, number> = {
  "+": Op.I32_ADD,
  "-": Op.I32_SUB,
  "*": Op.I32_MUL,
  "/": Op.I32_DIV_S,
  "%": Op.I32_REM_S,
  "==": Op.I32_EQ,
  "!=": Op.I32_NE,
  "<": Op.I32_LT_S,
  ">": Op.I32_GT_S,
  "<=": Op.I32_LE_S,
  ">=": Op.I32_GE_S,
};

function emitExpression(out: number[], expr: Expression, ctx: Ctx): void {
  switch (expr.type) {
    case "IntegerLiteral":
      out.push(Op.I32_CONST, ...encodeSignedLEB128(expr.value));
      break;

    case "BinaryExpression":
      emitExpression(out, expr.left, ctx);
      emitExpression(out, expr.right, ctx);
      out.push(BINOP_MAP[expr.operator]);
      break;

    case "UnaryExpression":
      if (expr.operator === "-") {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(0));
        emitExpression(out, expr.operand, ctx);
        out.push(Op.I32_SUB);
      }
      break;

    case "Identifier": {
      // Memory-backed variable: load from memory
      if (ctx.memVars.has(expr.name)) {
        const addr = ctx.memVars.get(expr.name)!;
        out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
        out.push(Op.I32_LOAD, 0x02, 0x00);
        break;
      }
      const idx = ctx.locals.get(expr.name);
      if (idx === undefined) throw new Error(`Unknown variable '${expr.name}'`);
      out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(idx));
      break;
    }

    case "AssignmentExpression": {
      // Memory-backed variable
      if (ctx.memVars.has(expr.name)) {
        const addr = ctx.memVars.get(expr.name)!;
        out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
        emitExpression(out, expr.value, ctx);
        out.push(Op.I32_STORE, 0x02, 0x00);
        break;
      }
      const idx = ctx.locals.get(expr.name);
      if (idx === undefined) throw new Error(`Unknown variable '${expr.name}'`);
      emitExpression(out, expr.value, ctx);
      out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
      break;
    }

    case "CallExpression": {
      const fIdx = ctx.funcIndex.get(expr.callee);
      if (fIdx === undefined) throw new Error(`Unknown function '${expr.callee}'`);
      for (const arg of expr.args) emitExpression(out, arg, ctx);
      out.push(Op.CALL, ...encodeUnsignedLEB128(fIdx));
      break;
    }

    case "AddressOfExpression": {
      // Push the memory address of the variable
      const addr = ctx.memVars.get(expr.name);
      if (addr === undefined) throw new Error(`Cannot take address of '${expr.name}' — not memory-backed`);
      out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
      break;
    }

    case "DereferenceExpression": {
      // *ptr: evaluate pointer, then i32.load
      emitExpression(out, expr.operand, ctx);
      out.push(Op.I32_LOAD, 0x02, 0x00);
      break;
    }

    case "DereferenceAssignment": {
      // *ptr = val: evaluate pointer, evaluate value, i32.store
      emitExpression(out, expr.pointer, ctx);
      emitExpression(out, expr.value, ctx);
      out.push(Op.I32_STORE, 0x02, 0x00);
      break;
    }
  }
}
