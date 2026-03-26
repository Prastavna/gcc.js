import type { Program, FunctionDeclaration, ExternFunctionDeclaration, GlobalVariableDeclaration, StructDeclaration, UnionDeclaration, Statement, Expression, TypeSpecifier } from "./types.ts";
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
  BLOCK_F32,
  BLOCK_F64,
  encodeUnsignedLEB128,
  encodeSignedLEB128,
  encodeSignedLEB128_i64,
  encodeF32,
  encodeF64,
  encodeName,
  makeSection,
} from "./wasm.ts";

// ── C type helpers ──────────────────────────────────────────

type CType = "char" | "short" | "int" | "long" | "void" | "uchar" | "ushort" | "uint" | "float" | "double";

function isUnsigned(ctype: CType): boolean {
  return ctype === "uchar" || ctype === "ushort" || ctype === "uint";
}

function wasmTypeFor(ctype: CType): number {
  if (ctype === "long") return ValType.I64;
  if (ctype === "float") return ValType.F32;
  if (ctype === "double") return ValType.F64;
  return ValType.I32;
}

function blockTypeFor(ctype: CType): number {
  if (ctype === "long") return BLOCK_I64;
  if (ctype === "float") return BLOCK_F32;
  if (ctype === "double") return BLOCK_F64;
  return BLOCK_I32;
}

function sizeOfType(ctype: CType): number {
  switch (ctype) {
    case "char": case "uchar": return 1;
    case "short": case "ushort": return 2;
    case "int": case "uint": case "float": return 4;
    case "long": case "double": return 8;
    case "void": return 0;
  }
}

function isFP(ctype: CType): boolean {
  return ctype === "float" || ctype === "double";
}

/** Promote: char < int < long < float < double. Unsigned wins if both int types. */
function promoteTypes(a: CType, b: CType): CType {
  if (a === "double" || b === "double") return "double";
  if (a === "float" || b === "float") return "float";
  if (a === "long" || b === "long") return "long";
  if (isUnsigned(a) || isUnsigned(b)) return "uint";
  return "int"; // char promotes to int
}

function emitConversion(out: number[], from: CType, to: CType): void {
  const fromW = wasmTypeFor(from);
  const toW = wasmTypeFor(to);
  if (fromW === toW) return;
  // i32 → others
  if (fromW === ValType.I32 && toW === ValType.I64) { out.push(Op.I64_EXTEND_I32_S); return; }
  if (fromW === ValType.I32 && toW === ValType.F32) { out.push(Op.F32_CONVERT_I32_S); return; }
  if (fromW === ValType.I32 && toW === ValType.F64) { out.push(Op.F64_CONVERT_I32_S); return; }
  // i64 → others
  if (fromW === ValType.I64 && toW === ValType.I32) { out.push(Op.I32_WRAP_I64); return; }
  if (fromW === ValType.I64 && toW === ValType.F32) { out.push(Op.F32_CONVERT_I64_S); return; }
  if (fromW === ValType.I64 && toW === ValType.F64) { out.push(Op.F64_CONVERT_I64_S); return; }
  // f32 → others
  if (fromW === ValType.F32 && toW === ValType.I32) { out.push(Op.I32_TRUNC_F32_S); return; }
  if (fromW === ValType.F32 && toW === ValType.I64) { out.push(Op.I64_TRUNC_F32_S); return; }
  if (fromW === ValType.F32 && toW === ValType.F64) { out.push(Op.F64_PROMOTE_F32); return; }
  // f64 → others
  if (fromW === ValType.F64 && toW === ValType.I32) { out.push(Op.I32_TRUNC_F64_S); return; }
  if (fromW === ValType.F64 && toW === ValType.I64) { out.push(Op.I64_TRUNC_F64_S); return; }
  if (fromW === ValType.F64 && toW === ValType.F32) { out.push(Op.F32_DEMOTE_F64); return; }
}

// ── Struct layout types ──────────────────────────────────

type StructFieldInfo = { name: string; ctype: CType; offset: number };
type StructDef = { name: string; fields: StructFieldInfo[]; size: number };

function typeSpecToCType(ts: TypeSpecifier): CType {
  if (ts === "unsigned int") return "uint";
  if (ts === "unsigned char") return "uchar";
  if (ts === "unsigned short") return "ushort";
  if (typeof ts === "string") return ts as CType;
  // struct/union type specifier used as pointer type → i32
  return "int";
}

function computeStructLayout(decl: StructDeclaration): StructDef {
  let offset = 0;
  const fields: StructFieldInfo[] = [];
  for (const f of decl.fields) {
    const ctype = typeSpecToCType(f.typeSpec);
    const size = sizeOfType(ctype);
    // Natural alignment
    while (offset % size !== 0) offset++;
    fields.push({ name: f.name, ctype, offset });
    offset += size;
  }
  // Align total size to largest field alignment
  const maxAlign = Math.max(...fields.map(f => sizeOfType(f.ctype)), 1);
  while (offset % maxAlign !== 0) offset++;
  return { name: decl.name, fields, size: offset };
}

function computeUnionLayout(decl: UnionDeclaration): StructDef {
  const fields: StructFieldInfo[] = [];
  let maxSize = 0;
  for (const f of decl.fields) {
    const ctype = typeSpecToCType(f.typeSpec);
    const size = sizeOfType(ctype);
    fields.push({ name: f.name, ctype, offset: 0 }); // all at offset 0
    maxSize = Math.max(maxSize, size);
  }
  return { name: decl.name, fields, size: maxSize };
}

// ── Module-level state (reset per generate() call) ───────

let memoryUsed = false;
let nextMemAddr = 0;
let stringData: { addr: number; bytes: number[] }[] = [];
let structDefs: Map<string, StructDef> = new Map();
let mallocUsed = false;
let heapPtrGlobalIdx = 0;

/**
 * Generates a WASM binary module from a Program AST.
 */
export function generate(ast: Program): Uint8Array {
  memoryUsed = false;
  nextMemAddr = 0;
  stringData = [];
  structDefs = new Map();
  mallocUsed = false;

  // Separate declarations by kind
  const externs: ExternFunctionDeclaration[] = [];
  const funcs: FunctionDeclaration[] = [];
  const globals: GlobalVariableDeclaration[] = [];
  const structs: StructDeclaration[] = [];
  const unions: UnionDeclaration[] = [];
  for (const d of ast.declarations) {
    if (d.type === "ExternFunctionDeclaration") externs.push(d);
    else if (d.type === "FunctionDeclaration") funcs.push(d);
    else if (d.type === "GlobalVariableDeclaration") globals.push(d);
    else if (d.type === "StructDeclaration") structs.push(d);
    else if (d.type === "UnionDeclaration") unions.push(d);
    // EnumDeclaration — no codegen needed (constants resolved at parse time)
  }

  // Build struct layout registry
  for (const s of structs) {
    structDefs.set(s.name, computeStructLayout(s));
  }

  // Build union layout registry (all fields at offset 0, size = max field size)
  for (const u of unions) {
    structDefs.set(u.name, computeUnionLayout(u));
  }

  // Build global variable name -> WASM global index map + types
  const globalIndex = new Map<string, number>();
  const globalTypes = new Map<string, CType>();
  for (let i = 0; i < globals.length; i++) {
    globalIndex.set(globals[i].name, i);
    globalTypes.set(globals[i].name, typeSpecToCType(globals[i].typeSpec));
  }

  // Build function return type + param type maps
  const funcReturnTypes = new Map<string, CType>();
  const funcParamTypes = new Map<string, CType[]>();
  // Maps funcName -> paramIndex -> structName for struct params
  const funcStructParams = new Map<string, Map<number, string>>();
  for (const ext of externs) {
    funcReturnTypes.set(ext.name, typeSpecToCType(ext.returnType || "int"));
    funcParamTypes.set(ext.name, ext.params.map(p => typeSpecToCType(p.typeSpec || "int")));
  }
  for (const func of funcs) {
    funcReturnTypes.set(func.name, typeSpecToCType(func.returnType || "int"));
    const paramCTypes: CType[] = [];
    const structParams = new Map<number, string>();
    for (let i = 0; i < func.params.length; i++) {
      const ts = func.params[i].typeSpec;
      if (typeof ts === "object" && ts.kind === "struct" && !func.params[i].pointer) {
        // struct value param: passed as i32 pointer (caller copies)
        paramCTypes.push("int");
        structParams.set(i, ts.name);
      } else {
        paramCTypes.push(typeSpecToCType(ts || "int"));
      }
    }
    funcParamTypes.set(func.name, paramCTypes);
    if (structParams.size > 0) funcStructParams.set(func.name, structParams);
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
    const paramTypes = ext.params.map(p => wasmTypeFor(typeSpecToCType(p.typeSpec || "int")));
    const retType = wasmTypeFor(typeSpecToCType(ext.returnType || "int"));
    importTypeIndices.push(getTypeIdx(paramTypes, retType));
  }

  // Type indices for local functions
  const funcTypeIndices: number[] = [];
  for (const func of funcs) {
    const paramTypes = func.params.map(p => wasmTypeFor(typeSpecToCType(p.typeSpec || "int")));
    const retType = wasmTypeFor(typeSpecToCType(func.returnType || "int"));
    funcTypeIndices.push(getTypeIdx(paramTypes, retType));
  }

  // Detect if memory is needed
  if (stringData.length > 0) memoryUsed = true;
  for (const func of funcs) {
    if (functionUsesMemory(func)) { memoryUsed = true; break; }
  }

  // Heap pointer global index is after user globals
  heapPtrGlobalIdx = globals.length;

  // Build code section FIRST — it finalizes nextMemAddr and mallocUsed
  const codeSection = buildCodeSection(funcs, funcIndex, stringMap, globalIndex, globalTypes, funcReturnTypes, funcParamTypes, funcStructParams);

  // If malloc was used, we need memory and the heap pointer global
  if (mallocUsed) memoryUsed = true;

  // Build remaining sections (WASM section ordering: 1,2,3,5,6,7,10,11)
  const typeSection = buildTypeSection(typeSigs);
  const importSection = externs.length > 0 ? buildImportSection(externs, importTypeIndices) : [];
  const funcSection = buildFunctionSection(funcTypeIndices);
  const memorySection = memoryUsed ? buildMemorySection() : [];
  const globalSection = (globals.length > 0 || mallocUsed) ? buildGlobalSectionWithHeap(globals, mallocUsed, nextMemAddr) : [];
  const exportSection = buildExportSection(funcs, importCount);
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
    case "StructVariableDeclaration": break;
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
    case "DoWhileStatement":
      collectStringsFromExpr(stmt.condition, cb);
      collectStringsFromStatements(stmt.body, cb);
      break;
    case "BreakStatement": break;
    case "ContinueStatement": break;
    case "GotoStatement": break;
    case "LabeledStatement":
      collectStringsFromStatement(stmt.body, cb);
      break;
    case "SwitchStatement":
      collectStringsFromExpr(stmt.discriminant, cb);
      for (const c of stmt.cases) collectStringsFromStatements(c.body, cb);
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
    case "MemberAssignmentExpression": collectStringsFromExpr(expr.value, cb); break;
    case "ArrowAssignmentExpression": collectStringsFromExpr(expr.value, cb); break;
    case "CommaExpression": expr.expressions.forEach(e => collectStringsFromExpr(e, cb)); break;
    default: break;
  }
}

