import type { Program, FunctionDeclaration, ExternFunctionDeclaration, GlobalVariableDeclaration, Statement, Expression, TypeSpecifier } from "./types.ts";
import {
  WASM_MAGIC,
  WASM_VERSION,
  Section,
  ValType,
  Op,
  ExportKind,
  FUNC_TYPE_TAG,
  BLOCK_VOID,
  BLOCK_I32,
  BLOCK_I64,
  encodeUnsignedLEB128,
  encodeSignedLEB128,
  encodeSignedLEB128_i64,
  encodeName,
  makeSection,
} from "./wasm.ts";

// ── C type helpers ──────────────────────────────────────────

type CType = "char" | "int" | "long" | "void";

function wasmTypeFor(ctype: CType): number {
  return ctype === "long" ? ValType.I64 : ValType.I32;
}

function blockTypeFor(ctype: CType): number {
  return ctype === "long" ? BLOCK_I64 : BLOCK_I32;
}

function sizeOfType(ctype: CType): number {
  switch (ctype) {
    case "char": return 1;
    case "int": return 4;
    case "long": return 8;
    case "void": return 0;
  }
}

/** Promote: char < int < long. Returns the wider type. */
function promoteTypes(a: CType, b: CType): CType {
  if (a === "long" || b === "long") return "long";
  return "int"; // char promotes to int
}

function emitConversion(out: number[], from: CType, to: CType): void {
  const fromW = wasmTypeFor(from);
  const toW = wasmTypeFor(to);
  if (fromW === toW) return;
  if (fromW === ValType.I32 && toW === ValType.I64) {
    out.push(Op.I64_EXTEND_I32_S);
  } else if (fromW === ValType.I64 && toW === ValType.I32) {
    out.push(Op.I32_WRAP_I64);
  }
}

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

  // Separate declarations by kind
  const externs: ExternFunctionDeclaration[] = [];
  const funcs: FunctionDeclaration[] = [];
  const globals: GlobalVariableDeclaration[] = [];
  for (const d of ast.declarations) {
    if (d.type === "ExternFunctionDeclaration") externs.push(d);
    else if (d.type === "FunctionDeclaration") funcs.push(d);
    else if (d.type === "GlobalVariableDeclaration") globals.push(d);
  }

  // Build global variable name -> WASM global index map + types
  const globalIndex = new Map<string, number>();
  const globalTypes = new Map<string, CType>();
  for (let i = 0; i < globals.length; i++) {
    globalIndex.set(globals[i].name, i);
    globalTypes.set(globals[i].name, globals[i].typeSpec as CType);
  }

  // Build function return type + param type maps
  const funcReturnTypes = new Map<string, CType>();
  const funcParamTypes = new Map<string, CType[]>();
  for (const ext of externs) {
    funcReturnTypes.set(ext.name, (ext.returnType || "int") as CType);
    funcParamTypes.set(ext.name, ext.params.map(p => (p.typeSpec || "int") as CType));
  }
  for (const func of funcs) {
    funcReturnTypes.set(func.name, (func.returnType || "int") as CType);
    funcParamTypes.set(func.name, func.params.map(p => (p.typeSpec || "int") as CType));
  }

  // String data starts at address 1024 (leave 0-1023 for stack variables)
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

  // Build type signatures (deduplicated by full signature)
  const typeSigs: number[][] = [];
  const typeSigMap = new Map<string, number>();

  function getTypeIdx(paramTypes: number[], returnType: number): number {
    const key = `${paramTypes.join(",")}->${returnType}`;
    let idx = typeSigMap.get(key);
    if (idx === undefined) {
      idx = typeSigs.length;
      typeSigMap.set(key, idx);
      typeSigs.push(buildTypeSig(paramTypes, returnType));
    }
    return idx;
  }

  // Type indices for imported functions
  const importTypeIndices: number[] = [];
  for (const ext of externs) {
    const paramTypes = ext.params.map(p => wasmTypeFor((p.typeSpec || "int") as CType));
    const retType = wasmTypeFor((ext.returnType || "int") as CType);
    importTypeIndices.push(getTypeIdx(paramTypes, retType));
  }

  // Type indices for local functions
  const funcTypeIndices: number[] = [];
  for (const func of funcs) {
    const paramTypes = func.params.map(p => wasmTypeFor((p.typeSpec || "int") as CType));
    const retType = wasmTypeFor((func.returnType || "int") as CType);
    funcTypeIndices.push(getTypeIdx(paramTypes, retType));
  }

  // Detect if memory is needed
  if (stringData.length > 0) memoryUsed = true;
  for (const func of funcs) {
    if (functionUsesMemory(func)) { memoryUsed = true; break; }
  }

  // Build sections (must follow WASM section ordering: 1,2,3,5,6,7,10,11)
  const typeSection = buildTypeSection(typeSigs);
  const importSection = externs.length > 0 ? buildImportSection(externs, importTypeIndices) : [];
  const funcSection = buildFunctionSection(funcTypeIndices);
  const memorySection = memoryUsed ? buildMemorySection() : [];
  const globalSection = globals.length > 0 ? buildGlobalSection(globals) : [];
  const exportSection = buildExportSection(funcs, importCount);
  const codeSection = buildCodeSection(funcs, funcIndex, stringMap, globalIndex, globalTypes, funcReturnTypes, funcParamTypes);
  const dataSection = stringData.length > 0 ? buildDataSection() : [];

  const bytes: number[] = [
    ...WASM_MAGIC,
    ...WASM_VERSION,
    ...typeSection,
    ...importSection,
    ...funcSection,
    ...memorySection,
    ...globalSection,
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
    } else if (d.type === "GlobalVariableDeclaration") {
      collectStringsFromExpr(d.initializer, cb);
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
    case "ArrayDeclaration":
      if (stmt.initializer) stmt.initializer.forEach(e => collectStringsFromExpr(e, cb));
      break;
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
    case "CompoundAssignmentExpression": collectStringsFromExpr(expr.value, cb); break;
    case "CallExpression": expr.args.forEach((a) => collectStringsFromExpr(a, cb)); break;
    case "LogicalExpression": collectStringsFromExpr(expr.left, cb); collectStringsFromExpr(expr.right, cb); break;
    case "TernaryExpression": collectStringsFromExpr(expr.condition, cb); collectStringsFromExpr(expr.consequent, cb); collectStringsFromExpr(expr.alternate, cb); break;
    case "ArrayAccessExpression": collectStringsFromExpr(expr.index, cb); break;
    case "ArrayIndexAssignment": collectStringsFromExpr(expr.index, cb); collectStringsFromExpr(expr.value, cb); break;
    case "CastExpression": collectStringsFromExpr(expr.operand, cb); break;
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
    case "ArrayDeclaration": return true;
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
    case "AddressOfExpression": case "DereferenceExpression": case "DereferenceAssignment": case "StringLiteral":
    case "ArrayAccessExpression": case "ArrayIndexAssignment": return true;
    case "BinaryExpression": return exprUsesMemory(expr.left) || exprUsesMemory(expr.right);
    case "UnaryExpression": return exprUsesMemory(expr.operand);
    case "AssignmentExpression": return exprUsesMemory(expr.value);
    case "CompoundAssignmentExpression": return exprUsesMemory(expr.value);
    case "CallExpression": return expr.args.some(exprUsesMemory);
    case "LogicalExpression": return exprUsesMemory(expr.left) || exprUsesMemory(expr.right);
    case "TernaryExpression": return exprUsesMemory(expr.condition) || exprUsesMemory(expr.consequent) || exprUsesMemory(expr.alternate);
    case "CastExpression": return exprUsesMemory(expr.operand);
    default: return false;
  }
}

