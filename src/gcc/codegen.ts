import type { Program, FunctionDeclaration, ExternFunctionDeclaration, Statement, Expression } from "./types.ts";
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

// ── Module-level state (reset per generate() call) ───────

let memoryUsed = false;
let nextMemAddr = 0;
let stringData: { addr: number; bytes: number[] }[] = [];

/**
 * Generates a WASM binary module from a Program AST.
 */
export function generate(ast: Program): Uint8Array {
  memoryUsed = false;
  nextMemAddr = 0;
  stringData = [];

  // Separate extern declarations from local function definitions
  const externs: ExternFunctionDeclaration[] = [];
  const funcs: FunctionDeclaration[] = [];
  for (const d of ast.declarations) {
    if (d.type === "ExternFunctionDeclaration") externs.push(d);
    else if (d.type === "FunctionDeclaration") funcs.push(d);
  }

  // String data starts at address 1024 (leave 0-1023 for stack variables)
  // We'll adjust nextMemAddr after processing all functions
  const stringBaseAddr = 1024;
  let stringOffset = stringBaseAddr;

  // Pre-scan for string literals to know addresses
  const stringMap = new Map<string, number>(); // string value -> memory address
  collectStringsFromProgram(ast, (str) => {
    if (!stringMap.has(str)) {
      const encoder = new TextEncoder();
      const bytes = [...encoder.encode(str), 0]; // null-terminated
      stringMap.set(str, stringOffset);
      stringData.push({ addr: stringOffset, bytes });
      stringOffset += bytes.length;
      // Align to 4 bytes
      while (stringOffset % 4 !== 0) stringOffset++;
    }
  });

  // Build function name -> WASM function index map
  // WASM indices: imports first, then local functions
  const funcIndex = new Map<string, number>();
  const importCount = externs.length;
  for (let i = 0; i < externs.length; i++) {
    funcIndex.set(externs[i].name, i);
  }
  for (let i = 0; i < funcs.length; i++) {
    funcIndex.set(funcs[i].name, importCount + i);
  }

  // Build type signatures (deduplicated by param count)
  const typeSigs: number[][] = [];
  const typeSigMap = new Map<string, number>();

  function getTypeIdx(paramCount: number): number {
    const key = `${paramCount}`;
    let idx = typeSigMap.get(key);
    if (idx === undefined) {
      idx = typeSigs.length;
      typeSigMap.set(key, idx);
      typeSigs.push(buildTypeSig(paramCount));
    }
    return idx;
  }

  // Type indices for imported functions
  const importTypeIndices: number[] = [];
  for (const ext of externs) {
    importTypeIndices.push(getTypeIdx(ext.params.length));
  }

  // Type indices for local functions
  const funcTypeIndices: number[] = [];
  for (const func of funcs) {
    funcTypeIndices.push(getTypeIdx(func.params.length));
  }

  // Detect if memory is needed
  if (stringData.length > 0) memoryUsed = true;
  for (const func of funcs) {
    if (functionUsesMemory(func)) { memoryUsed = true; break; }
  }

  // Build sections
  const typeSection = buildTypeSection(typeSigs);
  const importSection = externs.length > 0 ? buildImportSection(externs, importTypeIndices) : [];
  const funcSection = buildFunctionSection(funcTypeIndices);
  const memorySection = memoryUsed ? buildMemorySection() : [];
  const exportSection = buildExportSection(funcs, importCount);
  const codeSection = buildCodeSection(funcs, funcIndex, stringMap);
  const dataSection = stringData.length > 0 ? buildDataSection() : [];

  const bytes: number[] = [
    ...WASM_MAGIC,
    ...WASM_VERSION,
    ...typeSection,
    ...importSection,
    ...funcSection,
    ...memorySection,
    ...exportSection,
    ...codeSection,
    ...dataSection,
  ];

  return new Uint8Array(bytes);
}

// ── String literal collection ────────────────────────────

function collectStringsFromProgram(ast: Program, cb: (s: string) => void): void {
  for (const d of ast.declarations) {
    if (d.type === "FunctionDeclaration") {
      collectStringsFromStatements(d.body, cb);
    }
  }
}

function collectStringsFromStatements(stmts: Statement[], cb: (s: string) => void): void {
  for (const s of stmts) collectStringsFromStatement(s, cb);
}

function collectStringsFromStatement(stmt: Statement, cb: (s: string) => void): void {
  switch (stmt.type) {
    case "ReturnStatement": collectStringsFromExpr(stmt.expression, cb); break;
    case "VariableDeclaration": collectStringsFromExpr(stmt.initializer, cb); break;
    case "ExpressionStatement": collectStringsFromExpr(stmt.expression, cb); break;
    case "IfStatement":
      collectStringsFromExpr(stmt.condition, cb);
      collectStringsFromStatements(stmt.consequent, cb);
      if (stmt.alternate) collectStringsFromStatements(stmt.alternate, cb);
      break;
    case "WhileStatement":
      collectStringsFromExpr(stmt.condition, cb);
      collectStringsFromStatements(stmt.body, cb);
      break;
    case "ForStatement":
      collectStringsFromStatement(stmt.init, cb);
      collectStringsFromExpr(stmt.condition, cb);
      collectStringsFromExpr(stmt.update, cb);
      collectStringsFromStatements(stmt.body, cb);
      break;
  }
}