// ── Memory usage detection ───────────────────────────────

function functionUsesMemory(func: FunctionDeclaration): boolean {
  // Struct params use memory
  for (const p of func.params) {
    if (typeof p.typeSpec === "object" && p.typeSpec.kind === "struct") return true;
  }
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
    case "StructVariableDeclaration": return true;
    case "ExpressionStatement": return exprUsesMemory(stmt.expression);
    case "IfStatement":
      return exprUsesMemory(stmt.condition) || statementsUseMemory(stmt.consequent) ||
        (stmt.alternate ? statementsUseMemory(stmt.alternate) : false);
    case "WhileStatement": return exprUsesMemory(stmt.condition) || statementsUseMemory(stmt.body);
    case "DoWhileStatement": return exprUsesMemory(stmt.condition) || statementsUseMemory(stmt.body);
    case "ForStatement":
      return stmtUsesMemory(stmt.init) || exprUsesMemory(stmt.condition) ||
        exprUsesMemory(stmt.update) || statementsUseMemory(stmt.body);
    case "BreakStatement": return false;
    case "ContinueStatement": return false;
    case "GotoStatement": return false;
    case "LabeledStatement": return stmtUsesMemory(stmt.body);
    case "SwitchStatement":
      return exprUsesMemory(stmt.discriminant) || stmt.cases.some(c => statementsUseMemory(c.body));
  }
}

function exprUsesMemory(expr: Expression): boolean {
  switch (expr.type) {
    case "AddressOfExpression": case "DereferenceExpression": case "DereferenceAssignment": case "StringLiteral":
    case "ArrayAccessExpression": case "ArrayIndexAssignment":
    case "MemberAccessExpression": case "MemberAssignmentExpression":
    case "ArrowAccessExpression": case "ArrowAssignmentExpression": return true;
    case "BinaryExpression": return exprUsesMemory(expr.left) || exprUsesMemory(expr.right);
    case "UnaryExpression": return exprUsesMemory(expr.operand);
    case "AssignmentExpression": return exprUsesMemory(expr.value);
    case "CompoundAssignmentExpression": return exprUsesMemory(expr.value);
    case "CallExpression": return expr.callee === "malloc" || expr.callee === "free" || expr.args.some(exprUsesMemory);
    case "LogicalExpression": return exprUsesMemory(expr.left) || exprUsesMemory(expr.right);
    case "TernaryExpression": return exprUsesMemory(expr.condition) || exprUsesMemory(expr.consequent) || exprUsesMemory(expr.alternate);
    case "CastExpression": return exprUsesMemory(expr.operand);
    case "CommaExpression": return expr.expressions.some(exprUsesMemory);
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
    case "FloatingLiteral":
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
      if (expr.operator === "~") {
        const v = evalConstExpr(expr.operand);
        return v !== null ? ~v : null;
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
        case "&": return (l & r) | 0;
        case "|": return (l | r) | 0;
        case "^": return (l ^ r) | 0;
        case "<<": return (l << r) | 0;
        case ">>": return (l >> r) | 0;
        default: return null;
      }
    }
    case "SizeofExpression":
      if (typeof expr.targetType === "object" && (expr.targetType.kind === "struct" || expr.targetType.kind === "union")) {
        const def = structDefs.get(expr.targetType.name);
        return def ? def.size : null;
      }
      return sizeOfType(typeSpecToCType(expr.targetType));
    default:
      return null;
  }
}

/**
 * Global section: declares mutable globals with constant initializers.
 * Optionally appends a heap pointer global for malloc support.
 */
function buildGlobalSectionWithHeap(globals: GlobalVariableDeclaration[], includHeapPtr: boolean, heapStart: number): number[] {
  const count = globals.length + (includHeapPtr ? 1 : 0);
  const content: number[] = [...encodeUnsignedLEB128(count)];
  for (const g of globals) {
    const ctype = typeSpecToCType(g.typeSpec || "int");
    const wt = wasmTypeFor(ctype);
    content.push(wt, g.isConst ? 0x00 : 0x01); // 0x00 = immutable, 0x01 = mutable
    const val = evalConstExpr(g.initializer);
    if (ctype === "long") {
      content.push(Op.I64_CONST, ...encodeSignedLEB128_i64(val ?? 0), Op.END);
    } else if (ctype === "float") {
      content.push(Op.F32_CONST, ...encodeF32(val ?? 0), Op.END);
    } else if (ctype === "double") {
      content.push(Op.F64_CONST, ...encodeF64(val ?? 0), Op.END);
    } else {
      content.push(Op.I32_CONST, ...encodeSignedLEB128(val ?? 0), Op.END);
    }
  }
  if (includHeapPtr) {
    // Heap pointer: mutable i32, initialized to first free address after static data
    // Align heap start to 8 bytes, ensure non-zero so first malloc != NULL
    const alignedStart = Math.max((heapStart + 7) & ~7, 8);
    content.push(ValType.I32, 0x01); // mutable i32
    content.push(Op.I32_CONST, ...encodeSignedLEB128(alignedStart), Op.END);
  }
  return makeSection(Section.GLOBAL, content);
}