// ── Sections ─────────────────────────────────────────────

function buildTypeSig(paramTypes: number[], returnType: number): number[] {
  return [
    FUNC_TYPE_TAG,
    ...encodeUnsignedLEB128(paramTypes.length),
    ...paramTypes,
    0x01, returnType,
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

/**
 * Evaluates a constant expression at compile time.
 * Returns the evaluated integer, or null if not a constant expression.
 */
function evalConstExpr(expr: Expression): number | null {
  switch (expr.type) {
    case "IntegerLiteral":
      return expr.value;
    case "CharLiteral":
      return expr.value;
    case "UnaryExpression":
      if (expr.operator === "-") {
        const v = evalConstExpr(expr.operand);
        return v !== null ? -v : null;
      }
      if (expr.operator === "!") {
        const v = evalConstExpr(expr.operand);
        return v !== null ? (v === 0 ? 1 : 0) : null;
      }
      return null;
    case "BinaryExpression": {
      const l = evalConstExpr(expr.left);
      const r = evalConstExpr(expr.right);
      if (l === null || r === null) return null;
      switch (expr.operator) {
        case "+": return (l + r) | 0;
        case "-": return (l - r) | 0;
        case "*": return Math.imul(l, r);
        case "/": return r === 0 ? null : (l / r) | 0;
        case "%": return r === 0 ? null : (l % r) | 0;
        case "==": return l === r ? 1 : 0;
        case "!=": return l !== r ? 1 : 0;
        case "<": return l < r ? 1 : 0;
        case ">": return l > r ? 1 : 0;
        case "<=": return l <= r ? 1 : 0;
        case ">=": return l >= r ? 1 : 0;
        default: return null;
      }
    }
    case "SizeofExpression":
      return sizeOfType(expr.targetType as CType);
    default:
      return null;
  }
}

/**
 * Global section: declares mutable globals with constant initializers.
 */
function buildGlobalSection(globals: GlobalVariableDeclaration[]): number[] {
  const content: number[] = [...encodeUnsignedLEB128(globals.length)];
  for (const g of globals) {
    const ctype = (g.typeSpec || "int") as CType;
    const wt = wasmTypeFor(ctype);
    content.push(wt, 0x01); // mutable
    const val = evalConstExpr(g.initializer);
    if (ctype === "long") {
      content.push(Op.I64_CONST, ...encodeSignedLEB128_i64(val ?? 0), Op.END);
    } else {
      content.push(Op.I32_CONST, ...encodeSignedLEB128(val ?? 0), Op.END);
    }
  }
  return makeSection(Section.GLOBAL, content);
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
  globalIndex: Map<string, number>,
  globalTypes: Map<string, CType>,
  funcReturnTypes: Map<string, CType>,
  funcParamTypes: Map<string, CType[]>,
): number[] {
  const bodies: number[] = [];
  for (const func of funcs) {
    bodies.push(...buildFunctionBody(func, funcIndex, stringMap, globalIndex, globalTypes, funcReturnTypes, funcParamTypes));
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
    case "ArrayDeclaration":
      if (stmt.initializer) stmt.initializer.forEach(e => findATInExpr(e, taken));
      break;
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
    case "CompoundAssignmentExpression": findATInExpr(expr.value, taken); break;
    case "CallExpression": expr.args.forEach((a) => findATInExpr(a, taken)); break;
    case "LogicalExpression": findATInExpr(expr.left, taken); findATInExpr(expr.right, taken); break;
    case "TernaryExpression": findATInExpr(expr.condition, taken); findATInExpr(expr.consequent, taken); findATInExpr(expr.alternate, taken); break;
    case "ArrayAccessExpression": findATInExpr(expr.index, taken); break;
    case "ArrayIndexAssignment": findATInExpr(expr.index, taken); findATInExpr(expr.value, taken); break;
    case "CastExpression": findATInExpr(expr.operand, taken); break;
    default: break;
  }
}

// ── Local variable tracking ──────────────────────────────

type Ctx = {
  locals: Map<string, number>;
  localTypes: Map<string, CType>;
  memVars: Map<string, number>;
  memVarTypes: Map<string, CType>;
  arrayVars: Map<string, { addr: number; size: number }>;
  funcIndex: Map<string, number>;
  stringMap: Map<string, number>;
  globalIndex: Map<string, number>;
  globalTypes: Map<string, CType>;
  funcReturnTypes: Map<string, CType>;
  funcParamTypes: Map<string, CType[]>;
  returnType: CType;
};

function collectLocalsFromStatements(
  stmts: Statement[], locals: Map<string, number>,
  localTypes: Map<string, CType>,
  addressTaken: Set<string>, offset: number,
  i32Count: { n: number }, i64Count: { n: number },
): number {
  let count = 0;
  for (const stmt of stmts) {
    if (stmt.type === "VariableDeclaration" && !locals.has(stmt.name) && !addressTaken.has(stmt.name)) {
      const ctype = (stmt.typeSpec || "int") as CType;
      locals.set(stmt.name, offset + count);
      localTypes.set(stmt.name, ctype);
      if (ctype === "long") i64Count.n++; else i32Count.n++;
      count++;
    }
    if (stmt.type === "IfStatement") {
      count += collectLocalsFromStatements(stmt.consequent, locals, localTypes, addressTaken, offset + count, i32Count, i64Count);
      if (stmt.alternate) count += collectLocalsFromStatements(stmt.alternate, locals, localTypes, addressTaken, offset + count, i32Count, i64Count);
    }
    if (stmt.type === "WhileStatement") count += collectLocalsFromStatements(stmt.body, locals, localTypes, addressTaken, offset + count, i32Count, i64Count);
    if (stmt.type === "ForStatement") {
      count += collectLocalsFromStatements([stmt.init], locals, localTypes, addressTaken, offset + count, i32Count, i64Count);
      count += collectLocalsFromStatements(stmt.body, locals, localTypes, addressTaken, offset + count, i32Count, i64Count);
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

/** Collect type specs for all variable declarations */
function collectVarTypes(stmts: Statement[], types: Map<string, CType>): void {
  for (const s of stmts) {
    if (s.type === "VariableDeclaration") types.set(s.name, (s.typeSpec || "int") as CType);
    if (s.type === "IfStatement") { collectVarTypes(s.consequent, types); if (s.alternate) collectVarTypes(s.alternate, types); }
    if (s.type === "WhileStatement") collectVarTypes(s.body, types);
    if (s.type === "ForStatement") { collectVarTypes([s.init], types); collectVarTypes(s.body, types); }
  }
}

function buildFunctionBody(
  func: FunctionDeclaration,
  funcIndex: Map<string, number>,
  stringMap: Map<string, number>,
  globalIndex: Map<string, number>,
  globalTypes: Map<string, CType>,
  funcReturnTypes: Map<string, CType>,
  funcParamTypes: Map<string, CType[]>,
): number[] {
  const addressTaken = findAddressTakenVars(func);
  const locals = new Map<string, number>();
  const localTypes = new Map<string, CType>();

  // Params: WASM requires all params declared upfront with their types.
  // We need i32 params first, then i64 params — but actually WASM params
  // maintain declaration order. The key insight: params are indexed by
  // their declaration order, and their types are fixed by the function signature.
  for (let i = 0; i < func.params.length; i++) {
    const ptype = (func.params[i].typeSpec || "int") as CType;
    if (!addressTaken.has(func.params[i].name)) {
      locals.set(func.params[i].name, i);
      localTypes.set(func.params[i].name, ptype);
    }
  }

  const paramLocalCount = func.params.length;
  const i32Count = { n: 0 };
  const i64Count = { n: 0 };

  // We need to be careful about local ordering in WASM.
  // WASM locals are declared as groups: e.g. [3 x i32, 1 x i64].
  // But local indices are sequential after params. So we need to:
  // 1. First pass: find all locals and their types
  // 2. Assign indices: all i32 locals first, then all i64 locals
  // This approach is simpler but we need to track which locals are i32 vs i64.

  // Actually, let's keep it simpler: declare each local individually.
  // WASM allows multiple local groups, so we just enumerate them.
  // The local index assignment already happens in collectLocalsFromStatements.
  // But now we need to handle mixed types.

  // Strategy: collect all locals with types first, then assign indices
  // such that i32 locals come first, then i64 locals.

  // First, collect all non-AT variable declarations with their types
  const allDeclaredVars: { name: string; ctype: CType }[] = [];
  function collectDeclaredVars(stmts: Statement[]): void {
    for (const stmt of stmts) {
      if (stmt.type === "VariableDeclaration" && !addressTaken.has(stmt.name)) {
        if (!allDeclaredVars.find(v => v.name === stmt.name)) {
          const ctype = (stmt.typeSpec || "int") as CType;
          allDeclaredVars.push({ name: stmt.name, ctype });
        }
      }
      if (stmt.type === "IfStatement") { collectDeclaredVars(stmt.consequent); if (stmt.alternate) collectDeclaredVars(stmt.alternate); }
      if (stmt.type === "WhileStatement") collectDeclaredVars(stmt.body);
      if (stmt.type === "ForStatement") { collectDeclaredVars([stmt.init]); collectDeclaredVars(stmt.body); }
    }
  }
  collectDeclaredVars(func.body);

  // Partition into i32 and i64 locals
  const i32Locals = allDeclaredVars.filter(v => v.ctype !== "long");
  const i64Locals = allDeclaredVars.filter(v => v.ctype === "long");

  // Assign indices: params first (in order), then i32 locals, then i64 locals
  let nextIdx = paramLocalCount;
  for (const v of i32Locals) {
    locals.set(v.name, nextIdx++);
    localTypes.set(v.name, v.ctype);
  }
  for (const v of i64Locals) {
    locals.set(v.name, nextIdx++);
    localTypes.set(v.name, v.ctype);
  }

  const memVars = new Map<string, number>();
  const memVarTypes = new Map<string, CType>();
  const atParamCopies: { paramIdx: number; memAddr: number; ctype: CType }[] = [];

  // Collect all var types for AT vars
  const allVarTypeMap = new Map<string, CType>();
  collectVarTypes(func.body, allVarTypeMap);

  for (let i = 0; i < func.params.length; i++) {
    if (addressTaken.has(func.params[i].name)) {
      const ptype = (func.params[i].typeSpec || "int") as CType;
      const size = sizeOfType(ptype);
      // Align to natural alignment
      while (nextMemAddr % size !== 0) nextMemAddr++;
      const addr = nextMemAddr;
      nextMemAddr += size;
      memVars.set(func.params[i].name, addr);
      memVarTypes.set(func.params[i].name, ptype);
      atParamCopies.push({ paramIdx: i, memAddr: addr, ctype: ptype });
    }
  }

  const allVarNames = new Set<string>();
  collectAllVarNames(func.body, allVarNames);
  for (const name of allVarNames) {
    if (addressTaken.has(name) && !memVars.has(name)) {
      const ctype = allVarTypeMap.get(name) || "int";
      const size = sizeOfType(ctype);
      while (nextMemAddr % size !== 0) nextMemAddr++;
      memVars.set(name, nextMemAddr);
      memVarTypes.set(name, ctype);
      nextMemAddr += size;
    }
  }

  // Allocate arrays in linear memory
  const arrayVars = new Map<string, { addr: number; size: number }>();
  function collectArrayDecls(stmts: Statement[]): void {
    for (const s of stmts) {
      if (s.type === "ArrayDeclaration" && !arrayVars.has(s.name)) {
        const addr = nextMemAddr;
        nextMemAddr += s.size * 4;
        arrayVars.set(s.name, { addr, size: s.size });
      }
      if (s.type === "IfStatement") { collectArrayDecls(s.consequent); if (s.alternate) collectArrayDecls(s.alternate); }
      if (s.type === "WhileStatement") collectArrayDecls(s.body);
      if (s.type === "ForStatement") { collectArrayDecls([s.init]); collectArrayDecls(s.body); }
    }
  }
  collectArrayDecls(func.body);

  const returnType = (func.returnType || "int") as CType;
  const ctx: Ctx = { locals, localTypes, memVars, memVarTypes, arrayVars, funcIndex, stringMap, globalIndex, globalTypes, funcReturnTypes, funcParamTypes, returnType };
  const instructions: number[] = [];

  for (const ap of atParamCopies) {
    instructions.push(Op.I32_CONST, ...encodeSignedLEB128(ap.memAddr));
    instructions.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(ap.paramIdx));
    if (ap.ctype === "long") {
      instructions.push(Op.I64_STORE, 0x03, 0x00);
    } else {
      instructions.push(Op.I32_STORE, 0x02, 0x00);
    }
  }

  emitStatements(instructions, func.body, ctx);

  // Build local declarations
  const localDeclBytes: number[] = [];
  const localGroups: [number, number][] = []; // [count, type]
  if (i32Locals.length > 0) localGroups.push([i32Locals.length, ValType.I32]);
  if (i64Locals.length > 0) localGroups.push([i64Locals.length, ValType.I64]);

  if (localGroups.length > 0) {
    localDeclBytes.push(...encodeUnsignedLEB128(localGroups.length));
    for (const [count, type] of localGroups) {
      localDeclBytes.push(...encodeUnsignedLEB128(count), type);
    }
  } else {
    localDeclBytes.push(0x00);
  }

  // Implicit return value
  if (returnType === "long") {
    instructions.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0));
  } else {
    instructions.push(Op.I32_CONST, ...encodeSignedLEB128(0));
  }
  const bodyContent = [...localDeclBytes, ...instructions, Op.END];
  return [...encodeUnsignedLEB128(bodyContent.length), ...bodyContent];
}

// ── Statement emission ───────────────────────────────────

function emitStatements(out: number[], stmts: Statement[], ctx: Ctx): void {
  for (const stmt of stmts) emitStatement(out, stmt, ctx);
}

function emitStatement(out: number[], stmt: Statement, ctx: Ctx): void {
  switch (stmt.type) {
    case "ReturnStatement": {
      const exprType = emitExpression(out, stmt.expression, ctx);
      // Convert to function return type if needed
      emitConversion(out, exprType, ctx.returnType);
      out.push(Op.RETURN);
      break;
    }
    case "VariableDeclaration": {
      const varType = getVarType(stmt.name, ctx);
      if (ctx.memVars.has(stmt.name)) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(ctx.memVars.get(stmt.name)!));
        const exprType = emitExpression(out, stmt.initializer, ctx);
        emitConversion(out, exprType, varType);
        emitMemStore(out, varType);
      } else {
        const idx = ctx.locals.get(stmt.name);
        if (idx === undefined) throw new Error(`Unknown local '${stmt.name}'`);
        const exprType = emitExpression(out, stmt.initializer, ctx);
        emitConversion(out, exprType, varType);
        out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
      }
      break;
    }
    case "ArrayDeclaration":
      if (stmt.initializer) {
        const arrInfo = ctx.arrayVars.get(stmt.name)!;
        for (let i = 0; i < stmt.initializer.length; i++) {
          out.push(Op.I32_CONST, ...encodeSignedLEB128(arrInfo.addr + i * 4));
          emitExpression(out, stmt.initializer[i], ctx);
          out.push(Op.I32_STORE, 0x02, 0x00);
        }
      }
      break;
    case "ExpressionStatement": {
      const exprType = emitExpression(out, stmt.expression, ctx);
      if (exprProducesValue(stmt.expression)) {
        out.push(Op.DROP);
      }
      break;
    }
    case "IfStatement": {
      const condType = emitExpression(out, stmt.condition, ctx);
      // Condition must be i32 for WASM if
      if (condType === "long") {
        out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0));
        out.push(Op.I64_NE);
      }
      out.push(Op.IF, BLOCK_VOID);
      for (const s of stmt.consequent) emitStatement(out, s, ctx);
      if (stmt.alternate) { out.push(Op.ELSE); for (const s of stmt.alternate) emitStatement(out, s, ctx); }
      out.push(Op.END);
      break;
    }
    case "WhileStatement": {
      out.push(Op.BLOCK, BLOCK_VOID, Op.LOOP, BLOCK_VOID);
      const condType = emitExpression(out, stmt.condition, ctx);
      if (condType === "long") {
        out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0));
        out.push(Op.I64_NE);
      }
      out.push(Op.I32_EQZ, Op.BR_IF, ...encodeUnsignedLEB128(1));
      for (const s of stmt.body) emitStatement(out, s, ctx);
      out.push(Op.BR, ...encodeUnsignedLEB128(0), Op.END, Op.END);
      break;
    }
    case "ForStatement": {
      emitStatement(out, stmt.init, ctx);
      out.push(Op.BLOCK, BLOCK_VOID, Op.LOOP, BLOCK_VOID);
      const condType = emitExpression(out, stmt.condition, ctx);
      if (condType === "long") {
        out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0));
        out.push(Op.I64_NE);
      }
      out.push(Op.I32_EQZ, Op.BR_IF, ...encodeUnsignedLEB128(1));
      for (const s of stmt.body) emitStatement(out, s, ctx);
      emitExpression(out, stmt.update, ctx);
      if (exprProducesValue(stmt.update)) out.push(Op.DROP);
      out.push(Op.BR, ...encodeUnsignedLEB128(0), Op.END, Op.END);
      break;
    }
  }
}

