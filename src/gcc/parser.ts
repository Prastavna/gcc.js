import { TokenType } from "./types.ts";
import type {
  Token,
  Program,
  Declaration,
  Parameter,
  Statement,
  Expression,
  TypeSpecifier,
  BinaryOperator,
  ComparisonOperator,
  LogicalOperator,
  CompoundAssignmentOperator,
} from "./types.ts";

/**
 * Recursive descent parser with precedence climbing for expressions.
 *
 * Grammar (Phase 2 — Milestone 8):
 *   program        → declaration*
 *   declaration    → extern_decl | function_decl
 *   extern_decl    → type_spec IDENTIFIER '(' param_list? ')' ';'
 *   function_decl  → type_spec IDENTIFIER '(' param_list? ')' '{' statement* '}'
 *   param_list     → param (',' param)*
 *   param          → type_spec '*'? IDENTIFIER
 *   type_spec      → 'int' | 'void'
 *
 *   statement      → var_decl | return_stmt | if_stmt | while_stmt | for_stmt
 *                  | block | expr_stmt
 *   var_decl       → type_spec '*'? IDENTIFIER '=' expression ';'
 *   return_stmt    → 'return' expression ';'
 *   if_stmt        → 'if' '(' expression ')' block_or_stmt ('else' block_or_stmt)?
 *   while_stmt     → 'while' '(' expression ')' block_or_stmt
 *   for_stmt       → 'for' '(' (var_decl | expr_stmt) expression ';' expression ')' block_or_stmt
 *   block_or_stmt  → '{' statement* '}' | statement
 *   expr_stmt      → expression ';'
 *
 *   expression     → assignment
 *   assignment     → '*' unary '=' assignment
 *                  | IDENTIFIER '=' assignment
 *                  | IDENTIFIER compound_op assignment
 *                  | ternary
 *   compound_op    → '+=' | '-=' | '*=' | '/=' | '%='
 *   ternary        → logical_or ('?' expression ':' ternary)?
 *   logical_or     → logical_and ('||' logical_and)*
 *   logical_and    → comparison ('&&' comparison)*
 *   comparison     → additive (('==' | '!=' | '<' | '>' | '<=' | '>=') additive)*
 *   additive       → multiplicative (('+' | '-') multiplicative)*
 *   multiplicative → unary (('*' | '/' | '%') unary)*
 *   unary          → '-' unary | '!' unary | '*' unary | '&' IDENTIFIER
 *                  | '++' IDENTIFIER | '--' IDENTIFIER | postfix
 *   postfix        → primary ('++'  | '--')*
 *   primary        → NUMBER | STRING | IDENTIFIER '(' arg_list? ')' | IDENTIFIER
 *                  | '(' expression ')'
 *   arg_list       → expression (',' expression)*
 */