function collectStringsFromExpr(expr: Expression, cb: (s: string) => void): void {
  switch (expr.type) {
    case "StringLiteral": cb(expr.value); break;
    case "BinaryExpression": collectStringsFromExpr(expr.left, cb); collectStringsFromExpr(expr.right, cb); break;
    case "UnaryExpression": collectStringsFromExpr(expr.operand, cb); break;
    case "DereferenceExpression": collectStringsFromExpr(expr.operand, cb); break;
    case "DereferenceAssignment": collectStringsFromExpr(expr.pointer, cb); collectStringsFromExpr(expr.value, cb); break;
    case "AssignmentExpression": collectStringsFromExpr(expr.value, cb); break;
    case "CallExpression": expr.args.forEach((a) => collectStringsFromExpr(a, cb)); break;
    default: break;
  }
}

// ── Memory usage detection ───────────────────────────────

function functionUsesMemory(func: FunctionDeclaration): boolean {
  return statementsUseMemory(func.body);
}

function statementsUseMemory(stmts: Statement[]): boolean {
  for (const s of stmts) if (stmtUsesMemory(s)) return true;
  return false;
}

function stmtUsesMemory(stmt: Statement): boolean {
  switch (stmt.type) {
    case "ReturnStatement": return exprUsesMemory(stmt.expression);
    case "VariableDeclaration": return exprUsesMemory(stmt.initializer);
    case "ExpressionStatement": return exprUsesMemory(stmt.expression);
    case "IfStatement":
      return exprUsesMemory(stmt.condition) || statementsUseMemory(stmt.consequent) ||
        (stmt.alternate ? statementsUseMemory(stmt.alternate) : false);
    case "WhileStatement": return exprUsesMemory(stmt.condition) || statementsUseMemory(stmt.body);
    case "ForStatement":
      return stmtUsesMemory(stmt.init) || exprUsesMemory(stmt.condition) ||
        exprUsesMemory(stmt.update) || statementsUseMemory(stmt.body);
  }
}

function exprUsesMemory(expr: Expression): boolean {
  switch (expr.type) {
    case "AddressOfExpression": case "DereferenceExpression": case "DereferenceAssignment": case "StringLiteral": return true;
    case "BinaryExpression": return exprUsesMemory(expr.left) || exprUsesMemory(expr.right);
    case "UnaryExpression": return exprUsesMemory(expr.operand);
    case "AssignmentExpression": return exprUsesMemory(expr.value);
    case "CallExpression": return expr.args.some(exprUsesMemory);
    default: return false;
  }
}

// ── Sections ─────────────────────────────────────────────

function buildTypeSig(paramCount: number): number[] {
  return [
    FUNC_TYPE_TAG,
    ...encodeUnsignedLEB128(paramCount),
    ...Array(paramCount).fill(ValType.I32),
    0x01, ValType.I32,
  ];
}

function buildTypeSection(typeSigs: number[][]): number[] {
  const content: number[] = [...encodeUnsignedLEB128(typeSigs.length)];
  for (const sig of typeSigs) content.push(...sig);
  return makeSection(Section.TYPE, content);
}

function buildImportSection(externs: ExternFunctionDeclaration[], typeIndices: number[]): number[] {
  const content: number[] = [...encodeUnsignedLEB128(externs.length)];
  for (let i = 0; i < externs.length; i++) {
    content.push(
      ...encodeName("env"),            // module name
      ...encodeName(externs[i].name),  // field name
      0x00,                             // import kind: function
      ...encodeUnsignedLEB128(typeIndices[i]),
    );
  }
  return makeSection(Section.IMPORT, content);
}

function buildFunctionSection(funcTypeIndices: number[]): number[] {
  const content: number[] = [...encodeUnsignedLEB128(funcTypeIndices.length)];
  for (const idx of funcTypeIndices) content.push(...encodeUnsignedLEB128(idx));
  return makeSection(Section.FUNCTION, content);
}

function buildMemorySection(): number[] {
  const content = [...encodeUnsignedLEB128(1), 0x00, ...encodeUnsignedLEB128(1)];
  return makeSection(Section.MEMORY, content);
}

