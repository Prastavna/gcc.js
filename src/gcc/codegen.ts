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

/**
 * Generates a WASM binary module from a Program AST.
 */
export function generate(ast: Program): Uint8Array {
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

function buildExportSection(funcs: FunctionDeclaration[]): number[] {
  const entries: number[] = [];
  for (let i = 0; i < funcs.length; i++) {
    entries.push(
      ...encodeName(funcs[i].name),
      ExportKind.FUNC,
      ...encodeUnsignedLEB128(i),
    );
  }
  const content = [...encodeUnsignedLEB128(funcs.length), ...entries];
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

// ── Local variable tracking ──────────────────────────────

/**
 * Recursively collect all variable declarations from a statement list,
 * including inside if/while/for bodies.
 */
function collectLocalsFromStatements(
  stmts: Statement[],
  locals: Map<string, number>,
  offset: number,
): number {
  let count = 0;
  for (const stmt of stmts) {
    if (stmt.type === "VariableDeclaration" && !locals.has(stmt.name)) {
      locals.set(stmt.name, offset + count);
      count++;
    }
    if (stmt.type === "IfStatement") {
      count += collectLocalsFromStatements(stmt.consequent, locals, offset + count);
      if (stmt.alternate) {
        count += collectLocalsFromStatements(stmt.alternate, locals, offset + count);
      }
    }
    if (stmt.type === "WhileStatement") {
      count += collectLocalsFromStatements(stmt.body, locals, offset + count);
    }
    if (stmt.type === "ForStatement") {
      // The init may be a var decl
      count += collectLocalsFromStatements([stmt.init], locals, offset + count);
      count += collectLocalsFromStatements(stmt.body, locals, offset + count);
    }
  }
  return count;
}

function collectLocals(func: FunctionDeclaration): { locals: Map<string, number>; declaredCount: number } {
  const locals = new Map<string, number>();
  for (let i = 0; i < func.params.length; i++) {
    locals.set(func.params[i].name, i);
  }
  const offset = func.params.length;
  const declaredCount = collectLocalsFromStatements(func.body, locals, offset);
  return { locals, declaredCount };
}

function buildFunctionBody(
  func: FunctionDeclaration,
  funcIndex: Map<string, number>,
): number[] {
  const { locals, declaredCount } = collectLocals(func);
  const instructions: number[] = [];

  emitStatements(instructions, func.body, locals, funcIndex);

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

  // Every function must leave exactly one i32 on the stack for its return value.
  // When all paths use `return` (Op.RETURN), the fallthrough is unreachable,
  // but WASM validation still requires a value. Push a dummy 0.
  instructions.push(Op.I32_CONST, ...encodeSignedLEB128(0));

  const bodyContent = [...localDeclBytes, ...instructions, Op.END];
  return [...encodeUnsignedLEB128(bodyContent.length), ...bodyContent];
}

// ── Statement emission ───────────────────────────────────

type Ctx = {
  locals: Map<string, number>;
  funcIndex: Map<string, number>;
};

function emitStatements(
  out: number[],
  stmts: Statement[],
  locals: Map<string, number>,
  funcIndex: Map<string, number>,
): void {
  for (const stmt of stmts) {
    emitStatement(out, stmt, { locals, funcIndex });
  }
}

function emitStatement(out: number[], stmt: Statement, ctx: Ctx): void {
  switch (stmt.type) {
    case "ReturnStatement":
      emitExpression(out, stmt.expression, ctx);
      out.push(Op.RETURN);
      break;

    case "VariableDeclaration": {
      const idx = ctx.locals.get(stmt.name);
      if (idx === undefined) throw new Error(`Unknown local '${stmt.name}'`);
      emitExpression(out, stmt.initializer, ctx);
      out.push(Op.LOCAL_SET, ...encodeUnsignedLEB128(idx));
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

/**
 * WASM if/else:
 *   <condition>
 *   if (void)
 *     <consequent>
 *   else
 *     <alternate>
 *   end
 */
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

/**
 * WASM while loop:
 *   block $break
 *     loop $continue
 *       <condition>
 *       i32.eqz
 *       br_if $break        ;; if condition is false, break
 *       <body>
 *       br $continue         ;; jump back to loop start
 *     end
 *   end
 */
function emitWhile(
  out: number[],
  stmt: { condition: Expression; body: Statement[] },
  ctx: Ctx,
): void {
  out.push(Op.BLOCK, BLOCK_VOID);  // $break (depth 1 from inside loop)
  out.push(Op.LOOP, BLOCK_VOID);   // $continue (depth 0 from inside loop)
  emitExpression(out, stmt.condition, ctx);
  out.push(Op.I32_EQZ);
  out.push(Op.BR_IF, ...encodeUnsignedLEB128(1)); // br_if $break
  for (const s of stmt.body) emitStatement(out, s, ctx);
  out.push(Op.BR, ...encodeUnsignedLEB128(0));    // br $continue
  out.push(Op.END); // end loop
  out.push(Op.END); // end block
}

/**
 * For loop desugars to: init; while (condition) { body; update; }
 */
function emitFor(
  out: number[],
  stmt: { init: Statement; condition: Expression; update: Expression; body: Statement[] },
  ctx: Ctx,
): void {
  // Emit init
  emitStatement(out, stmt.init, ctx);

  // Emit while loop
  out.push(Op.BLOCK, BLOCK_VOID);
  out.push(Op.LOOP, BLOCK_VOID);
  emitExpression(out, stmt.condition, ctx);
  out.push(Op.I32_EQZ);
  out.push(Op.BR_IF, ...encodeUnsignedLEB128(1));
  for (const s of stmt.body) emitStatement(out, s, ctx);
  emitExpression(out, stmt.update, ctx); // update expression (e.g. assignment)
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
      const idx = ctx.locals.get(expr.name);
      if (idx === undefined) throw new Error(`Unknown variable '${expr.name}'`);
      out.push(Op.LOCAL_GET, ...encodeUnsignedLEB128(idx));
      break;
    }

    case "AssignmentExpression": {
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
  }
}