function buildExportSection(funcs: FunctionDeclaration[], importCount: number): number[] {
  const entries: number[] = [];
  let exportCount = 0;
  for (let i = 0; i < funcs.length; i++) {
    if (funcs[i].isStatic) continue;
    exportCount++;
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
  funcStructParams: Map<string, Map<number, string>>,
): number[] {
  const bodies: number[] = [];
  for (const func of funcs) {
    bodies.push(...buildFunctionBody(func, funcIndex, stringMap, globalIndex, globalTypes, funcReturnTypes, funcParamTypes, funcStructParams));
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
    case "StructVariableDeclaration": break;
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
    case "DoWhileStatement":
      findATInExpr(stmt.condition, taken);
      findATInStatements(stmt.body, taken);
      break;
    case "ForStatement":
      findATInStatement(stmt.init, taken);
      findATInExpr(stmt.condition, taken);
      findATInExpr(stmt.update, taken);
      findATInStatements(stmt.body, taken);
      break;
    case "BreakStatement": break;
    case "ContinueStatement": break;
    case "GotoStatement": break;
    case "LabeledStatement":
      findATInStatement(stmt.body, taken);
      break;
    case "SwitchStatement":
      findATInExpr(stmt.discriminant, taken);
      for (const c of stmt.cases) findATInStatements(c.body, taken);
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
    case "MemberAssignmentExpression": findATInExpr(expr.value, taken); break;
    case "ArrowAssignmentExpression": findATInExpr(expr.value, taken); break;
    case "CommaExpression": expr.expressions.forEach(e => findATInExpr(e, taken)); break;
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
  structVars: Map<string, { addr: number; structName: string }>;
  structParamVars: Map<string, { localIdx: number; structName: string }>;
  funcIndex: Map<string, number>;
  stringMap: Map<string, number>;
  globalIndex: Map<string, number>;
  globalTypes: Map<string, CType>;
  funcReturnTypes: Map<string, CType>;
  funcParamTypes: Map<string, CType[]>;
  funcStructParams: Map<string, Map<number, string>>;
  varStructPtrTypes: Map<string, string>; // var name -> struct name for pointer-to-struct vars
  varPtrTypes: Map<string, CType>; // var name -> pointed-to element type for primitive pointer vars
  breakDepth: number | null;  // BR depth for break (null = not in a loop/switch)
  continueDepth: number | null; // BR depth for continue (null = not in a loop)
  switchTmpIdx: number | null; // local index for switch temp variable
  returnType: CType;
  gotoStateIdx: number | null; // local index for goto state variable (null = no goto)
  gotoLabels: Map<string, number>; // label name -> section index
  gotoDispatchDepth: number | null; // BR depth to reach the dispatch loop
};


function collectAllVarNames(stmts: Statement[], names: Set<string>): void {
  for (const s of stmts) {
    if (s.type === "VariableDeclaration") names.add(s.name);
    if (s.type === "StructVariableDeclaration") names.add(s.name);
    if (s.type === "IfStatement") { collectAllVarNames(s.consequent, names); if (s.alternate) collectAllVarNames(s.alternate, names); }
    if (s.type === "WhileStatement") collectAllVarNames(s.body, names);
    if (s.type === "DoWhileStatement") collectAllVarNames(s.body, names);
    if (s.type === "ForStatement") { collectAllVarNames([s.init], names); collectAllVarNames(s.body, names); }
    if (s.type === "SwitchStatement") { for (const c of s.cases) collectAllVarNames(c.body, names); }
    if (s.type === "LabeledStatement") collectAllVarNames([s.body], names);
  }
}

/** Collect type specs for all variable declarations */
function collectVarTypes(stmts: Statement[], types: Map<string, CType>): void {
  for (const s of stmts) {
    if (s.type === "VariableDeclaration") types.set(s.name, typeSpecToCType(s.typeSpec || "int"));
    if (s.type === "IfStatement") { collectVarTypes(s.consequent, types); if (s.alternate) collectVarTypes(s.alternate, types); }
    if (s.type === "WhileStatement") collectVarTypes(s.body, types);
    if (s.type === "DoWhileStatement") collectVarTypes(s.body, types);
    if (s.type === "ForStatement") { collectVarTypes([s.init], types); collectVarTypes(s.body, types); }
    if (s.type === "SwitchStatement") { for (const c of s.cases) collectVarTypes(c.body, types); }
    if (s.type === "LabeledStatement") collectVarTypes([s.body], types);
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
  funcStructParams: Map<string, Map<number, string>>,
): number[] {
  const addressTaken = findAddressTakenVars(func);
  const locals = new Map<string, number>();
  const localTypes = new Map<string, CType>();

  // Params: WASM requires all params declared upfront with their types.
  // We need i32 params first, then i64 params — but actually WASM params
  // maintain declaration order. The key insight: params are indexed by
  // their declaration order, and their types are fixed by the function signature.
  for (let i = 0; i < func.params.length; i++) {
    const ptype = typeSpecToCType(func.params[i].typeSpec || "int");
    if (!addressTaken.has(func.params[i].name)) {
      locals.set(func.params[i].name, i);
      localTypes.set(func.params[i].name, ptype);
    }
  }

  const paramLocalCount = func.params.length;

  // Collect all non-AT variable declarations with their types
  // Assign indices: i32 locals first, then i64 locals
  const allDeclaredVars: { name: string; ctype: CType }[] = [];
  function collectDeclaredVars(stmts: Statement[]): void {
    for (const stmt of stmts) {
      if (stmt.type === "VariableDeclaration" && !addressTaken.has(stmt.name)) {
        if (!allDeclaredVars.find(v => v.name === stmt.name)) {
          const ctype = typeSpecToCType(stmt.typeSpec || "int");
          allDeclaredVars.push({ name: stmt.name, ctype });
        }
      }
      if (stmt.type === "IfStatement") { collectDeclaredVars(stmt.consequent); if (stmt.alternate) collectDeclaredVars(stmt.alternate); }
      else if (stmt.type === "WhileStatement") collectDeclaredVars(stmt.body);
      else if (stmt.type === "DoWhileStatement") collectDeclaredVars(stmt.body);
      else if (stmt.type === "ForStatement") { collectDeclaredVars([stmt.init]); collectDeclaredVars(stmt.body); }
      else if (stmt.type === "SwitchStatement") { for (const c of stmt.cases) collectDeclaredVars(c.body); }
      else if (stmt.type === "LabeledStatement") collectDeclaredVars([stmt.body]);
    }
  }
  collectDeclaredVars(func.body);

  // Detect if function body contains switch statements (need temp local)
  function hasSwitchStmt(stmts: Statement[]): boolean {
    for (const s of stmts) {
      if (s.type === "SwitchStatement") return true;
      if (s.type === "IfStatement" && (hasSwitchStmt(s.consequent) || (s.alternate && hasSwitchStmt(s.alternate)))) return true;
      if (s.type === "WhileStatement" && hasSwitchStmt(s.body)) return true;
      if (s.type === "DoWhileStatement" && hasSwitchStmt(s.body)) return true;
      if (s.type === "ForStatement" && hasSwitchStmt(s.body)) return true;
      if (s.type === "LabeledStatement" && hasSwitchStmt([s.body])) return true;
    }
    return false;
  }
  const needsSwitchTmp = hasSwitchStmt(func.body);

  // Partition locals by WASM type: i32, i64, f32, f64
  const i32Locals = allDeclaredVars.filter(v => wasmTypeFor(v.ctype) === ValType.I32);
  const i64Locals = allDeclaredVars.filter(v => wasmTypeFor(v.ctype) === ValType.I64);
  const f32Locals = allDeclaredVars.filter(v => wasmTypeFor(v.ctype) === ValType.F32);
  const f64Locals = allDeclaredVars.filter(v => wasmTypeFor(v.ctype) === ValType.F64);

  // Assign indices: params first (in order), then i32, i64, f32, f64 locals
  let nextIdx = paramLocalCount;
  for (const v of i32Locals) {
    locals.set(v.name, nextIdx++);
    localTypes.set(v.name, v.ctype);
  }
  for (const v of i64Locals) {
    locals.set(v.name, nextIdx++);
    localTypes.set(v.name, v.ctype);
  }
  for (const v of f32Locals) {
    locals.set(v.name, nextIdx++);
    localTypes.set(v.name, v.ctype);
  }
  for (const v of f64Locals) {
    locals.set(v.name, nextIdx++);
    localTypes.set(v.name, v.ctype);
  }

  // Add switch temp local (i32) if needed
  const switchTmpIdx = needsSwitchTmp ? nextIdx++ : null;
  if (needsSwitchTmp) i32Locals.push({ name: "__switch_tmp", ctype: "int" });

  const memVars = new Map<string, number>();
  const memVarTypes = new Map<string, CType>();
  const atParamCopies: { paramIdx: number; memAddr: number; ctype: CType }[] = [];

  // Collect all var types for AT vars
  const allVarTypeMap = new Map<string, CType>();
  collectVarTypes(func.body, allVarTypeMap);

  for (let i = 0; i < func.params.length; i++) {
    if (addressTaken.has(func.params[i].name)) {
      const ptype = typeSpecToCType(func.params[i].typeSpec || "int");
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
      if (s.type === "DoWhileStatement") collectArrayDecls(s.body);
      if (s.type === "ForStatement") { collectArrayDecls([s.init]); collectArrayDecls(s.body); }
      if (s.type === "SwitchStatement") { for (const c of s.cases) collectArrayDecls(c.body); }
      if (s.type === "LabeledStatement") collectArrayDecls([s.body]);
    }
  }
  collectArrayDecls(func.body);

  // Allocate struct variables in linear memory
  const structVars = new Map<string, { addr: number; structName: string }>();
  function collectStructDecls(stmts: Statement[]): void {
    for (const s of stmts) {
      if (s.type === "StructVariableDeclaration" && !structVars.has(s.name)) {
        const def = structDefs.get(s.structName);
        if (!def) throw new Error(`Unknown struct type '${s.structName}'`);
        // Align to struct's natural alignment
        const maxAlign = Math.max(...def.fields.map(f => sizeOfType(f.ctype)), 1);
        while (nextMemAddr % maxAlign !== 0) nextMemAddr++;
        structVars.set(s.name, { addr: nextMemAddr, structName: s.structName });
        nextMemAddr += def.size;
      }
      if (s.type === "IfStatement") { collectStructDecls(s.consequent); if (s.alternate) collectStructDecls(s.alternate); }
      if (s.type === "WhileStatement") collectStructDecls(s.body);
      if (s.type === "DoWhileStatement") collectStructDecls(s.body);
      if (s.type === "ForStatement") { collectStructDecls([s.init]); collectStructDecls(s.body); }
      if (s.type === "SwitchStatement") { for (const c of s.cases) collectStructDecls(c.body); }
      if (s.type === "LabeledStatement") collectStructDecls([s.body]);
    }
  }
  collectStructDecls(func.body);

  // Track pointer-to-struct variable types for arrow operator
  const varStructPtrTypes = new Map<string, string>();

  // Track struct params (passed as i32 pointers)
  const structParamVars = new Map<string, { localIdx: number; structName: string }>();
  for (let i = 0; i < func.params.length; i++) {
    const ts = func.params[i].typeSpec;
    if (typeof ts === "object" && ts.kind === "struct" && !func.params[i].pointer) {
      // Struct value param: local contains pointer to copied struct
      structParamVars.set(func.params[i].name, { localIdx: i, structName: ts.name });
    } else if (typeof ts === "object" && ts.kind === "struct" && func.params[i].pointer) {
      // Pointer-to-struct param: track for arrow access
      varStructPtrTypes.set(func.params[i].name, ts.name);
    }
  }
  function collectStructPtrTypes(stmts: Statement[]): void {
    for (const s of stmts) {
      if (s.type === "VariableDeclaration" && typeof s.typeSpec === "object" && s.typeSpec.kind === "struct") {
        varStructPtrTypes.set(s.name, s.typeSpec.name);
      }
      if (s.type === "IfStatement") { collectStructPtrTypes(s.consequent); if (s.alternate) collectStructPtrTypes(s.alternate); }
      if (s.type === "WhileStatement") collectStructPtrTypes(s.body);
      if (s.type === "DoWhileStatement") collectStructPtrTypes(s.body);
      if (s.type === "ForStatement") { collectStructPtrTypes([s.init]); collectStructPtrTypes(s.body); }
      if (s.type === "SwitchStatement") { for (const c of s.cases) collectStructPtrTypes(c.body); }
      if (s.type === "LabeledStatement") collectStructPtrTypes([s.body]);
    }
  }
  collectStructPtrTypes(func.body);

  // Track primitive pointer variable types (int *p, char *p, long *p)
  const varPtrTypes = new Map<string, CType>();
  for (let i = 0; i < func.params.length; i++) {
    if (func.params[i].pointer && typeof func.params[i].typeSpec === "string") {
      varPtrTypes.set(func.params[i].name, func.params[i].typeSpec as CType);
    }
  }
  function collectPtrTypes(stmts: Statement[]): void {
    for (const s of stmts) {
      if (s.type === "VariableDeclaration" && s.pointer && typeof s.typeSpec === "string") {
        varPtrTypes.set(s.name, s.typeSpec as CType);
      }
      if (s.type === "IfStatement") { collectPtrTypes(s.consequent); if (s.alternate) collectPtrTypes(s.alternate); }
      if (s.type === "WhileStatement") collectPtrTypes(s.body);
      if (s.type === "DoWhileStatement") collectPtrTypes(s.body);
      if (s.type === "ForStatement") { collectPtrTypes([s.init]); collectPtrTypes(s.body); }
      if (s.type === "SwitchStatement") { for (const c of s.cases) collectPtrTypes(c.body); }
      if (s.type === "LabeledStatement") collectPtrTypes([s.body]);
    }
  }
  collectPtrTypes(func.body);

  const returnType = typeSpecToCType(func.returnType || "int");

  // Collect goto labels from the function body (top-level only for now)
  const gotoLabels = new Map<string, number>();
  function collectLabelsFromStmts(stmts: Statement[]): void {
    for (const s of stmts) {
      if (s.type === "LabeledStatement") {
        gotoLabels.set(s.label, gotoLabels.size);
        collectLabelsFromStmts([s.body]);
      }
      if (s.type === "IfStatement") { collectLabelsFromStmts(s.consequent); if (s.alternate) collectLabelsFromStmts(s.alternate); }
      if (s.type === "WhileStatement") collectLabelsFromStmts(s.body);
      if (s.type === "DoWhileStatement") collectLabelsFromStmts(s.body);
      if (s.type === "ForStatement") collectLabelsFromStmts(s.body);
      if (s.type === "SwitchStatement") { for (const c of s.cases) collectLabelsFromStmts(c.body); }
    }
  }
  collectLabelsFromStmts(func.body);

  // Detect if function uses goto
  function hasGotoStmt(stmts: Statement[]): boolean {
    for (const s of stmts) {
      if (s.type === "GotoStatement") return true;
      if (s.type === "IfStatement" && (hasGotoStmt(s.consequent) || (s.alternate && hasGotoStmt(s.alternate)))) return true;
      if (s.type === "WhileStatement" && hasGotoStmt(s.body)) return true;
      if (s.type === "DoWhileStatement" && hasGotoStmt(s.body)) return true;
      if (s.type === "ForStatement" && hasGotoStmt(s.body)) return true;
      if (s.type === "SwitchStatement" && s.cases.some(c => hasGotoStmt(c.body))) return true;
      if (s.type === "LabeledStatement" && hasGotoStmt([s.body])) return true;
    }
    return false;
  }
  const needsGoto = hasGotoStmt(func.body);
  let gotoStateIdx: number | null = null;
  if (needsGoto) {
    gotoStateIdx = nextIdx++;
    i32Locals.push({ name: "__goto_state", ctype: "int" });
  }

  const ctx: Ctx = { locals, localTypes, memVars, memVarTypes, arrayVars, structVars, structParamVars, funcIndex, stringMap, globalIndex, globalTypes, funcReturnTypes, funcParamTypes, funcStructParams, varStructPtrTypes, varPtrTypes, breakDepth: null, continueDepth: null, switchTmpIdx, returnType, gotoStateIdx, gotoLabels, gotoDispatchDepth: null };
  const instructions: number[] = [];

  for (const ap of atParamCopies) {
    instructions.push(Op.I32_CONST, ...encodeSignedLEB128(ap.memAddr));
    instructions.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(ap.paramIdx));
    emitMemStore(instructions, ap.ctype);
  }

  if (needsGoto) {
    // Emit goto state machine: split body into sections at label boundaries
    emitGotoStateMachine(instructions, func.body, ctx);
  } else {
    emitStatements(instructions, func.body, ctx);
  }

  // Build local declarations
  const localDeclBytes: number[] = [];
  const localGroups: [number, number][] = []; // [count, type]
  if (i32Locals.length > 0) localGroups.push([i32Locals.length, ValType.I32]);
  if (i64Locals.length > 0) localGroups.push([i64Locals.length, ValType.I64]);
  if (f32Locals.length > 0) localGroups.push([f32Locals.length, ValType.F32]);
  if (f64Locals.length > 0) localGroups.push([f64Locals.length, ValType.F64]);

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
  } else if (returnType === "float") {
    instructions.push(Op.F32_CONST, ...encodeF32(0));
  } else if (returnType === "double") {
    instructions.push(Op.F64_CONST, ...encodeF64(0));
  } else {
    instructions.push(Op.I32_CONST, ...encodeSignedLEB128(0));
  }
  const bodyContent = [...localDeclBytes, ...instructions, Op.END];
  return [...encodeUnsignedLEB128(bodyContent.length), ...bodyContent];
}

// ── Statement emission ───────────────────────────────────

// ── Goto state machine ───────────────────────────────────

function splitAtLabels(stmts: Statement[], labels: Map<string, number>): Statement[][] {
  const sections: Statement[][] = [[]];
  for (const s of stmts) {
    if (s.type === "LabeledStatement" && labels.has(s.label)) {
      sections.push([]);
      sections[sections.length - 1].push(s.body);
    } else {
      sections[sections.length - 1].push(s);
    }
  }
  return sections;
}

function emitGotoStateMachine(out: number[], stmts: Statement[], ctx: Ctx): void {
  const sections = splitAtLabels(stmts, ctx.gotoLabels);
  const numSections = sections.length;

  // loop $dispatch
  out.push(Op.LOOP, BLOCK_VOID);
  // block $exit
  out.push(Op.BLOCK, BLOCK_VOID);
  // block $secN-1 ... block $sec0 (innermost = section 0)
  for (let i = 0; i < numSections; i++) {
    out.push(Op.BLOCK, BLOCK_VOID);
  }

  // Dispatch: br_table based on state variable
  out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(ctx.gotoStateIdx!));
  out.push(Op.BR_TABLE);
  out.push(...encodeUnsignedLEB128(numSections)); // number of labels
  for (let i = 0; i < numSections; i++) {
    out.push(...encodeUnsignedLEB128(i)); // br to block $sec_i
  }
  out.push(...encodeUnsignedLEB128(numSections)); // default: br to $exit

  // Emit sections
  for (let secIdx = 0; secIdx < numSections; secIdx++) {
    out.push(Op.END); // end block $sec_i

    // Depth from here to $dispatch loop:
    // After closing $sec_i, active nesting is:
    //   loop > block($exit) > block($sec_{i+1}) > ... > block($sec_{numSections-1})
    // Remaining section blocks: numSections - secIdx - 1
    // Plus $exit block: 1
    // Loop is the br target: +0 (loop label index counted from 0)
    // Total: (numSections - secIdx - 1) + 1 = numSections - secIdx
    const dispatchDepth = numSections - secIdx;

    const oldDispatch = ctx.gotoDispatchDepth;
    ctx.gotoDispatchDepth = dispatchDepth;

    for (const s of sections[secIdx]) emitStatement(out, s, ctx);

    ctx.gotoDispatchDepth = oldDispatch;
  }

  out.push(Op.END); // end block $exit
  out.push(Op.END); // end loop $dispatch
}

