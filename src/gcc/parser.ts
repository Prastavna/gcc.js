import { TokenType } from "./types.ts";
import type {
  Token,
  Program,
  FunctionDeclaration,
  Statement,
  Expression,
  TypeSpecifier,
  BinaryOperator,
} from "./types.ts";

/**
 * Recursive descent parser with precedence climbing for expressions.
 *
 * Grammar (Milestone 3):
 *   program        → function_decl*
 *   function_decl  → type_spec IDENTIFIER '(' ')' '{' statement* '}'
 *   type_spec      → 'int' | 'void'
 *   statement      → var_decl | return_stmt | expr_stmt
 *   var_decl       → type_spec IDENTIFIER '=' expression ';'
 *   return_stmt    → 'return' expression ';'
 *   expr_stmt      → expression ';'          (for assignments like x = 5;)
 *   expression     → assignment
 *   assignment     → IDENTIFIER '=' assignment | additive
 *   additive       → multiplicative (('+' | '-') multiplicative)*
 *   multiplicative → unary (('*' | '/' | '%') unary)*
 *   unary          → '-' unary | primary
 *   primary        → NUMBER | IDENTIFIER | '(' expression ')'
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
    if (tok.type === TokenType.INT) {
      pos++;
      return "int";
    }
    if (tok.type === TokenType.VOID) {
      pos++;
      return "void";
    }
    throw new Error(
      `Expected type specifier (int/void) but got '${tok.value || tok.type}' at line ${tok.line}:${tok.col}`
    );
  }

  // ── Expression parsing (precedence climbing) ───────────

  function parseExpression(): Expression {
    return parseAssignment();
  }

  /**
   * assignment → IDENTIFIER '=' assignment | additive
   *
   * We check if the current token is IDENTIFIER followed by '='.
   * If so, parse as assignment. Otherwise fall through to additive.
   */
  function parseAssignment(): Expression {
    if (
      current().type === TokenType.IDENTIFIER &&
      peek(1).type === TokenType.EQUALS
    ) {
      const name = current().value;
      pos += 2; // skip identifier and '='
      const value = parseAssignment(); // right-associative
      return { type: "AssignmentExpression", name, value };
    }
    return parseAdditive();
  }

  /** additive → multiplicative (('+' | '-') multiplicative)* */
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

  /** multiplicative → unary (('*' | '/' | '%') unary)* */
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

  /** unary → '-' unary | primary */
  function parseUnary(): Expression {
    if (current().type === TokenType.MINUS) {
      pos++;
      const operand = parseUnary();
      return { type: "UnaryExpression", operator: "-", operand };
    }
    return parsePrimary();
  }

  /** primary → NUMBER | IDENTIFIER | '(' expression ')' */
  function parsePrimary(): Expression {
    const tok = current();

    if (tok.type === TokenType.NUMBER) {
      pos++;
      return { type: "IntegerLiteral", value: parseInt(tok.value, 10) };
    }

    if (tok.type === TokenType.IDENTIFIER) {
      pos++;
      return { type: "Identifier", name: tok.value };
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

  // ── Statement & declaration parsing ────────────────────

  function parseStatement(): Statement {
    // Variable declaration: int x = expr;
    if (isTypeSpec() && peek(1).type === TokenType.IDENTIFIER) {
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

    // Expression statement (e.g. x = 5;)
    const expression = parseExpression();
    expect(TokenType.SEMICOLON, "';' after expression statement");
    return { type: "ExpressionStatement", expression };
  }

  function parseFunctionDecl(): FunctionDeclaration {
    const returnType = parseTypeSpec();
    const name = expect(TokenType.IDENTIFIER, "function name").value;
    expect(TokenType.LPAREN, "'('");
    expect(TokenType.RPAREN, "')'");
    expect(TokenType.LBRACE, "'{'");

    const body: Statement[] = [];
    while (current().type !== TokenType.RBRACE && current().type !== TokenType.EOF) {
      body.push(parseStatement());
    }

    expect(TokenType.RBRACE, "'}'");

    return {
      type: "FunctionDeclaration",
      name,
      returnType,
      params: [],
      body,
    };
  }

  function parseProgram(): Program {
    const declarations: FunctionDeclaration[] = [];
    while (current().type !== TokenType.EOF) {
      declarations.push(parseFunctionDecl());
    }
    return { type: "Program", declarations };
  }

  return parseProgram();
}
