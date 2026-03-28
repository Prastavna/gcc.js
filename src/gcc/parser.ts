import { TokenType } from "./types.ts";
import type {
  Token,
  Program,
  Declaration,
  Parameter,
  Statement,
  Expression,
  TypeSpecifier,
  FunctionPointerTypeSpecifier,
  BinaryOperator,
  ComparisonOperator,
  LogicalOperator,
  CompoundAssignmentOperator,
} from "./types.ts";

/**
 * Recursive descent parser with precedence climbing for expressions.
 *
 * Precedence (low to high):
 *   assignment → ternary → logical_or → logical_and → bitwise_or → bitwise_xor
 *   → bitwise_and → comparison → shift → additive → multiplicative → unary → postfix → primary
 */
export function parse(tokens: Token[]): Program {
  let pos = 0;

  // Maps for compile-time constant resolution
  const enumConstants = new Map<string, number>();
  const typedefs = new Map<string, TypeSpecifier>();
  // Track function pointer variables for indirect call detection
  const funcPtrVars = new Set<string>();

  function current(): Token {
    return tokens[pos];
  }

  function peek(offset: number): Token {
    return tokens[pos + offset];
  }

  function expect(type: TokenType, what: string): Token {
    const tok = current();
    if (tok.type !== type) {
      throw new Error(
        `Expected ${what} but got '${tok.value || tok.type}' at line ${tok.line}:${tok.col}`
      );
    }
    pos++;
    return tok;
  }

  function isQualifierOrStorage(t: TokenType): boolean {
    return t === TokenType.CONST || t === TokenType.VOLATILE || t === TokenType.STATIC || t === TokenType.EXTERN || t === TokenType.REGISTER || t === TokenType.AUTO;
  }

  interface DeclQualifiers {
    isConst: boolean;
    isStatic: boolean;
    isExtern: boolean;
  }

  function consumeQualifiers(): DeclQualifiers {
    const q: DeclQualifiers = { isConst: false, isStatic: false, isExtern: false };
    while (true) {
      const t = current().type;
      if (t === TokenType.CONST) { q.isConst = true; pos++; }
      else if (t === TokenType.VOLATILE) { pos++; }
      else if (t === TokenType.STATIC) { q.isStatic = true; pos++; }
      else if (t === TokenType.EXTERN) { q.isExtern = true; pos++; }
      else if (t === TokenType.REGISTER) { pos++; }
      else if (t === TokenType.AUTO) { pos++; }
      else break;
    }
    return q;
  }

  function isTypeSpec(): boolean {
    const t = current().type;
    if (t === TokenType.INT || t === TokenType.VOID || t === TokenType.CHAR || t === TokenType.SHORT || t === TokenType.LONG || t === TokenType.FLOAT || t === TokenType.DOUBLE || t === TokenType.STRUCT || t === TokenType.ENUM || t === TokenType.UNION || t === TokenType.UNSIGNED || t === TokenType.SIGNED) return true;
    if (t === TokenType.IDENTIFIER && typedefs.has(current().value)) return true;
    return false;
  }

  /** Returns the number of tokens the current type specifier consumes */
  function typeSpecLength(): number {
    const t = current().type;
    if (t === TokenType.STRUCT || t === TokenType.UNION) return 2; // struct/union Name
    if (t === TokenType.ENUM) {
      if (peek(1).type === TokenType.IDENTIFIER) return 2;
      return 1;
    }
    if (t === TokenType.UNSIGNED) {
      const next = peek(1).type;
      if (next === TokenType.INT || next === TokenType.CHAR || next === TokenType.SHORT) return 2;
      return 1;
    }
    if (t === TokenType.SIGNED) {
      const next = peek(1).type;
      if (next === TokenType.CHAR || next === TokenType.SHORT || next === TokenType.INT || next === TokenType.LONG) return 2;
      return 1; // signed alone = int
    }
    return 1; // int, void, char, short, long, float, double, typedef name
  }

  function parseTypeSpec(): TypeSpecifier {
    const tok = current();
    if (tok.type === TokenType.INT) { pos++; return "int"; }
    if (tok.type === TokenType.VOID) { pos++; return "void"; }
    if (tok.type === TokenType.CHAR) { pos++; return "char"; }
    if (tok.type === TokenType.LONG) { pos++; return "long"; }
    if (tok.type === TokenType.FLOAT) { pos++; return "float"; }
    if (tok.type === TokenType.DOUBLE) { pos++; return "double"; }
    if (tok.type === TokenType.SHORT) { pos++; return "short"; }
    if (tok.type === TokenType.SIGNED) {
      pos++;
      if (current().type === TokenType.CHAR) { pos++; return "char"; }
      if (current().type === TokenType.SHORT) { pos++; return "short"; }
      if (current().type === TokenType.INT) { pos++; return "int"; }
      if (current().type === TokenType.LONG) { pos++; return "long"; }
      return "int"; // signed alone = int
    }
    if (tok.type === TokenType.UNSIGNED) {
      pos++;
      if (current().type === TokenType.CHAR) { pos++; return "unsigned char"; }
      if (current().type === TokenType.SHORT) { pos++; return "unsigned short"; }
      if (current().type === TokenType.INT) { pos++; }
      return "unsigned int";
    }
    if (tok.type === TokenType.STRUCT) {
      pos++;
      const name = expect(TokenType.IDENTIFIER, "struct name").value;
      return { kind: "struct", name };
    }
    if (tok.type === TokenType.UNION) {
      pos++;
      const name = expect(TokenType.IDENTIFIER, "union name").value;
      return { kind: "union", name };
    }
    if (tok.type === TokenType.ENUM) {
      pos++;
      // enum used as type specifier — consume optional name, treat as int
      if (current().type === TokenType.IDENTIFIER) pos++;
      return "int";
    }
    if (tok.type === TokenType.IDENTIFIER && typedefs.has(tok.value)) {
      pos++;
      return typedefs.get(tok.value)!;
    }
    throw new Error(
      `Expected type specifier but got '${tok.value || tok.type}' at line ${tok.line}:${tok.col}`
    );
  }

  function isComparisonOp(): boolean {
    const t = current().type;
    return t === TokenType.EQ || t === TokenType.NEQ ||
      t === TokenType.LT || t === TokenType.GT ||
      t === TokenType.LTE || t === TokenType.GTE;
  }

  // ── Expression parsing (precedence climbing) ───────────

  function parseExpression(): Expression {
    let expr = parseAssignment();
    if (current().type === TokenType.COMMA) {
      const expressions: Expression[] = [expr];
      while (current().type === TokenType.COMMA) {
        pos++;
        expressions.push(parseAssignment());
      }
      return { type: "CommaExpression", expressions };
    }
    return expr;
  }

  function parseAssignment(): Expression {
    // *expr = val (dereference assignment)
    if (current().type === TokenType.STAR) {
      const savedPos = pos;
      pos++; // skip *
      const pointer = parseUnary();
      if (current().type === TokenType.EQUALS) {
        pos++; // skip =
        const value = parseAssignment();
        return { type: "DereferenceAssignment", pointer, value };
      }
      // Not an assignment, backtrack — parse as dereference in normal flow
      pos = savedPos;
    }

    // ident.member = val (member assignment)
    if (current().type === TokenType.IDENTIFIER && peek(1).type === TokenType.DOT && peek(2).type === TokenType.IDENTIFIER && peek(3).type === TokenType.EQUALS) {
      const object = current().value;
      pos += 2; // skip ident and dot
      const member = expect(TokenType.IDENTIFIER, "member name").value;
      pos++; // skip =
      const value = parseAssignment();
      return { type: "MemberAssignmentExpression", object, member, value };
    }

    // ident->member = val (arrow assignment)
    if (current().type === TokenType.IDENTIFIER && peek(1).type === TokenType.ARROW && peek(2).type === TokenType.IDENTIFIER && peek(3).type === TokenType.EQUALS) {
      const pointer = current().value;
      pos += 2; // skip ident and ->
      const member = expect(TokenType.IDENTIFIER, "member name").value;
      pos++; // skip =
      const value = parseAssignment();
      return { type: "ArrowAssignmentExpression", pointer, member, value };
    }

    // ident[expr] = val (array index assignment)  OR  ident = val  OR  ident += val
    if (current().type === TokenType.IDENTIFIER) {
      const nextTok = peek(1);

      // Array index assignment: ident[expr] = val, ident[expr][expr] = val, ident[expr].member = val
      if (nextTok.type === TokenType.LBRACKET) {
        const savedPos = pos;
        const name = current().value;
        pos += 2; // skip ident and [
        const index = parseExpression();
        expect(TokenType.RBRACKET, "']' after array index");
        // Check for chained [] or . then =
        let arrayExpr: string | Expression = name;
        let lastIndex = index;
        let chained = false;
        while (current().type === TokenType.LBRACKET) {
          chained = true;
          arrayExpr = { type: "ArrayAccessExpression", array: chained ? arrayExpr : name, index: lastIndex } as Expression;
          pos++; // skip [
          lastIndex = parseExpression();
          expect(TokenType.RBRACKET, "']' after array index");
        }
        if (!chained) {
          arrayExpr = name;
        }
        // ident[expr].member = val (struct array member assignment)
        if (current().type === TokenType.DOT) {
          const arrAccess: Expression = { type: "ArrayAccessExpression", array: chained ? arrayExpr : name, index: lastIndex };
          pos++; // skip .
          const member = expect(TokenType.IDENTIFIER, "member name after '.'").value;
          if (current().type === TokenType.EQUALS) {
            pos++; // skip =
            const value = parseAssignment();
            return { type: "MemberAssignmentExpression", object: arrAccess, member, value };
          }
          pos = savedPos;
        } else if (current().type === TokenType.EQUALS) {
          pos++; // skip =
          const value = parseAssignment();
          return { type: "ArrayIndexAssignment", array: chained ? arrayExpr : name, index: lastIndex, value };
        } else {
          // Not an assignment — backtrack and let normal expression parsing handle it
          pos = savedPos;
        }
      }

      if (nextTok.type === TokenType.EQUALS) {
        const name = current().value;
        pos += 2;
        const value = parseAssignment();
        return { type: "AssignmentExpression", name, value };
      }
      // Compound assignment: ident += val, ident -= val, etc.
      if (
        nextTok.type === TokenType.PLUS_EQUALS ||
        nextTok.type === TokenType.MINUS_EQUALS ||
        nextTok.type === TokenType.STAR_EQUALS ||
        nextTok.type === TokenType.SLASH_EQUALS ||
        nextTok.type === TokenType.PERCENT_EQUALS
      ) {
        const name = current().value;
        const op = nextTok.value as CompoundAssignmentOperator;
        pos += 2;
        const value = parseAssignment();
        return { type: "CompoundAssignmentExpression", operator: op, name, value };
      }
    }
    return parseTernary();
  }

  /** ternary → logical_or ('?' expression ':' ternary)? */
  function parseTernary(): Expression {
    let expr = parseLogicalOr();
    if (current().type === TokenType.QUESTION) {
      pos++; // skip ?
      const consequent = parseExpression();
      expect(TokenType.COLON, "':' in ternary expression");
      const alternate = parseTernary();
      expr = { type: "TernaryExpression", condition: expr, consequent, alternate };
    }
    return expr;
  }

  /** logical_or → logical_and ('||' logical_and)* */
  function parseLogicalOr(): Expression {
    let left = parseLogicalAnd();
    while (current().type === TokenType.PIPE_PIPE) {
      const op = current().value as LogicalOperator;
      pos++;
      const right = parseLogicalAnd();
      left = { type: "LogicalExpression", operator: op, left, right };
    }
    return left;
  }

  /** logical_and → bitwise_or ('&&' bitwise_or)* */
  function parseLogicalAnd(): Expression {
    let left = parseBitwiseOr();
    while (current().type === TokenType.AND_AND) {
      const op = current().value as LogicalOperator;
      pos++;
      const right = parseBitwiseOr();
      left = { type: "LogicalExpression", operator: op, left, right };
    }
    return left;
  }

  /** bitwise_or → bitwise_xor ('|' bitwise_xor)* */
  function parseBitwiseOr(): Expression {
    let left = parseBitwiseXor();
    while (current().type === TokenType.PIPE) {
      pos++;
      const right = parseBitwiseXor();
      left = { type: "BinaryExpression", operator: "|" as BinaryOperator, left, right };
    }
    return left;
  }

  /** bitwise_xor → bitwise_and ('^' bitwise_and)* */
  function parseBitwiseXor(): Expression {
    let left = parseBitwiseAnd();
    while (current().type === TokenType.CARET) {
      pos++;
      const right = parseBitwiseAnd();
      left = { type: "BinaryExpression", operator: "^" as BinaryOperator, left, right };
    }
    return left;
  }

  /** bitwise_and → comparison ('&' comparison)* */
  function parseBitwiseAnd(): Expression {
    let left = parseComparison();
    while (current().type === TokenType.AMPERSAND) {
      pos++;
      const right = parseComparison();
      left = { type: "BinaryExpression", operator: "&" as BinaryOperator, left, right };
    }
    return left;
  }

  /** comparison → shift (('==' | '!=' | '<' | '>' | '<=' | '>=') shift)* */
  function parseComparison(): Expression {
    let left = parseShift();
    while (isComparisonOp()) {
      const op = current().value as ComparisonOperator;
      pos++;
      const right = parseShift();
      left = { type: "BinaryExpression", operator: op, left, right };
    }
    return left;
  }

  /** shift → additive (('<<' | '>>') additive)* */
  function parseShift(): Expression {
    let left = parseAdditive();
    while (current().type === TokenType.LEFT_SHIFT || current().type === TokenType.RIGHT_SHIFT) {
      const op = current().value as BinaryOperator;
      pos++;
      const right = parseAdditive();
      left = { type: "BinaryExpression", operator: op, left, right };
    }
    return left;
  }

  function parseAdditive(): Expression {
    let left = parseMultiplicative();
    while (
      current().type === TokenType.PLUS ||
      current().type === TokenType.MINUS
    ) {
      const op = current().value as BinaryOperator;
      pos++;
      const right = parseMultiplicative();
      left = { type: "BinaryExpression", operator: op, left, right };
    }
    return left;
  }

  function parseMultiplicative(): Expression {
    let left = parseUnary();
    while (
      current().type === TokenType.STAR ||
      current().type === TokenType.SLASH ||
      current().type === TokenType.PERCENT
    ) {
      const op = current().value as BinaryOperator;
      pos++;
      const right = parseUnary();
      left = { type: "BinaryExpression", operator: op, left, right };
    }
    return left;
  }

  function parseUnary(): Expression {
    // Unary minus: -expr
    if (current().type === TokenType.MINUS) {
      pos++;
      const operand = parseUnary();
      return { type: "UnaryExpression", operator: "-", operand };
    }
    // Logical NOT: !expr
    if (current().type === TokenType.BANG) {
      pos++;
      const operand = parseUnary();
      return { type: "UnaryExpression", operator: "!", operand };
    }
    // Bitwise NOT: ~expr
    if (current().type === TokenType.TILDE) {
      pos++;
      const operand = parseUnary();
      return { type: "UnaryExpression", operator: "~", operand };
    }
    // *expr (dereference)
    if (current().type === TokenType.STAR) {
      pos++;
      const operand = parseUnary();
      return { type: "DereferenceExpression", operand };
    }
    // &ident (address-of)
    if (current().type === TokenType.AMPERSAND) {
      pos++;
      const name = expect(TokenType.IDENTIFIER, "variable name after '&'").value;
      return { type: "AddressOfExpression", name };
    }
    // Prefix ++ident
    if (current().type === TokenType.PLUS_PLUS) {
      pos++;
      const name = expect(TokenType.IDENTIFIER, "variable name after '++'").value;
      return { type: "UpdateExpression", operator: "++", prefix: true, name };
    }
    // Prefix --ident
    if (current().type === TokenType.MINUS_MINUS) {
      pos++;
      const name = expect(TokenType.IDENTIFIER, "variable name after '--'").value;
      return { type: "UpdateExpression", operator: "--", prefix: true, name };
    }
    return parsePostfix();
  }

  /** postfix → primary ('++'  | '--')* */
  function parsePostfix(): Expression {
    let expr = parsePrimary();
    while (
      current().type === TokenType.PLUS_PLUS ||
      current().type === TokenType.MINUS_MINUS
    ) {
      // Only identifiers can be postfix-incremented
      if (expr.type !== "Identifier") {
        throw new Error(
          `Postfix ${current().value} requires a variable at line ${current().line}:${current().col}`
        );
      }
      const op = current().value as "++" | "--";
      pos++;
      expr = { type: "UpdateExpression", operator: op, prefix: false, name: expr.name };
    }
    return expr;
  }

  function parsePrimary(): Expression {
    const tok = current();

    if (tok.type === TokenType.NUMBER) {
      pos++;
      const raw = tok.value;
      const hasFloat = raw.endsWith("f") || raw.endsWith("F");
      const numStr = hasFloat ? raw.slice(0, -1) : raw;
      const isFloating = numStr.includes(".") || numStr.includes("e") || numStr.includes("E") || hasFloat;
      if (isFloating) {
        return { type: "FloatingLiteral", value: parseFloat(numStr), isFloat: hasFloat };
      }
      return { type: "IntegerLiteral", value: parseInt(numStr, 10) };
    }

    if (tok.type === TokenType.STRING) {
      pos++;
      return { type: "StringLiteral", value: tok.value };
    }

    if (tok.type === TokenType.CHAR_LITERAL) {
      pos++;
      return { type: "CharLiteral", value: parseInt(tok.value, 10) };
    }

    // sizeof(type)
    if (tok.type === TokenType.SIZEOF) {
      pos++;
      expect(TokenType.LPAREN, "'(' after sizeof");
      const targetType = parseTypeSpec();
      expect(TokenType.RPAREN, "')' after sizeof type");
      return { type: "SizeofExpression", targetType };
    }

    if (tok.type === TokenType.IDENTIFIER) {
      // Check if it's an enum constant
      if (enumConstants.has(tok.value)) {
        pos++;
        return { type: "IntegerLiteral", value: enumConstants.get(tok.value)! };
      }

      const name = tok.value;
      pos++;
      // Array access: ident[expr] with chaining for ident[expr][expr] and ident[expr].member
      if (current().type === TokenType.LBRACKET) {
        pos++; // skip [
        const index = parseExpression();
        expect(TokenType.RBRACKET, "']' after array index");
        let result: Expression = { type: "ArrayAccessExpression", array: name, index };
        // Chain additional [] accesses: matrix[i][j]
        while (current().type === TokenType.LBRACKET) {
          pos++; // skip [
          const nextIndex = parseExpression();
          expect(TokenType.RBRACKET, "']' after array index");
          result = { type: "ArrayAccessExpression", array: result, index: nextIndex };
        }
        // Chain member access after array: pts[i].x
        if (current().type === TokenType.DOT) {
          pos++; // skip .
          const member = expect(TokenType.IDENTIFIER, "member name after '.'").value;
          result = { type: "MemberAccessExpression", object: result, member };
        }
        // Chain arrow access after array: ptrs[i]->x
        if (current().type === TokenType.ARROW) {
          pos++; // skip ->
          const member = expect(TokenType.IDENTIFIER, "member name after '->'").value;
          result = { type: "ArrowAccessExpression", pointer: result as any, member };
        }
        return result;
      }
      // Member access: ident.member
      if (current().type === TokenType.DOT) {
        pos++; // skip .
        const member = expect(TokenType.IDENTIFIER, "member name after '.'").value;
        return { type: "MemberAccessExpression", object: name, member };
      }
      // Arrow access: ident->member
      if (current().type === TokenType.ARROW) {
        pos++; // skip ->
        const member = expect(TokenType.IDENTIFIER, "member name after '->'").value;
        return { type: "ArrowAccessExpression", pointer: name, member };
      }
      if (current().type === TokenType.LPAREN) {
        pos++;
        const args: Expression[] = [];
        if (current().type !== TokenType.RPAREN) {
          args.push(parseAssignment());
          while (current().type === TokenType.COMMA) {
            pos++;
            args.push(parseAssignment());
          }
        }
        expect(TokenType.RPAREN, "')' after function arguments");
        const indirect = funcPtrVars.has(name) || undefined;
        return { type: "CallExpression", callee: name, args, indirect };
      }
      return { type: "Identifier", name };
    }

    if (tok.type === TokenType.LPAREN) {
      // Lookahead: if ( type_keyword ) then it's a cast
      if (isTypeSpecAtPos(pos + 1)) {
        // Determine where RPAREN is after the type spec
        const isCast = isCastExpression();
        if (isCast) {
          pos++; // skip (
          const targetType = parseTypeSpec();
          expect(TokenType.RPAREN, "')' after cast type");
          const operand = parseUnary();
          return { type: "CastExpression", targetType, operand };
        }
      }
      pos++;
      const expr = parseExpression();
      expect(TokenType.RPAREN, "')'");
      return expr;
    }

    throw new Error(
      `Expected expression but got '${tok.value || tok.type}' at line ${tok.line}:${tok.col}`
    );
  }

  /** Check if position has a type specifier token */
  function isTypeSpecAtPos(p: number): boolean {
    const t = tokens[p].type;
    if (t === TokenType.INT || t === TokenType.VOID || t === TokenType.CHAR || t === TokenType.SHORT || t === TokenType.LONG || t === TokenType.FLOAT || t === TokenType.DOUBLE || t === TokenType.STRUCT || t === TokenType.ENUM || t === TokenType.UNION || t === TokenType.UNSIGNED || t === TokenType.SIGNED) return true;
    if (t === TokenType.IDENTIFIER && typedefs.has(tokens[p].value)) return true;
    return false;
  }

  /** Determine if current LPAREN starts a cast expression */
  function isCastExpression(): boolean {
    // We're at pos pointing to LPAREN, peek(1) is the type spec start
    const t = peek(1).type;
    if (t === TokenType.STRUCT || t === TokenType.UNION) {
      // (struct Name) or (union Name) — 4 tokens
      return peek(2).type === TokenType.IDENTIFIER && peek(3).type === TokenType.RPAREN;
    }
    if (t === TokenType.UNSIGNED || t === TokenType.SIGNED) {
      // (unsigned), (unsigned int), (unsigned char), (unsigned short)
      // (signed), (signed int), (signed char), (signed short), (signed long)
      if (peek(2).type === TokenType.RPAREN) return true;
      if ((peek(2).type === TokenType.INT || peek(2).type === TokenType.CHAR || peek(2).type === TokenType.SHORT || peek(2).type === TokenType.LONG) && peek(3).type === TokenType.RPAREN) return true;
      return false;
    }
    // Simple type: (int), (char), (short), (long), (float), (double), (void), or (typedef_name)
    return isTypeSpecAtPos(pos + 1) && peek(2).type === TokenType.RPAREN;
  }

  // ── Statement parsing ─────────────────────────────────

  /** Parse a block { ... } or a single statement */
  function parseBlockOrStatement(): Statement[] {
    if (current().type === TokenType.LBRACE) {
      pos++; // skip '{'
      const stmts: Statement[] = [];
      while (current().type !== TokenType.RBRACE && current().type !== TokenType.EOF) {
        stmts.push(parseStatement());
      }
      expect(TokenType.RBRACE, "'}'");
      return stmts;
    }
    return [parseStatement()];
  }

  function parseStatement(): Statement {
    // Consume qualifiers/storage classes before declarations
    if (isQualifierOrStorage(current().type)) {
      consumeQualifiers(); // qualifiers consumed and discarded at local scope
      // After consuming qualifiers, must be a declaration — fall through to detection below
    }

    // Struct variable declaration: struct Name varname;
    if (
      current().type === TokenType.STRUCT &&
      peek(1).type === TokenType.IDENTIFIER &&
      peek(2).type === TokenType.IDENTIFIER &&
      peek(3).type === TokenType.SEMICOLON
    ) {
      pos++; // skip struct
      const structName = expect(TokenType.IDENTIFIER, "struct name").value;
      const name = expect(TokenType.IDENTIFIER, "variable name").value;
      expect(TokenType.SEMICOLON, "';' after struct variable declaration");
      return { type: "StructVariableDeclaration", name, structName };
    }

    // Union variable declaration: union Name varname;
    if (
      current().type === TokenType.UNION &&
      peek(1).type === TokenType.IDENTIFIER &&
      peek(2).type === TokenType.IDENTIFIER &&
      peek(3).type === TokenType.SEMICOLON
    ) {
      pos++; // skip union
      const unionName = expect(TokenType.IDENTIFIER, "union name").value;
      const name = expect(TokenType.IDENTIFIER, "variable name").value;
      expect(TokenType.SEMICOLON, "';' after union variable declaration");
      return { type: "StructVariableDeclaration", name, structName: unionName };
    }

    // Pointer-to-struct variable: struct Name *varname = expr;
    if (
      current().type === TokenType.STRUCT &&
      peek(1).type === TokenType.IDENTIFIER &&
      peek(2).type === TokenType.STAR &&
      peek(3).type === TokenType.IDENTIFIER &&
      peek(4).type === TokenType.EQUALS
    ) {
      const typeSpec = parseTypeSpec(); // consumes struct + Name
      pos++; // skip *
      const name = expect(TokenType.IDENTIFIER, "variable name").value;
      expect(TokenType.EQUALS, "'=' in variable declaration");
      const initializer = parseExpression();
      expect(TokenType.SEMICOLON, "';' after variable declaration");
      return { type: "VariableDeclaration", name, typeSpec, initializer, pointer: true };
    }

    // Pointer-to-union variable: union Name *varname = expr;
    if (
      current().type === TokenType.UNION &&
      peek(1).type === TokenType.IDENTIFIER &&
      peek(2).type === TokenType.STAR &&
      peek(3).type === TokenType.IDENTIFIER &&
      peek(4).type === TokenType.EQUALS
    ) {
      const typeSpec = parseTypeSpec(); // consumes union + Name
      pos++; // skip *
      const name = expect(TokenType.IDENTIFIER, "variable name").value;
      expect(TokenType.EQUALS, "'=' in variable declaration");
      const initializer = parseExpression();
      expect(TokenType.SEMICOLON, "';' after variable declaration");
      return { type: "VariableDeclaration", name, typeSpec, initializer, pointer: true };
    }

    // Function pointer variable declaration: int (*fp)(int, int) = funcname;
    if (isTypeSpec() && peek(typeSpecLength()).type === TokenType.LPAREN && peek(typeSpecLength() + 1).type === TokenType.STAR) {
      const retType = parseTypeSpec();
      pos++; // skip (
      pos++; // skip *
      const name = expect(TokenType.IDENTIFIER, "function pointer name").value;
      expect(TokenType.RPAREN, "')' after function pointer name");
      const paramTypes = parseFuncPtrParamTypes();
      const fpType: FunctionPointerTypeSpecifier = { kind: "functionPointer", returnType: retType, paramTypes };
      funcPtrVars.add(name);
      let initializer: Expression;
      if (current().type === TokenType.EQUALS) {
        pos++;
        initializer = parseExpression();
      } else {
        initializer = { type: "IntegerLiteral", value: 0 };
      }
      expect(TokenType.SEMICOLON, "';' after function pointer declaration");
      return { type: "VariableDeclaration", name, typeSpec: fpType, initializer };
    }

    // Pointer variable declaration: int *p = expr;
    if (
      isTypeSpec() &&
      peek(typeSpecLength()).type === TokenType.STAR &&
      peek(typeSpecLength() + 1).type === TokenType.IDENTIFIER &&
      peek(typeSpecLength() + 2).type === TokenType.EQUALS
    ) {
      const typeSpec = parseTypeSpec();
      pos++; // skip '*'
      const name = expect(TokenType.IDENTIFIER, "variable name").value;
      expect(TokenType.EQUALS, "'=' in variable declaration");
      const initializer = parseExpression();
      expect(TokenType.SEMICOLON, "';' after variable declaration");
      return { type: "VariableDeclaration", name, typeSpec, initializer, pointer: true };
    }

    // Array declaration: int arr[5]; or int arr[3] = {1, 2, 3}; or int matrix[3][4]; or char name[] = "hello";
    if (
      isTypeSpec() &&
      peek(typeSpecLength()).type === TokenType.IDENTIFIER &&
      (peek(typeSpecLength() + 1).type === TokenType.LBRACKET)
    ) {
      const typeSpec = parseTypeSpec();
      const name = expect(TokenType.IDENTIFIER, "array name").value;
      // Parse dimensions: [N] or [N][M] or [] (empty for inferred size)
      const dimensions: number[] = [];
      let inferSize = false;
      expect(TokenType.LBRACKET, "'['");
      if (current().type === TokenType.RBRACKET) {
        // Empty brackets — size inferred from initializer: char name[] = "hello"
        inferSize = true;
        dimensions.push(0); // placeholder
      } else {
        const sizeTok = expect(TokenType.NUMBER, "array size");
        dimensions.push(parseInt(sizeTok.value, 10));
      }
      expect(TokenType.RBRACKET, "']'");
      // Additional dimensions: [M], [N], ...
      while (current().type === TokenType.LBRACKET) {
        pos++; // skip [
        const sizeTok = expect(TokenType.NUMBER, "array size");
        dimensions.push(parseInt(sizeTok.value, 10));
        expect(TokenType.RBRACKET, "']'");
      }
      const totalSize = dimensions.reduce((a, b) => a * b, 1);
      let initializer: (Expression | Expression[])[] | undefined;
      let stringInit: string | undefined;
      if (current().type === TokenType.EQUALS) {
        pos++; // skip =
        // char name[] = "hello" or char name[6] = "hello"
        if (current().type === TokenType.STRING) {
          stringInit = current().value;
          pos++;
          if (inferSize) {
            dimensions[0] = stringInit.length + 1; // +1 for null terminator
          }
        } else {
          expect(TokenType.LBRACE, "'{' for array initializer");
          initializer = [];
          if (current().type !== TokenType.RBRACE) {
            if (current().type === TokenType.LBRACE) {
              // Nested initializer: {{1,2},{3,4}}
              while (current().type === TokenType.LBRACE) {
                pos++; // skip inner {
                const inner: Expression[] = [];
                if (current().type !== TokenType.RBRACE) {
                  inner.push(parseAssignment());
                  while (current().type === TokenType.COMMA) {
                    pos++;
                    inner.push(parseAssignment());
                  }
                }
                expect(TokenType.RBRACE, "'}' after nested initializer");
                initializer.push(inner);
                if (current().type === TokenType.COMMA) pos++;
              }
            } else {
              // Flat initializer: {1, 2, 3}
              initializer.push(parseAssignment());
              while (current().type === TokenType.COMMA) {
                pos++;
                initializer.push(parseAssignment());
              }
            }
          }
          expect(TokenType.RBRACE, "'}' after array initializer");
          if (inferSize && initializer) {
            dimensions[0] = initializer.length;
          }
        }
      }
      const size = dimensions.reduce((a, b) => a * b, 1);
      expect(TokenType.SEMICOLON, "';' after array declaration");
      return { type: "ArrayDeclaration", name, typeSpec, size, dimensions, initializer, stringInit };
    }

    // Variable declaration: int x = expr;
    if (
      isTypeSpec() &&
      peek(typeSpecLength()).type === TokenType.IDENTIFIER &&
      peek(typeSpecLength() + 1).type === TokenType.EQUALS
    ) {
      const typeSpec = parseTypeSpec();
      // Consume any post-type qualifiers like `int const x = ...`
      while (isQualifierOrStorage(current().type)) pos++;
      const name = expect(TokenType.IDENTIFIER, "variable name").value;
      // Track function pointer variables (from typedef)
      if (typeof typeSpec === "object" && "kind" in typeSpec && typeSpec.kind === "functionPointer") {
        funcPtrVars.add(name);
      }
      expect(TokenType.EQUALS, "'=' in variable declaration");
      const initializer = parseExpression();
      expect(TokenType.SEMICOLON, "';' after variable declaration");
      return { type: "VariableDeclaration", name, typeSpec, initializer };
    }

    // Uninitialized variable declaration: int x;
    if (
      isTypeSpec() &&
      peek(typeSpecLength()).type === TokenType.IDENTIFIER &&
      peek(typeSpecLength() + 1).type === TokenType.SEMICOLON
    ) {
      const typeSpec = parseTypeSpec();
      while (isQualifierOrStorage(current().type)) pos++;
      const name = expect(TokenType.IDENTIFIER, "variable name").value;
      if (typeof typeSpec === "object" && "kind" in typeSpec && typeSpec.kind === "functionPointer") {
        funcPtrVars.add(name);
      }
      expect(TokenType.SEMICOLON, "';' after variable declaration");
      // Synthesize a zero initializer
      const initializer: Expression = (typeSpec === "float")
        ? { type: "FloatingLiteral", value: 0, isFloat: true }
        : (typeSpec === "double")
        ? { type: "FloatingLiteral", value: 0, isFloat: false }
        : { type: "IntegerLiteral", value: 0 };
      return { type: "VariableDeclaration", name, typeSpec, initializer };
    }

    // Return statement
    if (current().type === TokenType.RETURN) {
      pos++;
      const expression = parseExpression();
      expect(TokenType.SEMICOLON, "';' after return statement");
      return { type: "ReturnStatement", expression };
    }

    // If statement
    if (current().type === TokenType.IF) {
      pos++;
      expect(TokenType.LPAREN, "'(' after 'if'");
      const condition = parseExpression();
      expect(TokenType.RPAREN, "')' after if condition");
      const consequent = parseBlockOrStatement();
      let alternate: Statement[] | null = null;
      if (current().type === TokenType.ELSE) {
        pos++;
        alternate = parseBlockOrStatement();
      }
      return { type: "IfStatement", condition, consequent, alternate };
    }

    // While statement
    if (current().type === TokenType.WHILE) {
      pos++;
      expect(TokenType.LPAREN, "'(' after 'while'");
      const condition = parseExpression();
      expect(TokenType.RPAREN, "')' after while condition");
      const body = parseBlockOrStatement();
      return { type: "WhileStatement", condition, body };
    }

    // Do-while statement: do { ... } while (cond);
    if (current().type === TokenType.DO) {
      pos++;
      const body = parseBlockOrStatement();
      expect(TokenType.WHILE, "'while' after do body");
      expect(TokenType.LPAREN, "'(' after 'while' in do-while");
      const condition = parseExpression();
      expect(TokenType.RPAREN, "')' after do-while condition");
      expect(TokenType.SEMICOLON, "';' after do-while");
      return { type: "DoWhileStatement", condition, body };
    }

    // For statement: for (init; condition; update) body
    if (current().type === TokenType.FOR) {
      pos++;
      expect(TokenType.LPAREN, "'(' after 'for'");

      // init: var decl or expr stmt (both end with ;)
      let init: Statement;
      if (
        isTypeSpec() &&
        peek(typeSpecLength()).type === TokenType.IDENTIFIER &&
        peek(typeSpecLength() + 1).type === TokenType.EQUALS
      ) {
        const typeSpec = parseTypeSpec();
        const name = expect(TokenType.IDENTIFIER, "variable name").value;
        expect(TokenType.EQUALS, "'='");
        const initializer = parseExpression();
        expect(TokenType.SEMICOLON, "';' after for init");
        init = { type: "VariableDeclaration", name, typeSpec, initializer };
      } else {
        const expression = parseExpression();
        expect(TokenType.SEMICOLON, "';' after for init");
        init = { type: "ExpressionStatement", expression };
      }

      const condition = parseExpression();
      expect(TokenType.SEMICOLON, "';' after for condition");
      const update = parseExpression();
      expect(TokenType.RPAREN, "')' after for update");
      const body = parseBlockOrStatement();
      return { type: "ForStatement", init, condition, update, body };
    }

    // Break statement
    if (current().type === TokenType.BREAK) {
      pos++;
      expect(TokenType.SEMICOLON, "';' after 'break'");
      return { type: "BreakStatement" };
    }

    // Continue statement
    if (current().type === TokenType.CONTINUE) {
      pos++;
      expect(TokenType.SEMICOLON, "';' after 'continue'");
      return { type: "ContinueStatement" };
    }

    // Goto statement
    if (current().type === TokenType.GOTO) {
      pos++;
      const label = expect(TokenType.IDENTIFIER, "label name after 'goto'").value;
      expect(TokenType.SEMICOLON, "';' after goto");
      return { type: "GotoStatement", label };
    }

    // Labeled statement: ident ':' statement
    // At statement level, ident followed by ':' is always a label (not ternary)
    if (current().type === TokenType.IDENTIFIER && peek(1).type === TokenType.COLON) {
      const label = current().value;
      pos += 2; // skip ident and ':'
      const body = parseStatement();
      return { type: "LabeledStatement", label, body };
    }

    // Switch statement
    if (current().type === TokenType.SWITCH) {
      pos++;
      expect(TokenType.LPAREN, "'(' after 'switch'");
      const discriminant = parseExpression();
      expect(TokenType.RPAREN, "')' after switch expression");
      expect(TokenType.LBRACE, "'{' after switch");
      const cases: Array<{ value: Expression | null; body: Statement[] }> = [];
      while (current().type !== TokenType.RBRACE) {
        if (current().type === TokenType.CASE) {
          pos++;
          const value = parseExpression();
          expect(TokenType.COLON, "':' after case value");
          const body: Statement[] = [];
          while (
            current().type !== TokenType.CASE &&
            current().type !== TokenType.DEFAULT &&
            current().type !== TokenType.RBRACE
          ) {
            body.push(parseStatement());
          }
          cases.push({ value, body });
        } else if (current().type === TokenType.DEFAULT) {
          pos++;
          expect(TokenType.COLON, "':' after 'default'");
          const body: Statement[] = [];
          while (
            current().type !== TokenType.CASE &&
            current().type !== TokenType.DEFAULT &&
            current().type !== TokenType.RBRACE
          ) {
            body.push(parseStatement());
          }
          cases.push({ value: null, body });
        } else {
          throw new Error(`Expected 'case' or 'default' in switch body, got '${current().value}'`);
        }
      }
      expect(TokenType.RBRACE, "'}' after switch body");
      return { type: "SwitchStatement", discriminant, cases };
    }

    // Expression statement
    const expression = parseExpression();
    expect(TokenType.SEMICOLON, "';' after expression statement");
    return { type: "ExpressionStatement", expression };
  }

  // ── Top-level parsing ─────────────────────────────────

  /**
   * Parse function pointer parameter type list: (int, int)
   * Called after consuming `returnType (*name)`
   */
  function parseFuncPtrParamTypes(): TypeSpecifier[] {
    expect(TokenType.LPAREN, "'(' for function pointer param types");
    const types: TypeSpecifier[] = [];
    if (current().type !== TokenType.RPAREN) {
      types.push(parseTypeSpec());
      // Skip optional * in param types
      if (current().type === TokenType.STAR) pos++;
      // Skip optional param name
      if (current().type === TokenType.IDENTIFIER) pos++;
      while (current().type === TokenType.COMMA) {
        pos++;
        types.push(parseTypeSpec());
        if (current().type === TokenType.STAR) pos++;
        if (current().type === TokenType.IDENTIFIER) pos++;
      }
    }
    expect(TokenType.RPAREN, "')' after function pointer param types");
    return types;
  }

  /**
   * Check if current position starts a function pointer declaration: type (*name)(...)
   * Must be called AFTER consuming type specifier at the current position.
   * Lookahead: ( * identifier )
   */
  function isFuncPtrDeclAhead(): boolean {
    if (current().type !== TokenType.LPAREN) return false;
    return peek(1).type === TokenType.STAR && peek(2).type === TokenType.IDENTIFIER && peek(3).type === TokenType.RPAREN;
  }

  /** Parse one parameter, handling optional `*` for pointer types and function pointer params */
  function parseOneParam(): Parameter {
    const typeSpec = parseTypeSpec();

    // Function pointer parameter: int (*op)(int, int)
    if (isFuncPtrDeclAhead()) {
      pos++; // skip (
      pos++; // skip *
      const name = expect(TokenType.IDENTIFIER, "parameter name").value;
      expect(TokenType.RPAREN, "')' after function pointer name");
      const paramTypes = parseFuncPtrParamTypes();
      const fpType: FunctionPointerTypeSpecifier = { kind: "functionPointer", returnType: typeSpec, paramTypes };
      funcPtrVars.add(name);
      return { type: "Parameter", name, typeSpec: fpType, pointer: false };
    }

    // Skip optional * for pointer params (int *p) — treated as i32 at WASM level
    let pointer = false;
    if (current().type === TokenType.STAR) { pos++; pointer = true; }
    const name = expect(TokenType.IDENTIFIER, "parameter name").value;
    return { type: "Parameter", name, typeSpec, pointer };
  }

  function parseParamList(): Parameter[] {
    const params: Parameter[] = [];
    if (current().type === TokenType.RPAREN) return params;
    params.push(parseOneParam());
    while (current().type === TokenType.COMMA) {
      pos++;
      params.push(parseOneParam());
    }
    return params;
  }

  /** Parse struct/union fields, skipping optional * for pointer fields */
  function parseFields(): { name: string; typeSpec: TypeSpecifier }[] {
    const fields: { name: string; typeSpec: TypeSpecifier }[] = [];
    while (current().type !== TokenType.RBRACE && current().type !== TokenType.EOF) {
      const fieldType = parseTypeSpec();
      // Skip optional * for pointer fields (struct Node *next;)
      if (current().type === TokenType.STAR) pos++;
      const fieldName = expect(TokenType.IDENTIFIER, "field name").value;
      expect(TokenType.SEMICOLON, "';' after field declaration");
      fields.push({ name: fieldName, typeSpec: fieldType });
    }
    return fields;
  }

  /** Parse a struct type definition: struct Name { type field; ... }; */
  function parseStructDeclaration(): Declaration {
    pos++; // skip 'struct'
    const name = expect(TokenType.IDENTIFIER, "struct name").value;
    expect(TokenType.LBRACE, "'{' after struct name");
    const fields = parseFields();
    expect(TokenType.RBRACE, "'}' after struct fields");
    expect(TokenType.SEMICOLON, "';' after struct declaration");
    return { type: "StructDeclaration", name, fields };
  }

  /** Parse a union type definition: union Name { type field; ... }; */
  function parseUnionDeclaration(): Declaration {
    pos++; // skip 'union'
    const name = expect(TokenType.IDENTIFIER, "union name").value;
    expect(TokenType.LBRACE, "'{' after union name");
    const fields = parseFields();
    expect(TokenType.RBRACE, "'}' after union fields");
    expect(TokenType.SEMICOLON, "';' after union declaration");
    return { type: "UnionDeclaration", name, fields };
  }

  /** Parse an enum declaration: enum Name { A, B = 5, C }; */
  function parseEnumDeclaration(): Declaration {
    pos++; // skip 'enum'
    let name: string | null = null;
    if (current().type === TokenType.IDENTIFIER && peek(1).type === TokenType.LBRACE) {
      name = current().value;
      pos++;
    }
    expect(TokenType.LBRACE, "'{' after enum");
    const members: { name: string; value: number }[] = [];
    let nextValue = 0;
    while (current().type !== TokenType.RBRACE && current().type !== TokenType.EOF) {
      const memberName = expect(TokenType.IDENTIFIER, "enum member name").value;
      if (current().type === TokenType.EQUALS) {
        pos++;
        const valTok = expect(TokenType.NUMBER, "enum value");
        nextValue = parseInt(valTok.value, 10);
      }
      members.push({ name: memberName, value: nextValue });
      enumConstants.set(memberName, nextValue);
      nextValue++;
      if (current().type === TokenType.COMMA) pos++;
    }
    expect(TokenType.RBRACE, "'}' after enum members");
    expect(TokenType.SEMICOLON, "';' after enum declaration");
    return { type: "EnumDeclaration", name, members };
  }

  /** Parse a typedef: typedef type alias; or typedef type (*alias)(params); */
  function parseTypedef(): Declaration | null {
    pos++; // skip 'typedef'
    const baseType = parseTypeSpec();

    // Function pointer typedef: typedef int (*Name)(int, int);
    if (current().type === TokenType.LPAREN && peek(1).type === TokenType.STAR) {
      pos++; // skip (
      pos++; // skip *
      const aliasName = expect(TokenType.IDENTIFIER, "typedef alias name").value;
      expect(TokenType.RPAREN, "')' after function pointer typedef name");
      const paramTypes = parseFuncPtrParamTypes();
      const fpType: FunctionPointerTypeSpecifier = { kind: "functionPointer", returnType: baseType, paramTypes };
      typedefs.set(aliasName, fpType);
      expect(TokenType.SEMICOLON, "';' after typedef");
      return null;
    }

    // Optional pointer
    if (current().type === TokenType.STAR) pos++;
    const aliasName = expect(TokenType.IDENTIFIER, "typedef alias name").value;
    expect(TokenType.SEMICOLON, "';' after typedef");
    typedefs.set(aliasName, baseType);
    return null; // typedef doesn't produce an AST declaration
  }

  /** Parse a top-level declaration: function, extern, global variable, struct, enum, union, typedef */
  function parseTopLevelDecl(): Declaration | null {
    // Consume leading qualifiers/storage classes
    const quals = consumeQualifiers();

    // Struct definition: struct Name { ... };
    if (current().type === TokenType.STRUCT && peek(1).type === TokenType.IDENTIFIER && peek(2).type === TokenType.LBRACE) {
      return parseStructDeclaration();
    }

    // Union definition: union Name { ... };
    if (current().type === TokenType.UNION && peek(1).type === TokenType.IDENTIFIER && peek(2).type === TokenType.LBRACE) {
      return parseUnionDeclaration();
    }

    // Enum definition: enum Name { ... };
    if (current().type === TokenType.ENUM && (peek(1).type === TokenType.LBRACE || (peek(1).type === TokenType.IDENTIFIER && peek(2).type === TokenType.LBRACE))) {
      return parseEnumDeclaration();
    }

    // Typedef
    if (current().type === TokenType.TYPEDEF) {
      return parseTypedef();
    }

    const typeSpec = parseTypeSpec();

    // Skip optional * for pointer types at top level
    if (current().type === TokenType.STAR) pos++;

    const name = expect(TokenType.IDENTIFIER, "declaration name").value;

    // Global variable: type ident = expr;
    if (current().type === TokenType.EQUALS) {
      pos++; // skip =
      const initializer = parseExpression();
      expect(TokenType.SEMICOLON, "';' after global variable declaration");
      return { type: "GlobalVariableDeclaration", name, typeSpec, initializer, isStatic: quals.isStatic || undefined, isConst: quals.isConst || undefined };
    }

    // Extern variable or uninitialized global: type ident;
    if (current().type === TokenType.SEMICOLON) {
      pos++;
      if (quals.isExtern) return null; // extern variable declaration — skip
      // Uninitialized global variable
      const initializer: Expression = { type: "IntegerLiteral", value: 0 };
      return { type: "GlobalVariableDeclaration", name, typeSpec, initializer, isStatic: quals.isStatic || undefined, isConst: quals.isConst || undefined };
    }

    // Function or extern: type ident(...)
    expect(TokenType.LPAREN, "'(' or '=' after declaration name");
    const params = parseParamList();
    expect(TokenType.RPAREN, "')'");

    // Function prototype ending with ';' (no body)
    if (current().type === TokenType.SEMICOLON) {
      pos++;
      if (quals.isExtern) {
        return { type: "ExternFunctionDeclaration", name, returnType: typeSpec, params };
      }
      // Forward declaration (non-extern prototype)
      return { type: "ForwardDeclaration", name, returnType: typeSpec, params };
    }

    expect(TokenType.LBRACE, "'{'");
    const body: Statement[] = [];
    while (current().type !== TokenType.RBRACE && current().type !== TokenType.EOF) {
      body.push(parseStatement());
    }
    expect(TokenType.RBRACE, "'}'");
    return { type: "FunctionDeclaration", name, returnType: typeSpec, params, body, isStatic: quals.isStatic || undefined };
  }

  function parseProgram(): Program {
    const declarations: Declaration[] = [];
    while (current().type !== TokenType.EOF) {
      const decl = parseTopLevelDecl();
      if (decl !== null) declarations.push(decl);
    }
    return { type: "Program", declarations };
  }

  return parseProgram();
}