// ── Statement emission ───────────────────────────────────

/** Convert a condition value to i32 (WASM control flow requires i32). */
function emitCondToI32(out: number[], condType: CType): void {
  if (condType === "long") {
    out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(0));
    out.push(Op.I64_NE);
  } else if (condType === "double") {
    out.push(Op.F64_CONST, ...encodeF64(0));
    out.push(Op.F64_NE);
  } else if (condType === "float") {
    out.push(Op.F32_CONST, ...encodeF32(0));
    out.push(Op.F32_NE);
  }
  // i32 types are already valid conditions
}

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
    case "StructVariableDeclaration":
      // Memory is pre-allocated; nothing to emit
      break;
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
      emitExpression(out, stmt.expression, ctx);
      if (exprProducesValue(stmt.expression)) {
        out.push(Op.DROP);
      }
      break;
    }
    case "IfStatement": {
      const condType = emitExpression(out, stmt.condition, ctx);
      emitCondToI32(out, condType);
      out.push(Op.IF, BLOCK_VOID);
      // IF adds one nesting level for break/continue depth
      const oldBreakIf = ctx.breakDepth;
      const oldContinueIf = ctx.continueDepth;
      const oldGotoIf = ctx.gotoDispatchDepth;
      if (ctx.breakDepth !== null) ctx.breakDepth++;
      if (ctx.continueDepth !== null) ctx.continueDepth++;
      if (ctx.gotoDispatchDepth !== null) ctx.gotoDispatchDepth++;
      for (const s of stmt.consequent) emitStatement(out, s, ctx);
      if (stmt.alternate) { out.push(Op.ELSE); for (const s of stmt.alternate) emitStatement(out, s, ctx); }
      ctx.breakDepth = oldBreakIf;
      ctx.continueDepth = oldContinueIf;
      ctx.gotoDispatchDepth = oldGotoIf;
      out.push(Op.END);
      break;
    }
    case "WhileStatement": {
      // BLOCK (break target) + LOOP (continue target)
      out.push(Op.BLOCK, BLOCK_VOID, Op.LOOP, BLOCK_VOID);
      const oldBreakW = ctx.breakDepth;
      const oldContinueW = ctx.continueDepth;
      const oldGotoW = ctx.gotoDispatchDepth;
      ctx.breakDepth = 1;     // BR 1 exits BLOCK
      ctx.continueDepth = 0;  // BR 0 goes to LOOP start
      if (ctx.gotoDispatchDepth !== null) ctx.gotoDispatchDepth += 2;
      const condType = emitExpression(out, stmt.condition, ctx);
      emitCondToI32(out, condType);
      out.push(Op.I32_EQZ, Op.BR_IF, ...encodeUnsignedLEB128(1));
      for (const s of stmt.body) emitStatement(out, s, ctx);
      ctx.breakDepth = oldBreakW;
      ctx.continueDepth = oldContinueW;
      ctx.gotoDispatchDepth = oldGotoW;
      out.push(Op.BR, ...encodeUnsignedLEB128(0), Op.END, Op.END);
      break;
    }
    case "DoWhileStatement": {
      // do { body } while (cond);
      // Structure: BLOCK(break) { LOOP { BLOCK(continue) { body } cond; br_if loop; } }
      // continue exits the inner BLOCK → falls through to condition check
      out.push(Op.BLOCK, BLOCK_VOID, Op.LOOP, BLOCK_VOID);
      out.push(Op.BLOCK, BLOCK_VOID); // continue target block
      const oldBreakDW = ctx.breakDepth;
      const oldContinueDW = ctx.continueDepth;
      const oldGotoDW = ctx.gotoDispatchDepth;
      ctx.breakDepth = 2;     // BR 2 exits outer BLOCK (past continue block + loop)
      ctx.continueDepth = 0;  // BR 0 exits continue block → runs condition
      if (ctx.gotoDispatchDepth !== null) ctx.gotoDispatchDepth += 3;
      for (const s of stmt.body) emitStatement(out, s, ctx);
      ctx.breakDepth = oldBreakDW;
      ctx.continueDepth = oldContinueDW;
      ctx.gotoDispatchDepth = oldGotoDW;
      out.push(Op.END); // end continue block
      const condTypeDW = emitExpression(out, stmt.condition, ctx);
      emitCondToI32(out, condTypeDW);
      out.push(Op.BR_IF, ...encodeUnsignedLEB128(0)); // if true, loop back
      out.push(Op.END, Op.END); // end loop, end break block
      break;
    }
    case "ForStatement": {
      // For loops need an extra BLOCK for continue so update runs before looping back
      // Structure: init; BLOCK(break) { LOOP { cond; br_if exit; BLOCK(continue) { body } update; br loop } }
      emitStatement(out, stmt.init, ctx);
      out.push(Op.BLOCK, BLOCK_VOID, Op.LOOP, BLOCK_VOID);
      const condType = emitExpression(out, stmt.condition, ctx);
      emitCondToI32(out, condType);
      out.push(Op.I32_EQZ, Op.BR_IF, ...encodeUnsignedLEB128(1));
      // BLOCK for continue target — exiting this block jumps to update
      out.push(Op.BLOCK, BLOCK_VOID);
      const oldBreakF = ctx.breakDepth;
      const oldContinueF = ctx.continueDepth;
      const oldGotoF = ctx.gotoDispatchDepth;
      ctx.breakDepth = 2;     // BR 2 exits outer BLOCK (past continue block + loop)
      ctx.continueDepth = 0;  // BR 0 exits continue block → runs update
      if (ctx.gotoDispatchDepth !== null) ctx.gotoDispatchDepth += 3;
      for (const s of stmt.body) emitStatement(out, s, ctx);
      ctx.breakDepth = oldBreakF;
      ctx.continueDepth = oldContinueF;
      ctx.gotoDispatchDepth = oldGotoF;
      out.push(Op.END); // end continue block
      emitExpression(out, stmt.update, ctx);
      if (exprProducesValue(stmt.update)) out.push(Op.DROP);
      out.push(Op.BR, ...encodeUnsignedLEB128(0), Op.END, Op.END);
      break;
    }
    case "BreakStatement": {
      if (ctx.breakDepth === null) throw new Error("'break' outside of loop or switch");
      out.push(Op.BR, ...encodeUnsignedLEB128(ctx.breakDepth));
      break;
    }
    case "ContinueStatement": {
      if (ctx.continueDepth === null) throw new Error("'continue' outside of loop");
      out.push(Op.BR, ...encodeUnsignedLEB128(ctx.continueDepth));
      break;
    }
    case "GotoStatement": {
      if (ctx.gotoStateIdx === null || ctx.gotoDispatchDepth === null) {
        throw new Error("'goto' used but goto state machine not initialized");
      }
      const targetSection = ctx.gotoLabels.get(stmt.label);
      if (targetSection === undefined) throw new Error(`Unknown label '${stmt.label}'`);
      // Set state to target section + 1 (0 = entry section)
      out.push(Op.I32_CONST, ...encodeSignedLEB128(targetSection + 1));
      out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(ctx.gotoStateIdx));
      out.push(Op.BR, ...encodeUnsignedLEB128(ctx.gotoDispatchDepth));
      break;
    }
    case "LabeledStatement": {
      // In goto state machine mode, labels are handled by emitGotoStateMachine.
      // If we reach here, just emit the body statement.
      emitStatement(out, stmt.body, ctx);
      break;
    }
    case "SwitchStatement": {
      // Switch uses nested blocks:
      // BLOCK $exit (break target)
      //   BLOCK $caseN_entry
      //     ...
      //     BLOCK $case0_entry
      //       dispatch: compare and br_if to correct case
      //     END -> case 0 body (fall-through)
      //   END -> case 1 body
      // END -> exit

      const cases = stmt.cases;
      const numEntries = cases.length; // number of case/default blocks

      // Emit outer break block + case entry blocks
      out.push(Op.BLOCK, BLOCK_VOID); // $exit
      for (let i = 0; i < numEntries; i++) {
        out.push(Op.BLOCK, BLOCK_VOID); // case entry blocks (innermost = first case)
      }

      // Dispatch: evaluate switch expression, compare with each case
      emitExpression(out, stmt.discriminant, ctx);
      out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(ctx.switchTmpIdx!));

      let defaultIdx = -1;
      for (let i = 0; i < cases.length; i++) {
        if (cases[i].value === null) {
          defaultIdx = i;
          continue;
        }
        out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(ctx.switchTmpIdx!));
        emitExpression(out, cases[i].value!, ctx);
        out.push(Op.I32_EQ);
        out.push(Op.BR_IF, ...encodeUnsignedLEB128(i)); // BR to case i's body
      }
      // Default: jump to default case or exit
      if (defaultIdx >= 0) {
        out.push(Op.BR, ...encodeUnsignedLEB128(defaultIdx));
      } else {
        out.push(Op.BR, ...encodeUnsignedLEB128(numEntries)); // jump to $exit
      }

      // Emit case bodies
      const oldBreakS = ctx.breakDepth;
      const oldContinueS = ctx.continueDepth;
      const oldGotoS = ctx.gotoDispatchDepth;
      for (let i = 0; i < cases.length; i++) {
        out.push(Op.END); // end case i's entry block
        // Inside case i body: (numEntries-1-i) remaining entry blocks + $exit block above us
        ctx.breakDepth = numEntries - 1 - i;
        // Continue: if inside a loop, adjust for switch blocks still enclosing us
        if (oldContinueS !== null) {
          ctx.continueDepth = oldContinueS + numEntries - i; // remaining entry blocks + $exit
        }
        if (oldGotoS !== null) {
          ctx.gotoDispatchDepth = oldGotoS + numEntries - i; // remaining entry blocks + $exit
        }
        for (const s of cases[i].body) emitStatement(out, s, ctx);
      }
      ctx.breakDepth = oldBreakS;
      ctx.continueDepth = oldContinueS;
      ctx.gotoDispatchDepth = oldGotoS;
      out.push(Op.END); // end $exit block
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
    case "MemberAssignmentExpression":
    case "ArrowAssignmentExpression":
      return false;
    case "CallExpression":
      // Built-in free returns void (no value on stack)
      return expr.callee !== "free";
    case "CommaExpression":
      // The last expression determines if a value is produced
      return exprProducesValue(expr.expressions[expr.expressions.length - 1]);
    default:
      return true;
  }
}