// ── Expression value tracking ────────────────────────────

function exprProducesValue(expr: Expression): boolean {
  switch (expr.type) {
    case "AssignmentExpression":
    case "CompoundAssignmentExpression":
    case "DereferenceAssignment":
    case "ArrayIndexAssignment":
      return false;
    default:
      return true;
  }
}

// ── Type inference (without emitting code) ───────────────

function inferType(expr: Expression, ctx: Ctx): CType {
  switch (expr.type) {
    case "IntegerLiteral": return "int";
    case "CharLiteral": return "int"; // char literal promotes to int in C
    case "StringLiteral": return "int"; // pointer
    case "SizeofExpression": return "int";
    case "Identifier": return getVarType(expr.name, ctx);
    case "BinaryExpression": {
      const lt = inferType(expr.left, ctx);
      const rt = inferType(expr.right, ctx);
      const op = expr.operator;
      // Comparisons always return int
      if (op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=") return "int";
      return promoteTypes(lt, rt);
    }
    case "UnaryExpression":
      if (expr.operator === "!") return "int";
      return inferType(expr.operand, ctx);
    case "CastExpression": return expr.targetType as CType;
    case "CallExpression": return ctx.funcReturnTypes.get(expr.callee) || "int";
    case "AssignmentExpression": return getVarType(expr.name, ctx);
    case "CompoundAssignmentExpression": return getVarType(expr.name, ctx);
    case "UpdateExpression": return getVarType(expr.name, ctx);
    case "LogicalExpression": return "int"; // always 0 or 1
    case "TernaryExpression": return promoteTypes(inferType(expr.consequent, ctx), inferType(expr.alternate, ctx));
    case "AddressOfExpression": return "int"; // pointer
    case "DereferenceExpression": return "int"; // dereferencing gives int (for now)
    case "DereferenceAssignment": return "void";
    case "ArrayAccessExpression": return "int";
    case "ArrayIndexAssignment": return "void";
  }
}

function getVarType(name: string, ctx: Ctx): CType {
  if (ctx.localTypes.has(name)) return ctx.localTypes.get(name)!;
  if (ctx.memVarTypes.has(name)) return ctx.memVarTypes.get(name)!;
  if (ctx.globalTypes.has(name)) return ctx.globalTypes.get(name)!;
  return "int";
}

// ── Memory helpers ───────────────────────────────────────

function emitMemLoad(out: number[], ctype: CType): void {
  switch (ctype) {
    case "char":
      out.push(Op.I32_LOAD8_S, 0x00, 0x00);
      break;
    case "long":
      out.push(Op.I64_LOAD, 0x03, 0x00);
      break;
    default: // int
      out.push(Op.I32_LOAD, 0x02, 0x00);
      break;
  }
}

function emitMemStore(out: number[], ctype: CType): void {
  switch (ctype) {
    case "char":
      out.push(Op.I32_STORE8, 0x00, 0x00);
      break;
    case "long":
      out.push(Op.I64_STORE, 0x03, 0x00);
      break;
    default: // int
      out.push(Op.I32_STORE, 0x02, 0x00);
      break;
  }
}

// ── Expression emission ──────────────────────────────────

const BINOP_MAP: Record<string, number> = {
  "+": Op.I32_ADD, "-": Op.I32_SUB, "*": Op.I32_MUL, "/": Op.I32_DIV_S, "%": Op.I32_REM_S,
  "==": Op.I32_EQ, "!=": Op.I32_NE, "<": Op.I32_LT_S, ">": Op.I32_GT_S, "<=": Op.I32_LE_S, ">=": Op.I32_GE_S,
};

const BINOP_MAP_I64: Record<string, number> = {
  "+": Op.I64_ADD, "-": Op.I64_SUB, "*": Op.I64_MUL, "/": Op.I64_DIV_S, "%": Op.I64_REM_S,
  "==": Op.I64_EQ, "!=": Op.I64_NE, "<": Op.I64_LT_S, ">": Op.I64_GT_S, "<=": Op.I64_LE_S, ">=": Op.I64_GE_S,
};

const COMPOUND_OP_MAP: Record<string, number> = {
  "+=": Op.I32_ADD, "-=": Op.I32_SUB, "*=": Op.I32_MUL, "/=": Op.I32_DIV_S, "%=": Op.I32_REM_S,
};

const COMPOUND_OP_MAP_I64: Record<string, number> = {
  "+=": Op.I64_ADD, "-=": Op.I64_SUB, "*=": Op.I64_MUL, "/=": Op.I64_DIV_S, "%=": Op.I64_REM_S,
};

function emitVarGet(out: number[], name: string, ctx: Ctx): CType {
  const vtype = getVarType(name, ctx);
  if (ctx.memVars.has(name)) {
    out.push(Op.I32_CONST, ...encodeSignedLEB128(ctx.memVars.get(name)!));
    emitMemLoad(out, vtype);
  } else if (ctx.locals.has(name)) {
    out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(ctx.locals.get(name)!));
  } else if (ctx.globalIndex.has(name)) {
    out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(ctx.globalIndex.get(name)!));
  } else {
    throw new Error(`Unknown variable '${name}'`);
  }
  return vtype;
}