export function parse(tokens: Token[]): Program {
  let pos = 0;

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

  function isTypeSpec(): boolean {
    const t = current().type;
    return t === TokenType.INT || t === TokenType.VOID || t === TokenType.CHAR || t === TokenType.LONG || t === TokenType.STRUCT;
  }

  function parseTypeSpec(): TypeSpecifier {
    const tok = current();
    if (tok.type === TokenType.INT) { pos++; return "int"; }
    if (tok.type === TokenType.VOID) { pos++; return "void"; }
    if (tok.type === TokenType.CHAR) { pos++; return "char"; }
    if (tok.type === TokenType.LONG) { pos++; return "long"; }
    if (tok.type === TokenType.STRUCT) {
      pos++;
      const name = expect(TokenType.IDENTIFIER, "struct name").value;
      return { kind: "struct", name };
    }
    throw new Error(
      `Expected type specifier (int/void/char/long/struct) but got '${tok.value || tok.type}' at line ${tok.line}:${tok.col}`
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
    return parseAssignment();
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

      // Array index assignment: ident[expr] = val
      if (nextTok.type === TokenType.LBRACKET) {
        const savedPos = pos;
        const name = current().value;
        pos += 2; // skip ident and [
        const index = parseExpression();
        expect(TokenType.RBRACKET, "']' after array index");
        if (current().type === TokenType.EQUALS) {
          pos++; // skip =
          const value = parseAssignment();
          return { type: "ArrayIndexAssignment", array: name, index, value };
        }
        // Not an assignment — backtrack and let normal expression parsing handle it
        pos = savedPos;
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

  /** logical_and → comparison ('&&' comparison)* */
  function parseLogicalAnd(): Expression {
    let left = parseComparison();
    while (current().type === TokenType.AND_AND) {
      const op = current().value as LogicalOperator;
      pos++;
      const right = parseComparison();
      left = { type: "LogicalExpression", operator: op, left, right };
    }
    return left;
  }

  /** comparison → additive (('==' | '!=' | '<' | '>' | '<=' | '>=') additive)* */
  function parseComparison(): Expression {
    let left = parseAdditive();
    while (isComparisonOp()) {
      const op = current().value as ComparisonOperator;
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
      return { type: "IntegerLiteral", value: parseInt(tok.value, 10) };
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
      const name = tok.value;
      pos++;
      // Array access: ident[expr]
      if (current().type === TokenType.LBRACKET) {
        pos++; // skip [
        const index = parseExpression();
        expect(TokenType.RBRACKET, "']' after array index");
        return { type: "ArrayAccessExpression", array: name, index };
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
          args.push(parseExpression());
          while (current().type === TokenType.COMMA) {
            pos++;
            args.push(parseExpression());
          }
        }
        expect(TokenType.RPAREN, "')' after function arguments");
        return { type: "CallExpression", callee: name, args };
      }
      return { type: "Identifier", name };
    }

    if (tok.type === TokenType.LPAREN) {
      // Lookahead: if ( type_keyword ) then it's a cast
      // For struct: (struct Name) is 4 tokens: ( struct Name )
      if (isTypeSpecToken(peek(1).type)) {
        const isCast = peek(1).type === TokenType.STRUCT
          ? peek(2).type === TokenType.IDENTIFIER && peek(3).type === TokenType.RPAREN
          : peek(2).type === TokenType.RPAREN;
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

  function isTypeSpecToken(t: TokenType): boolean {
    return t === TokenType.INT || t === TokenType.VOID || t === TokenType.CHAR || t === TokenType.LONG || t === TokenType.STRUCT;
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

    // Pointer variable declaration: int *p = expr;
    if (
      isTypeSpec() &&
      peek(1).type === TokenType.STAR &&
      peek(2).type === TokenType.IDENTIFIER &&
      peek(3).type === TokenType.EQUALS
    ) {
      const typeSpec = parseTypeSpec();
      pos++; // skip '*'
      const name = expect(TokenType.IDENTIFIER, "variable name").value;
      expect(TokenType.EQUALS, "'=' in variable declaration");
      const initializer = parseExpression();
      expect(TokenType.SEMICOLON, "';' after variable declaration");
      return { type: "VariableDeclaration", name, typeSpec, initializer, pointer: true };
    }

    // Array declaration: int arr[5]; or int arr[3] = {1, 2, 3};
    if (
      isTypeSpec() &&
      peek(1).type === TokenType.IDENTIFIER &&
      peek(2).type === TokenType.LBRACKET
    ) {
      const typeSpec = parseTypeSpec();
      const name = expect(TokenType.IDENTIFIER, "array name").value;
      expect(TokenType.LBRACKET, "'['");
      const sizeTok = expect(TokenType.NUMBER, "array size");
      const size = parseInt(sizeTok.value, 10);
      expect(TokenType.RBRACKET, "']'");
      let initializer: Expression[] | undefined;
      if (current().type === TokenType.EQUALS) {
        pos++; // skip =
        expect(TokenType.LBRACE, "'{' for array initializer");
        initializer = [];
        if (current().type !== TokenType.RBRACE) {
          initializer.push(parseExpression());
          while (current().type === TokenType.COMMA) {
            pos++;
            initializer.push(parseExpression());
          }
        }
        expect(TokenType.RBRACE, "'}' after array initializer");
      }
      expect(TokenType.SEMICOLON, "';' after array declaration");
      return { type: "ArrayDeclaration", name, typeSpec, size, initializer };
    }

    // Variable declaration: int x = expr;
    if (
      isTypeSpec() &&
      peek(1).type === TokenType.IDENTIFIER &&
      peek(2).type === TokenType.EQUALS
    ) {
      const typeSpec = parseTypeSpec();
      const name = expect(TokenType.IDENTIFIER, "variable name").value;
      expect(TokenType.EQUALS, "'=' in variable declaration");
      const initializer = parseExpression();
      expect(TokenType.SEMICOLON, "';' after variable declaration");
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

    // For statement: for (init; condition; update) body
    if (current().type === TokenType.FOR) {
      pos++;
      expect(TokenType.LPAREN, "'(' after 'for'");

      // init: var decl or expr stmt (both end with ;)
      let init: Statement;
      if (
        isTypeSpec() &&
        peek(1).type === TokenType.IDENTIFIER &&
        peek(2).type === TokenType.EQUALS
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

  /** Parse one parameter, handling optional `*` for pointer types */
  function parseOneParam(): Parameter {
    const typeSpec = parseTypeSpec();
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

  /** Parse a struct type definition: struct Name { type field; ... }; */
  function parseStructDeclaration(): Declaration {
    pos++; // skip 'struct'
    const name = expect(TokenType.IDENTIFIER, "struct name").value;
    expect(TokenType.LBRACE, "'{' after struct name");
    const fields: { name: string; typeSpec: TypeSpecifier }[] = [];
    while (current().type !== TokenType.RBRACE && current().type !== TokenType.EOF) {
      const fieldType = parseTypeSpec();
      const fieldName = expect(TokenType.IDENTIFIER, "field name").value;
      expect(TokenType.SEMICOLON, "';' after field declaration");
      fields.push({ name: fieldName, typeSpec: fieldType });
    }
    expect(TokenType.RBRACE, "'}' after struct fields");
    expect(TokenType.SEMICOLON, "';' after struct declaration");
    return { type: "StructDeclaration", name, fields };
  }

  /** Parse a top-level declaration: function, extern, global variable, or struct */
  function parseTopLevelDecl(): Declaration {
    // Struct definition: struct Name { ... };
    if (current().type === TokenType.STRUCT && peek(1).type === TokenType.IDENTIFIER && peek(2).type === TokenType.LBRACE) {
      return parseStructDeclaration();
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
      return { type: "GlobalVariableDeclaration", name, typeSpec, initializer };
    }

    // Function or extern: type ident(...)
    expect(TokenType.LPAREN, "'(' or '=' after declaration name");
    const params = parseParamList();
    expect(TokenType.RPAREN, "')'");

    // Extern function declaration: ends with ';' (no body)
    if (current().type === TokenType.SEMICOLON) {
      pos++;
      return { type: "ExternFunctionDeclaration", name, returnType: typeSpec, params };
    }

    expect(TokenType.LBRACE, "'{'");
    const body: Statement[] = [];
    while (current().type !== TokenType.RBRACE && current().type !== TokenType.EOF) {
      body.push(parseStatement());
    }
    expect(TokenType.RBRACE, "'}'");
    return { type: "FunctionDeclaration", name, returnType: typeSpec, params, body };
  }

  function parseProgram(): Program {
    const declarations: Declaration[] = [];
    while (current().type !== TokenType.EOF) {
      declarations.push(parseTopLevelDecl());
    }
    return { type: "Program", declarations };
  }

  return parseProgram();
}