function buildExportSection(funcs: FunctionDeclaration[], importCount: number): number[] {
  const entries: number[] = [];
  let exportCount = funcs.length;
  for (let i = 0; i < funcs.length; i++) {
    entries.push(
      ...encodeName(funcs[i].name),
      ExportKind.FUNC,
      ...encodeUnsignedLEB128(importCount + i),
    );
  }
  if (memoryUsed) {
    exportCount++;
    entries.push(...encodeName("memory"), ExportKind.MEMORY, ...encodeUnsignedLEB128(0));
  }
  const content = [...encodeUnsignedLEB128(exportCount), ...entries];
  return makeSection(Section.EXPORT, content);
}

function buildCodeSection(
  funcs: FunctionDeclaration[],
  funcIndex: Map<string, number>,
  stringMap: Map<string, number>,
): number[] {
  const bodies: number[] = [];
  for (const func of funcs) {
    bodies.push(...buildFunctionBody(func, funcIndex, stringMap));
  }
  const content = [...encodeUnsignedLEB128(funcs.length), ...bodies];
  return makeSection(Section.CODE, content);
}

/** Data section: active segments that initialize memory with string data */
function buildDataSection(): number[] {
  const content: number[] = [...encodeUnsignedLEB128(stringData.length)];
  for (const seg of stringData) {
    content.push(
      0x00, // memory index 0 (active segment)
      Op.I32_CONST, ...encodeSignedLEB128(seg.addr), Op.END, // offset expression
      ...encodeUnsignedLEB128(seg.bytes.length),
      ...seg.bytes,
    );
  }
  return makeSection(Section.DATA, content);
}

// ── Address-taken variable analysis ──────────────────────

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

type Ctx = {
  locals: Map<string, number>;
  memVars: Map<string, number>;
  funcIndex: Map<string, number>;
  stringMap: Map<string, number>;
};

function collectLocalsFromStatements(
  stmts: Statement[], locals: Map<string, number>,
  addressTaken: Set<string>, offset: number,
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
    if (stmt.type === "WhileStatement") count += collectLocalsFromStatements(stmt.body, locals, addressTaken, offset + count);
    if (stmt.type === "ForStatement") {
      count += collectLocalsFromStatements([stmt.init], locals, addressTaken, offset + count);
      count += collectLocalsFromStatements(stmt.body, locals, addressTaken, offset + count);
    }
  }
  return count;
}

function collectAllVarNames(stmts: Statement[], names: Set<string>): void {
  for (const s of stmts) {
    if (s.type === "VariableDeclaration") names.add(s.name);
    if (s.type === "IfStatement") { collectAllVarNames(s.consequent, names); if (s.alternate) collectAllVarNames(s.alternate, names); }
    if (s.type === "WhileStatement") collectAllVarNames(s.body, names);
    if (s.type === "ForStatement") { collectAllVarNames([s.init], names); collectAllVarNames(s.body, names); }
  }
}