// ── Type inference (without emitting code) ───────────────

function inferType(expr: Expression, ctx: Ctx): CType {
  switch (expr.type) {
    case "IntegerLiteral": return "int";
    case "FloatingLiteral": return expr.isFloat ? "float" : "double";
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
      if (expr.operator === "~") return inferType(expr.operand, ctx);
      return inferType(expr.operand, ctx);
    case "CastExpression": return typeSpecToCType(expr.targetType);
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
    case "MemberAccessExpression": return "int"; // determined at emit time
    case "MemberAssignmentExpression": return "void";
    case "ArrowAccessExpression": return "int";
    case "ArrowAssignmentExpression": return "void";
    case "CommaExpression": return inferType(expr.expressions[expr.expressions.length - 1], ctx);
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
    case "char": case "uchar":
      out.push(Op.I32_LOAD8_S, 0x00, 0x00);
      break;
    case "short":
      out.push(Op.I32_LOAD16_S, 0x01, 0x00);
      break;
    case "ushort":
      out.push(Op.I32_LOAD16_U, 0x01, 0x00);
      break;
    case "long":
      out.push(Op.I64_LOAD, 0x03, 0x00);
      break;
    case "float":
      out.push(Op.F32_LOAD, 0x02, 0x00);
      break;
    case "double":
      out.push(Op.F64_LOAD, 0x03, 0x00);
      break;
    default: // int, uint
      out.push(Op.I32_LOAD, 0x02, 0x00);
      break;
  }
}