function emitVarSet(out: number[], name: string, ctx: Ctx): void {
  const vtype = getVarType(name, ctx);
  if (ctx.memVars.has(name)) {
    emitMemStore(out, vtype);
  } else if (ctx.locals.has(name)) {
    out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(ctx.locals.get(name)!));
  } else if (ctx.globalIndex.has(name)) {
    out.push(Op.GLOBAL_SET, ...encodeUnsignedLEB128(ctx.globalIndex.get(name)!));
  } else {
    throw new Error(`Unknown variable '${name}'`);
  }
}

function emitExpression(out: number[], expr: Expression, ctx: Ctx): CType {
  switch (expr.type) {
    case "IntegerLiteral":
      out.push(Op.I32_CONST, ...encodeSignedLEB128(expr.value));
      return "int";
    case "CharLiteral":
      out.push(Op.I32_CONST, ...encodeSignedLEB128(expr.value));
      return "int";
    case "SizeofExpression":
      out.push(Op.I32_CONST, ...encodeSignedLEB128(sizeOfType(expr.targetType as CType)));
      return "int";
    case "StringLiteral": {
      const addr = ctx.stringMap.get(expr.value);
      if (addr === undefined) throw new Error(`Unknown string literal`);
      out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
      return "int";
    }
    case "BinaryExpression": {
      const leftType = inferType(expr.left, ctx);
      const rightType = inferType(expr.right, ctx);
      const isComparison = ["==", "!=", "<", ">", "<=", ">="].includes(expr.operator);
      const opType = promoteTypes(leftType, rightType);

      const lt = emitExpression(out, expr.left, ctx);
      emitConversion(out, lt, opType);
      const rt = emitExpression(out, expr.right, ctx);
      emitConversion(out, rt, opType);

      if (opType === "long") {
        out.push(BINOP_MAP_I64[expr.operator]);
      } else {
        out.push(BINOP_MAP[expr.operator]);
      }
      // Comparisons always return i32
      return isComparison ? "int" : opType;
    }
    case "UnaryExpression":
      if (expr.operator === "-") {
        const operandType = inferType(expr.operand, ctx);
        if (operandType === "long") {
          out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0));
          emitExpression(out, expr.operand, ctx);
          out.push(Op.I64_SUB);
          return "long";
        } else {
          out.push(Op.I32_CONST, ...encodeSignedLEB128(0));
          emitExpression(out, expr.operand, ctx);
          out.push(Op.I32_SUB);
          return "int";
        }
      } else if (expr.operator === "!") {
        const ot = emitExpression(out, expr.operand, ctx);
        if (ot === "long") {
          out.push(Op.I64_EQZ);
        } else {
          out.push(Op.I32_EQZ);
        }
        return "int";
      }
      return "int";
    case "CastExpression": {
      const srcType = emitExpression(out, expr.operand, ctx);
      const targetType = expr.targetType as CType;
      emitConversion(out, srcType, targetType);
      return targetType;
    }
    case "Identifier":
      // Array name decays to pointer (base address)
      if (ctx.arrayVars.has(expr.name)) {
        const arrInfo = ctx.arrayVars.get(expr.name)!;
        out.push(Op.I32_CONST, ...encodeSignedLEB128(arrInfo.addr));
        return "int";
      }
      return emitVarGet(out, expr.name, ctx);
    case "AssignmentExpression": {
      const varType = getVarType(expr.name, ctx);
      if (ctx.memVars.has(expr.name)) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(ctx.memVars.get(expr.name)!));
        const exprType = emitExpression(out, expr.value, ctx);
        emitConversion(out, exprType, varType);
        emitMemStore(out, varType);
      } else {
        const exprType = emitExpression(out, expr.value, ctx);
        emitConversion(out, exprType, varType);
        emitVarSet(out, expr.name, ctx);
      }
      return "void";
    }
    case "CompoundAssignmentExpression": {
      const varType = getVarType(expr.name, ctx);
      const isLong = varType === "long";
      const opMap = isLong ? COMPOUND_OP_MAP_I64 : COMPOUND_OP_MAP;

      if (ctx.memVars.has(expr.name)) {
        const addr = ctx.memVars.get(expr.name)!;
        out.push(Op.I32_CONST, ...encodeSignedLEB128(addr)); // addr for store
        out.push(Op.I32_CONST, ...encodeSignedLEB128(addr)); // addr for load
        emitMemLoad(out, varType);
        const exprType = emitExpression(out, expr.value, ctx);
        emitConversion(out, exprType, varType);
        out.push(opMap[expr.operator]);
        emitMemStore(out, varType);
      } else {
        emitVarGet(out, expr.name, ctx);
        const exprType = emitExpression(out, expr.value, ctx);
        emitConversion(out, exprType, varType);
        out.push(opMap[expr.operator]);
        emitVarSet(out, expr.name, ctx);
      }
      return "void";
    }
    case "CallExpression": {
      const fIdx = ctx.funcIndex.get(expr.callee);
      if (fIdx === undefined) throw new Error(`Unknown function '${expr.callee}'`);
      const paramTypes = ctx.funcParamTypes.get(expr.callee);
      for (let i = 0; i < expr.args.length; i++) {
        const argType = emitExpression(out, expr.args[i], ctx);
        if (paramTypes && i < paramTypes.length) {
          emitConversion(out, argType, paramTypes[i]);
        }
      }
      out.push(Op.CALL, ...encodeUnsignedLEB128(fIdx));
      return ctx.funcReturnTypes.get(expr.callee) || "int";
    }
    case "AddressOfExpression": {
      const addr = ctx.memVars.get(expr.name);
      if (addr === undefined) throw new Error(`Cannot take address of '${expr.name}'`);
      out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
      return "int";
    }
    case "DereferenceExpression":
      emitExpression(out, expr.operand, ctx);
      out.push(Op.I32_LOAD, 0x02, 0x00);
      return "int";
    case "DereferenceAssignment":
      emitExpression(out, expr.pointer, ctx);
      emitExpression(out, expr.value, ctx);
      out.push(Op.I32_STORE, 0x02, 0x00);
      return "void";
    case "LogicalExpression":
      if (expr.operator === "&&") {
        const lt = emitExpression(out, expr.left, ctx);
        if (lt === "long") { out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0)); out.push(Op.I64_NE); }
        out.push(Op.IF, BLOCK_I32);
        const rt = emitExpression(out, expr.right, ctx);
        if (rt === "long") { out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0)); out.push(Op.I64_NE); }
        out.push(Op.I32_EQZ, Op.I32_EQZ);
        out.push(Op.ELSE);
        out.push(Op.I32_CONST, ...encodeSignedLEB128(0));
        out.push(Op.END);
      } else {
        const lt = emitExpression(out, expr.left, ctx);
        if (lt === "long") { out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0)); out.push(Op.I64_NE); }
        out.push(Op.IF, BLOCK_I32);
        out.push(Op.I32_CONST, ...encodeSignedLEB128(1));
        out.push(Op.ELSE);
        const rt = emitExpression(out, expr.right, ctx);
        if (rt === "long") { out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0)); out.push(Op.I64_NE); }
        out.push(Op.I32_EQZ, Op.I32_EQZ);
        out.push(Op.END);
      }
      return "int";
    case "TernaryExpression": {
      const resultType = inferType(expr, ctx);
      const condType = emitExpression(out, expr.condition, ctx);
      if (condType === "long") { out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0)); out.push(Op.I64_NE); }
      out.push(Op.IF, blockTypeFor(resultType));
      const ct = emitExpression(out, expr.consequent, ctx);
      emitConversion(out, ct, resultType);
      out.push(Op.ELSE);
      const at = emitExpression(out, expr.alternate, ctx);
      emitConversion(out, at, resultType);
      out.push(Op.END);
      return resultType;
    }
    case "ArrayAccessExpression": {
      const arrInfo = ctx.arrayVars.get(expr.array);
      if (arrInfo) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(arrInfo.addr));
      } else {
        emitVarGet(out, expr.array, ctx);
      }
      emitExpression(out, expr.index, ctx);
      out.push(Op.I32_CONST, ...encodeSignedLEB128(4));
      out.push(Op.I32_MUL);
      out.push(Op.I32_ADD);
      out.push(Op.I32_LOAD, 0x02, 0x00);
      return "int";
    }
    case "ArrayIndexAssignment": {
      const arrInfo = ctx.arrayVars.get(expr.array);
      if (arrInfo) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(arrInfo.addr));
      } else {
        emitVarGet(out, expr.array, ctx);
      }
      emitExpression(out, expr.index, ctx);
      out.push(Op.I32_CONST, ...encodeSignedLEB128(4));
      out.push(Op.I32_MUL);
      out.push(Op.I32_ADD);
      emitExpression(out, expr.value, ctx);
      out.push(Op.I32_STORE, 0x02, 0x00);
      return "void";
    }
    case "UpdateExpression": {
      const varName = expr.name;
      const varType = getVarType(varName, ctx);
      const isLong = varType === "long";
      const addOp = isLong
        ? (expr.operator === "++" ? Op.I64_ADD : Op.I64_SUB)
        : (expr.operator === "++" ? Op.I32_ADD : Op.I32_SUB);

      if (ctx.memVars.has(varName)) {
        const addr = ctx.memVars.get(varName)!;
        if (expr.prefix) {
          out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
          out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
          emitMemLoad(out, varType);
          if (isLong) {
            out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(1));
          } else {
            out.push(Op.I32_CONST, ...encodeSignedLEB128(1));
          }
          out.push(addOp);
          emitMemStore(out, varType);
          out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
          emitMemLoad(out, varType);
        } else {
          out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
          emitMemLoad(out, varType);
          out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
          out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
          emitMemLoad(out, varType);
          if (isLong) {
            out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(1));
          } else {
            out.push(Op.I32_CONST, ...encodeSignedLEB128(1));
          }
          out.push(addOp);
          emitMemStore(out, varType);
        }
      } else if (ctx.locals.has(varName)) {
        const idx = ctx.locals.get(varName)!;
        if (expr.prefix) {
          out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(idx));
          if (isLong) {
            out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(1));
          } else {
            out.push(Op.I32_CONST, ...encodeSignedLEB128(1));
          }
          out.push(addOp);
          out.push(Op.LOCAL_TEE, ...encodeUnsignedLEB128(idx));
        } else {
          out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(idx));
          out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(idx));
          if (isLong) {
            out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(1));
          } else {
            out.push(Op.I32_CONST, ...encodeSignedLEB128(1));
          }
          out.push(addOp);
          out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
        }
      } else if (ctx.globalIndex.has(varName)) {
        const gIdx = ctx.globalIndex.get(varName)!;
        if (expr.prefix) {
          emitVarGet(out, varName, ctx);
          if (isLong) {
            out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(1));
          } else {
            out.push(Op.I32_CONST, ...encodeSignedLEB128(1));
          }
          out.push(addOp);
          out.push(Op.GLOBAL_SET, ...encodeUnsignedLEB128(gIdx));
          out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(gIdx));
        } else {
          out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(gIdx));
          out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(gIdx));
          if (isLong) {
            out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(1));
          } else {
            out.push(Op.I32_CONST, ...encodeSignedLEB128(1));
          }
          out.push(addOp);
          out.push(Op.GLOBAL_SET, ...encodeUnsignedLEB128(gIdx));
        }
      } else {
        throw new Error(`Unknown variable '${varName}'`);
      }
      return varType;
    }
  }
}