function buildFunctionBody(
  func: FunctionDeclaration,
  funcIndex: Map<string, number>,
  stringMap: Map<string, number>,
): number[] {
  const addressTaken = findAddressTakenVars(func);
  const locals = new Map<string, number>();
  for (let i = 0; i < func.params.length; i++) {
    if (!addressTaken.has(func.params[i].name)) locals.set(func.params[i].name, i);
  }
  const paramLocalCount = func.params.length;
  const declaredCount = collectLocalsFromStatements(func.body, locals, addressTaken, paramLocalCount);

  const memVars = new Map<string, number>();
  const atParamCopies: { paramIdx: number; memAddr: number }[] = [];
  for (let i = 0; i < func.params.length; i++) {
    if (addressTaken.has(func.params[i].name)) {
      const addr = nextMemAddr; nextMemAddr += 4;
      memVars.set(func.params[i].name, addr);
      atParamCopies.push({ paramIdx: i, memAddr: addr });
    }
  }
  const allVarNames = new Set<string>();
  collectAllVarNames(func.body, allVarNames);
  for (const name of allVarNames) {
    if (addressTaken.has(name) && !memVars.has(name)) {
      memVars.set(name, nextMemAddr); nextMemAddr += 4;
    }
  }

  const ctx: Ctx = { locals, memVars, funcIndex, stringMap };
  const instructions: number[] = [];

  for (const ap of atParamCopies) {
    instructions.push(Op.I32_CONST, ...encodeSignedLEB128(ap.memAddr));
    instructions.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(ap.paramIdx));
    instructions.push(Op.I32_STORE, 0x02, 0x00);
  }

  emitStatements(instructions, func.body, ctx);

  const localDeclBytes: number[] = [];
  if (declaredCount > 0) {
    localDeclBytes.push(...encodeUnsignedLEB128(1), ...encodeUnsignedLEB128(declaredCount), ValType.I32);
  } else {
    localDeclBytes.push(0x00);
  }

  instructions.push(Op.I32_CONST, ...encodeSignedLEB128(0));
  const bodyContent = [...localDeclBytes, ...instructions, Op.END];
  return [...encodeUnsignedLEB128(bodyContent.length), ...bodyContent];
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
    case "VariableDeclaration":
      if (ctx.memVars.has(stmt.name)) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(ctx.memVars.get(stmt.name)!));
        emitExpression(out, stmt.initializer, ctx);
        out.push(Op.I32_STORE, 0x02, 0x00);
      } else {
        const idx = ctx.locals.get(stmt.name);
        if (idx === undefined) throw new Error(`Unknown local '${stmt.name}'`);
        emitExpression(out, stmt.initializer, ctx);
        out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
      }
      break;
    case "ExpressionStatement":
      emitExpression(out, stmt.expression, ctx);
      break;
    case "IfStatement":
      emitExpression(out, stmt.condition, ctx);
      out.push(Op.IF, BLOCK_VOID);
      for (const s of stmt.consequent) emitStatement(out, s, ctx);
      if (stmt.alternate) { out.push(Op.ELSE); for (const s of stmt.alternate) emitStatement(out, s, ctx); }
      out.push(Op.END);
      break;
    case "WhileStatement":
      out.push(Op.BLOCK, BLOCK_VOID, Op.LOOP, BLOCK_VOID);
      emitExpression(out, stmt.condition, ctx);
      out.push(Op.I32_EQZ, Op.BR_IF, ...encodeUnsignedLEB128(1));
      for (const s of stmt.body) emitStatement(out, s, ctx);
      out.push(Op.BR, ...encodeUnsignedLEB128(0), Op.END, Op.END);
      break;
    case "ForStatement":
      emitStatement(out, stmt.init, ctx);
      out.push(Op.BLOCK, BLOCK_VOID, Op.LOOP, BLOCK_VOID);
      emitExpression(out, stmt.condition, ctx);
      out.push(Op.I32_EQZ, Op.BR_IF, ...encodeUnsignedLEB128(1));
      for (const s of stmt.body) emitStatement(out, s, ctx);
      emitExpression(out, stmt.update, ctx);
      out.push(Op.BR, ...encodeUnsignedLEB128(0), Op.END, Op.END);
      break;
  }
}

// ── Expression emission ──────────────────────────────────

const BINOP_MAP: Record<string, number> = {
  "+": Op.I32_ADD, "-": Op.I32_SUB, "*": Op.I32_MUL, "/": Op.I32_DIV_S, "%": Op.I32_REM_S,
  "==": Op.I32_EQ, "!=": Op.I32_NE, "<": Op.I32_LT_S, ">": Op.I32_GT_S, "<=": Op.I32_LE_S, ">=": Op.I32_GE_S,
};

function emitExpression(out: number[], expr: Expression, ctx: Ctx): void {
  switch (expr.type) {
    case "IntegerLiteral":
      out.push(Op.I32_CONST, ...encodeSignedLEB128(expr.value));
      break;
    case "StringLiteral": {
      const addr = ctx.stringMap.get(expr.value);
      if (addr === undefined) throw new Error(`Unknown string literal`);
      out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
      break;
    }
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
    case "Identifier":
      if (ctx.memVars.has(expr.name)) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(ctx.memVars.get(expr.name)!));
        out.push(Op.I32_LOAD, 0x02, 0x00);
      } else {
        const idx = ctx.locals.get(expr.name);
        if (idx === undefined) throw new Error(`Unknown variable '${expr.name}'`);
        out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(idx));
      }
      break;
    case "AssignmentExpression":
      if (ctx.memVars.has(expr.name)) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(ctx.memVars.get(expr.name)!));
        emitExpression(out, expr.value, ctx);
        out.push(Op.I32_STORE, 0x02, 0x00);
      } else {
        const idx = ctx.locals.get(expr.name);
        if (idx === undefined) throw new Error(`Unknown variable '${expr.name}'`);
        emitExpression(out, expr.value, ctx);
        out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
      }
      break;
    case "CallExpression": {
      const fIdx = ctx.funcIndex.get(expr.callee);
      if (fIdx === undefined) throw new Error(`Unknown function '${expr.callee}'`);
      for (const arg of expr.args) emitExpression(out, arg, ctx);
      out.push(Op.CALL, ...encodeUnsignedLEB128(fIdx));
      break;
    }
    case "AddressOfExpression": {
      const addr = ctx.memVars.get(expr.name);
      if (addr === undefined) throw new Error(`Cannot take address of '${expr.name}'`);
      out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
      break;
    }
    case "DereferenceExpression":
      emitExpression(out, expr.operand, ctx);
      out.push(Op.I32_LOAD, 0x02, 0x00);
      break;
    case "DereferenceAssignment":
      emitExpression(out, expr.pointer, ctx);
      emitExpression(out, expr.value, ctx);
      out.push(Op.I32_STORE, 0x02, 0x00);
      break;
  }
}