function emitMemStore(out: number[], ctype: CType): void {
  switch (ctype) {
    case "char": case "uchar":
      out.push(Op.I32_STORE8, 0x00, 0x00);
      break;
    case "short": case "ushort":
      out.push(Op.I32_STORE16, 0x01, 0x00);
      break;
    case "long":
      out.push(Op.I64_STORE, 0x03, 0x00);
      break;
    case "float":
      out.push(Op.F32_STORE, 0x02, 0x00);
      break;
    case "double":
      out.push(Op.F64_STORE, 0x03, 0x00);
      break;
    default: // int, uint
      out.push(Op.I32_STORE, 0x02, 0x00);
      break;
  }
}

// ── Struct field resolution ──────────────────────────────

function resolveStructField(objectName: string, memberName: string, ctx: Ctx): { addr: number | null; fieldInfo: StructFieldInfo } {
  let structName: string;
  let addr: number | null = null;
  if (ctx.structVars.has(objectName)) {
    const sv = ctx.structVars.get(objectName)!;
    structName = sv.structName;
    addr = sv.addr;
  } else if (ctx.structParamVars.has(objectName)) {
    structName = ctx.structParamVars.get(objectName)!.structName;
    addr = null; // address comes from local
  } else {
    throw new Error(`'${objectName}' is not a struct variable`);
  }
  const def = structDefs.get(structName);
  if (!def) throw new Error(`Unknown struct type '${structName}'`);
  const fieldInfo = def.fields.find(f => f.name === memberName);
  if (!fieldInfo) throw new Error(`Struct '${structName}' has no field '${memberName}'`);
  return { addr, fieldInfo };
}

function resolveArrowField(pointerName: string, memberName: string, ctx: Ctx): StructFieldInfo {
  // Need to figure out which struct this pointer points to
  // Check pointer variable type annotations - for now we need a way to track this
  // The pointer variable was declared as `struct Name *p`, so its typeSpec is a StructTypeSpecifier
  // We stored struct pointer info in varStructPtrTypes
  const structName = ctx.varStructPtrTypes?.get(pointerName);
  if (!structName) throw new Error(`Cannot determine struct type for pointer '${pointerName}'`);
  const def = structDefs.get(structName);
  if (!def) throw new Error(`Unknown struct type '${structName}'`);
  const fieldInfo = def.fields.find(f => f.name === memberName);
  if (!fieldInfo) throw new Error(`Struct '${structName}' has no field '${memberName}'`);
  return fieldInfo;
}

// ── Expression emission ──────────────────────────────────

const BINOP_MAP: Record<string, number> = {
  "+": Op.I32_ADD, "-": Op.I32_SUB, "*": Op.I32_MUL, "/": Op.I32_DIV_S, "%": Op.I32_REM_S,
  "==": Op.I32_EQ, "!=": Op.I32_NE, "<": Op.I32_LT_S, ">": Op.I32_GT_S, "<=": Op.I32_LE_S, ">=": Op.I32_GE_S,
  "&": Op.I32_AND, "|": Op.I32_OR, "^": Op.I32_XOR, "<<": Op.I32_SHL, ">>": Op.I32_SHR_S,
};

const BINOP_MAP_U32: Record<string, number> = {
  "/": Op.I32_DIV_U, "%": Op.I32_REM_U,
  "<": Op.I32_LT_U, ">": Op.I32_GT_U, "<=": Op.I32_LE_U, ">=": Op.I32_GE_U,
  ">>": Op.I32_SHR_U,
};

const BINOP_MAP_I64: Record<string, number> = {
  "+": Op.I64_ADD, "-": Op.I64_SUB, "*": Op.I64_MUL, "/": Op.I64_DIV_S, "%": Op.I64_REM_S,
  "==": Op.I64_EQ, "!=": Op.I64_NE, "<": Op.I64_LT_S, ">": Op.I64_GT_S, "<=": Op.I64_LE_S, ">=": Op.I64_GE_S,
  "&": Op.I64_AND, "|": Op.I64_OR, "^": Op.I64_XOR, "<<": Op.I64_SHL, ">>": Op.I64_SHR_S,
};

const BINOP_MAP_F32: Record<string, number> = {
  "+": Op.F32_ADD, "-": Op.F32_SUB, "*": Op.F32_MUL, "/": Op.F32_DIV,
  "==": Op.F32_EQ, "!=": Op.F32_NE, "<": Op.F32_LT, ">": Op.F32_GT, "<=": Op.F32_LE, ">=": Op.F32_GE,
};

