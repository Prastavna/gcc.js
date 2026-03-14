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
} from "./types.ts";

/**
 * Recursive descent parser with precedence climbing for expressions.
 *
 * Grammar (Milestone 5):
 *   program        → function_decl*
 *   function_decl  → type_spec IDENTIFIER '(' param_list? ')' '{' statement* '}'
 *   param_list     → param (',' param)*
 *   param          → type_spec IDENTIFIER
 *   type_spec      → 'int' | 'void'
 *   statement      → var_decl | return_stmt | if_stmt | while_stmt | for_stmt
 *                   | block | expr_stmt
 *   var_decl       → type_spec IDENTIFIER '=' expression ';'
 *   return_stmt    → 'return' expression ';'
 *   if_stmt        → 'if' '(' expression ')' block_or_stmt ('else' block_or_stmt)?
 *   while_stmt     → 'while' '(' expression ')' block_or_stmt
 *   for_stmt       → 'for' '(' (var_decl | expr_stmt) expression ';' expression ')' block_or_stmt
 *   block_or_stmt  → '{' statement* '}' | statement
 *   expr_stmt      → expression ';'
 *   expression     → assignment
 *   assignment     → IDENTIFIER '=' assignment | comparison
 *   comparison     → additive (('==' | '!=' | '<' | '>' | '<=' | '>=') additive)*
 *   additive       → multiplicative (('+' | '-') multiplicative)*
 *   multiplicative → unary (('*' | '/' | '%') unary)*
 *   unary          → '-' unary | primary
 *   primary        → NUMBER | IDENTIFIER '(' arg_list? ')' | IDENTIFIER | '(' expression ')'
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
    return current().type === TokenType.INT || current().type === TokenType.VOID;
  }

  function parseTypeSpec(): TypeSpecifier {
    const tok = current();
    if (tok.type === TokenType.INT) { pos++; return "int"; }
    if (tok.type === TokenType.VOID) { pos++; return "void"; }
    throw new Error(
      `Expected type specifier (int/void) but got '${tok.value || tok.type}' at line ${tok.line}:${tok.col}`
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

    // ident = val
    if (
      current().type === TokenType.IDENTIFIER &&
      peek(1).type === TokenType.EQUALS
    ) {
      const name = current().value;
      pos += 2;
      const value = parseAssignment();
      return { type: "AssignmentExpression", name, value };
    }
    return parseComparison();
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
    if (current().type === TokenType.MINUS) {
      pos++;
      const operand = parseUnary();
      return { type: "UnaryExpression", operator: "-", operand };
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
    return parsePrimary();
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

    if (tok.type === TokenType.IDENTIFIER) {
      const name = tok.value;
      pos++;
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
      pos++;
      const expr = parseExpression();
      expect(TokenType.RPAREN, "')'");
      return expr;
    }

    throw new Error(
      `Expected expression but got '${tok.value || tok.type}' at line ${tok.line}:${tok.col}`
    );
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
      return { type: "VariableDeclaration", name, typeSpec, initializer };
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
    if (current().type === TokenType.STAR) pos++;
    const name = expect(TokenType.IDENTIFIER, "parameter name").value;
    return { type: "Parameter", name, typeSpec };
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

  function parseFunctionDecl(): Declaration {
    const returnType = parseTypeSpec();
    const name = expect(TokenType.IDENTIFIER, "function name").value;
    expect(TokenType.LPAREN, "'('");
    const params = parseParamList();
    expect(TokenType.RPAREN, "')'");

    // Extern function declaration: ends with ';' (no body)
    if (current().type === TokenType.SEMICOLON) {
      pos++;
      return { type: "ExternFunctionDeclaration", name, returnType, params };
    }

    expect(TokenType.LBRACE, "'{'");
    const body: Statement[] = [];
    while (current().type !== TokenType.RBRACE && current().type !== TokenType.EOF) {
      body.push(parseStatement());
    }
    expect(TokenType.RBRACE, "'}'");
    return { type: "FunctionDeclaration", name, returnType, params, body };
  }

  function parseProgram(): Program {
    const declarations: Declaration[] = [];
    while (current().type !== TokenType.EOF) {
      declarations.push(parseFunctionDecl());
    }
    return { type: "Program", declarations };
  }

  return parseProgram();
}