const BINOP_MAP_F64: Record<string, number> = {
  "+": Op.F64_ADD, "-": Op.F64_SUB, "*": Op.F64_MUL, "/": Op.F64_DIV,
  "==": Op.F64_EQ, "!=": Op.F64_NE, "<": Op.F64_LT, ">": Op.F64_GT, "<=": Op.F64_LE, ">=": Op.F64_GE,
};

const COMPOUND_OP_MAP: Record<string, number> = {
  "+=": Op.I32_ADD, "-=": Op.I32_SUB, "*=": Op.I32_MUL, "/=": Op.I32_DIV_S, "%=": Op.I32_REM_S,
};

const COMPOUND_OP_MAP_I64: Record<string, number> = {
  "+=": Op.I64_ADD, "-=": Op.I64_SUB, "*=": Op.I64_MUL, "/=": Op.I64_DIV_S, "%=": Op.I64_REM_S,
};

const COMPOUND_OP_MAP_F32: Record<string, number> = {
  "+=": Op.F32_ADD, "-=": Op.F32_SUB, "*=": Op.F32_MUL, "/=": Op.F32_DIV,
};

const COMPOUND_OP_MAP_F64: Record<string, number> = {
  "+=": Op.F64_ADD, "-=": Op.F64_SUB, "*=": Op.F64_MUL, "/=": Op.F64_DIV,
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
    case "FloatingLiteral":
      if (expr.isFloat) {
        out.push(Op.F32_CONST, ...encodeF32(expr.value));
        return "float";
      } else {
        out.push(Op.F64_CONST, ...encodeF64(expr.value));
        return "double";
      }
    case "CharLiteral":
      out.push(Op.I32_CONST, ...encodeSignedLEB128(expr.value));
      return "int";
    case "SizeofExpression": {
      let sz: number;
      if (typeof expr.targetType === "object" && (expr.targetType.kind === "struct" || expr.targetType.kind === "union")) {
        const def = structDefs.get(expr.targetType.name);
        if (!def) throw new Error(`Unknown ${expr.targetType.kind} type '${expr.targetType.name}'`);
        sz = def.size;
      } else {
        sz = sizeOfType(typeSpecToCType(expr.targetType));
      }
      out.push(Op.I32_CONST, ...encodeSignedLEB128(sz));
      return "int";
    }
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
      const isBitwise = ["&", "|", "^", "<<", ">>"].includes(expr.operator);
      const opType = promoteTypes(leftType, rightType);

      const lt = emitExpression(out, expr.left, ctx);
      emitConversion(out, lt, opType);
      const rt = emitExpression(out, expr.right, ctx);
      emitConversion(out, rt, opType);

      if (opType === "double") {
        out.push(BINOP_MAP_F64[expr.operator]);
      } else if (opType === "float") {
        out.push(BINOP_MAP_F32[expr.operator]);
      } else if (opType === "long") {
        out.push(BINOP_MAP_I64[expr.operator]);
      } else if (isUnsigned(opType) && BINOP_MAP_U32[expr.operator] !== undefined) {
        out.push(BINOP_MAP_U32[expr.operator]);
      } else {
        out.push(BINOP_MAP[expr.operator]);
      }
      // Comparisons always return i32
      if (isComparison) return "int";
      return opType;
    }
    case "UnaryExpression":
      if (expr.operator === "-") {
        const operandType = inferType(expr.operand, ctx);
        if (operandType === "double") {
          emitExpression(out, expr.operand, ctx);
          out.push(Op.F64_NEG);
          return "double";
        } else if (operandType === "float") {
          emitExpression(out, expr.operand, ctx);
          out.push(Op.F32_NEG);
          return "float";
        } else if (operandType === "long") {
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
        if (ot === "double") {
          out.push(Op.F64_CONST, ...encodeF64(0));
          out.push(Op.F64_EQ);
        } else if (ot === "float") {
          out.push(Op.F32_CONST, ...encodeF32(0));
          out.push(Op.F32_EQ);
        } else if (ot === "long") {
          out.push(Op.I64_EQZ);
        } else {
          out.push(Op.I32_EQZ);
        }
        return "int";
      } else if (expr.operator === "~") {
        const ot = emitExpression(out, expr.operand, ctx);
        if (ot === "long") {
          out.push(Op.I64_CONST, ...encodeSignedLEB128_i64(-1));
          out.push(Op.I64_XOR);
          return "long";
        } else {
          out.push(Op.I32_CONST, ...encodeSignedLEB128(-1));
          out.push(Op.I32_XOR);
          return ot;
        }
      }
      return "int";
    case "CastExpression": {
      const srcType = emitExpression(out, expr.operand, ctx);
      const targetType = typeSpecToCType(expr.targetType);
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
      // Struct name decays to pointer (base address)
      if (ctx.structVars.has(expr.name)) {
        const sv = ctx.structVars.get(expr.name)!;
        out.push(Op.I32_CONST, ...encodeSignedLEB128(sv.addr));
        return "int";
      }
      // Struct param is already a pointer
      if (ctx.structParamVars.has(expr.name)) {
        const sp = ctx.structParamVars.get(expr.name)!;
        out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(sp.localIdx));
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
      const opMap = varType === "double" ? COMPOUND_OP_MAP_F64
        : varType === "float" ? COMPOUND_OP_MAP_F32
        : varType === "long" ? COMPOUND_OP_MAP_I64
        : COMPOUND_OP_MAP;

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
      // Built-in malloc: bump allocator on linear memory
      if (expr.callee === "malloc") {
        mallocUsed = true;
        // Align heap pointer to 8 bytes
        out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(heapPtrGlobalIdx));
        out.push(Op.I32_CONST, ...encodeSignedLEB128(7));
        out.push(Op.I32_ADD);
        out.push(Op.I32_CONST, ...encodeSignedLEB128(-8));
        out.push(Op.I32_AND);
        out.push(Op.GLOBAL_SET, ...encodeUnsignedLEB128(heapPtrGlobalIdx));
        // Save old heap pointer (return value)
        out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(heapPtrGlobalIdx));
        // Bump: heapPtr += size
        out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(heapPtrGlobalIdx));
        emitExpression(out, expr.args[0], ctx);
        out.push(Op.I32_ADD);
        out.push(Op.GLOBAL_SET, ...encodeUnsignedLEB128(heapPtrGlobalIdx));
        // Grow memory if needed: if heapPtr > memory.size * 65536
        out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(heapPtrGlobalIdx));
        out.push(Op.MEMORY_SIZE, 0x00);
        out.push(Op.I32_CONST, ...encodeSignedLEB128(16));
        out.push(Op.I32_SHL);
        out.push(Op.I32_GT_U);
        out.push(Op.IF, BLOCK_VOID);
        out.push(Op.I32_CONST, ...encodeSignedLEB128(1));
        out.push(Op.MEMORY_GROW, 0x00);
        out.push(Op.DROP);
        out.push(Op.END);
        // Stack has old heap pointer as return value
        return "int";
      }
      // Built-in free: no-op (evaluate arg for side effects, drop)
      if (expr.callee === "free") {
        if (expr.args.length > 0) {
          emitExpression(out, expr.args[0], ctx);
          out.push(Op.DROP);
        }
        return "void";
      }
      const fIdx = ctx.funcIndex.get(expr.callee);
      if (fIdx === undefined) throw new Error(`Unknown function '${expr.callee}'`);
      const paramTypes = ctx.funcParamTypes.get(expr.callee);
      const calleeSP = ctx.funcStructParams.get(expr.callee);
      for (let i = 0; i < expr.args.length; i++) {
        // Check if this arg is a struct being passed by value
        if (calleeSP && calleeSP.has(i) && expr.args[i].type === "Identifier") {
          const argName = expr.args[i].type === "Identifier" ? (expr.args[i] as any).name : null;
          if (argName) {
            const structName = calleeSP.get(i)!;
            const def = structDefs.get(structName);
            if (def) {
              // Allocate temp memory for the copy
              const maxAlign = Math.max(...def.fields.map(f => sizeOfType(f.ctype)), 1);
              while (nextMemAddr % maxAlign !== 0) nextMemAddr++;
              const tempAddr = nextMemAddr;
              nextMemAddr += def.size;
              // Determine source address
              let srcAddr: number | null = null;
              let srcLocalIdx: number | null = null;
              if (ctx.structVars.has(argName)) {
                srcAddr = ctx.structVars.get(argName)!.addr;
              } else if (ctx.structParamVars.has(argName)) {
                srcLocalIdx = ctx.structParamVars.get(argName)!.localIdx;
              }
              // Copy field by field
              for (const field of def.fields) {
                out.push(Op.I32_CONST, ...encodeSignedLEB128(tempAddr + field.offset));
                if (srcAddr !== null) {
                  out.push(Op.I32_CONST, ...encodeSignedLEB128(srcAddr + field.offset));
                } else if (srcLocalIdx !== null) {
                  out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(srcLocalIdx));
                  if (field.offset > 0) {
                    out.push(Op.I32_CONST, ...encodeSignedLEB128(field.offset));
                    out.push(Op.I32_ADD);
                  }
                }
                emitMemLoad(out, field.ctype);
                emitMemStore(out, field.ctype);
              }
              // Push temp address
              out.push(Op.I32_CONST, ...encodeSignedLEB128(tempAddr));
              continue;
            }
          }
        }
        const argType = emitExpression(out, expr.args[i], ctx);
        if (paramTypes && i < paramTypes.length) {
          emitConversion(out, argType, paramTypes[i]);
        }
      }
      out.push(Op.CALL, ...encodeUnsignedLEB128(fIdx));
      return ctx.funcReturnTypes.get(expr.callee) || "int";
    }
    case "AddressOfExpression": {
      // Check struct vars first
      if (ctx.structVars.has(expr.name)) {
        const sv = ctx.structVars.get(expr.name)!;
        out.push(Op.I32_CONST, ...encodeSignedLEB128(sv.addr));
        return "int";
      }
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
        emitCondToI32(out, lt);
        out.push(Op.IF, BLOCK_I32);
        const rt = emitExpression(out, expr.right, ctx);
        emitCondToI32(out, rt);
        out.push(Op.I32_EQZ, Op.I32_EQZ);
        out.push(Op.ELSE);
        out.push(Op.I32_CONST, ...encodeSignedLEB128(0));
        out.push(Op.END);
      } else {
        const lt = emitExpression(out, expr.left, ctx);
        emitCondToI32(out, lt);
        out.push(Op.IF, BLOCK_I32);
        out.push(Op.I32_CONST, ...encodeSignedLEB128(1));
        out.push(Op.ELSE);
        const rt = emitExpression(out, expr.right, ctx);
        emitCondToI32(out, rt);
        out.push(Op.I32_EQZ, Op.I32_EQZ);
        out.push(Op.END);
      }
      return "int";
    case "TernaryExpression": {
      const resultType = inferType(expr, ctx);
      const condType = emitExpression(out, expr.condition, ctx);
      emitCondToI32(out, condType);
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
      // Determine element type: pointer vars use their pointed-to type, arrays default to int
      const elemType: CType = ctx.varPtrTypes.get(expr.array) || "int";
      const elemSize = sizeOfType(elemType);
      if (arrInfo) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(arrInfo.addr));
      } else {
        emitVarGet(out, expr.array, ctx);
      }
      emitExpression(out, expr.index, ctx);
      out.push(Op.I32_CONST, ...encodeSignedLEB128(elemSize));
      out.push(Op.I32_MUL);
      out.push(Op.I32_ADD);
      emitMemLoad(out, elemType);
      return elemType;
    }
    case "ArrayIndexAssignment": {
      const arrInfo = ctx.arrayVars.get(expr.array);
      const elemType: CType = ctx.varPtrTypes.get(expr.array) || "int";
      const elemSize = sizeOfType(elemType);
      if (arrInfo) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(arrInfo.addr));
      } else {
        emitVarGet(out, expr.array, ctx);
      }
      emitExpression(out, expr.index, ctx);
      out.push(Op.I32_CONST, ...encodeSignedLEB128(elemSize));
      out.push(Op.I32_MUL);
      out.push(Op.I32_ADD);
      const valType = emitExpression(out, expr.value, ctx);
      emitConversion(out, valType, elemType);
      emitMemStore(out, elemType);
      return "void";
    }
    case "UpdateExpression": {
      const varName = expr.name;
      const varType = getVarType(varName, ctx);
      const isLong = varType === "long";
      const addOp = varType === "double"
        ? (expr.operator === "++" ? Op.F64_ADD : Op.F64_SUB)
        : varType === "float"
        ? (expr.operator === "++" ? Op.F32_ADD : Op.F32_SUB)
        : isLong
        ? (expr.operator === "++" ? Op.I64_ADD : Op.I64_SUB)
        : (expr.operator === "++" ? Op.I32_ADD : Op.I32_SUB);

      function emitConstOne(o: number[]): void {
        if (varType === "double") o.push(Op.F64_CONST, ...encodeF64(1));
        else if (varType === "float") o.push(Op.F32_CONST, ...encodeF32(1));
        else if (isLong) o.push(Op.I64_CONST, ...encodeSignedLEB128_i64(1));
        else o.push(Op.I32_CONST, ...encodeSignedLEB128(1));
      }

      if (ctx.memVars.has(varName)) {
        const addr = ctx.memVars.get(varName)!;
        if (expr.prefix) {
          out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
          out.push(Op.I32_CONST, ...encodeSignedLEB128(addr));
          emitMemLoad(out, varType);
          emitConstOne(out);
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
          emitConstOne(out);
          out.push(addOp);
          emitMemStore(out, varType);
        }
      } else if (ctx.locals.has(varName)) {
        const idx = ctx.locals.get(varName)!;
        if (expr.prefix) {
          out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(idx));
          emitConstOne(out);
          out.push(addOp);
          out.push(Op.LOCAL_TEE, ...encodeUnsignedLEB128(idx));
        } else {
          out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(idx));
          out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(idx));
          emitConstOne(out);
          out.push(addOp);
          out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
        }
      } else if (ctx.globalIndex.has(varName)) {
        const gIdx = ctx.globalIndex.get(varName)!;
        if (expr.prefix) {
          emitVarGet(out, varName, ctx);
          emitConstOne(out);
          out.push(addOp);
          out.push(Op.GLOBAL_SET, ...encodeUnsignedLEB128(gIdx));
          out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(gIdx));
        } else {
          out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(gIdx));
          out.push(Op.GLOBAL_GET, ...encodeUnsignedLEB128(gIdx));
          emitConstOne(out);
          out.push(addOp);
          out.push(Op.GLOBAL_SET, ...encodeUnsignedLEB128(gIdx));
        }
      } else {
        throw new Error(`Unknown variable '${varName}'`);
      }
      return varType;
    }
    case "MemberAccessExpression": {
      const { addr, fieldInfo } = resolveStructField(expr.object, expr.member, ctx);
      if (addr !== null) {
        // Stack-allocated struct var
        out.push(Op.I32_CONST, ...encodeSignedLEB128(addr + fieldInfo.offset));
      } else {
        // Struct param (pointer in local)
        const sp = ctx.structParamVars.get(expr.object)!;
        out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(sp.localIdx));
        if (fieldInfo.offset > 0) {
          out.push(Op.I32_CONST, ...encodeSignedLEB128(fieldInfo.offset));
          out.push(Op.I32_ADD);
        }
      }
      emitMemLoad(out, fieldInfo.ctype);
      return fieldInfo.ctype;
    }
    case "MemberAssignmentExpression": {
      const { addr, fieldInfo } = resolveStructField(expr.object, expr.member, ctx);
      if (addr !== null) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(addr + fieldInfo.offset));
      } else {
        const sp = ctx.structParamVars.get(expr.object)!;
        out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(sp.localIdx));
        if (fieldInfo.offset > 0) {
          out.push(Op.I32_CONST, ...encodeSignedLEB128(fieldInfo.offset));
          out.push(Op.I32_ADD);
        }
      }
      const valType = emitExpression(out, expr.value, ctx);
      emitConversion(out, valType, fieldInfo.ctype);
      emitMemStore(out, fieldInfo.ctype);
      return "void";
    }
    case "ArrowAccessExpression": {
      const fieldInfo = resolveArrowField(expr.pointer, expr.member, ctx);
      emitVarGet(out, expr.pointer, ctx);
      if (fieldInfo.offset > 0) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(fieldInfo.offset));
        out.push(Op.I32_ADD);
      }
      emitMemLoad(out, fieldInfo.ctype);
      return fieldInfo.ctype;
    }
    case "ArrowAssignmentExpression": {
      const fieldInfo = resolveArrowField(expr.pointer, expr.member, ctx);
      emitVarGet(out, expr.pointer, ctx);
      if (fieldInfo.offset > 0) {
        out.push(Op.I32_CONST, ...encodeSignedLEB128(fieldInfo.offset));
        out.push(Op.I32_ADD);
      }
      const valType = emitExpression(out, expr.value, ctx);
      emitConversion(out, valType, fieldInfo.ctype);
      emitMemStore(out, fieldInfo.ctype);
      return "void";
    }
    case "CommaExpression": {
      // Evaluate all expressions, drop all but the last
      let lastType: CType = "void";
      for (let i = 0; i < expr.expressions.length; i++) {
        lastType = emitExpression(out, expr.expressions[i], ctx);
        if (i < expr.expressions.length - 1 && exprProducesValue(expr.expressions[i])) {
          out.push(Op.DROP);
        }
      }
      return lastType;
    }
  }
}
