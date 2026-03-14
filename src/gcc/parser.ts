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
 * Grammar (Milestone 2):
 *   program       → function_decl*
 *   function_decl → type_spec IDENTIFIER '(' ')' '{' statement* '}'
 *   type_spec     → 'int' | 'void'
 *   statement     → return_stmt
 *   return_stmt   → 'return' expression ';'
 *   expression    → additive
 *   additive      → multiplicative (('+' | '-') multiplicative)*
 *   multiplicative→ unary (('*' | '/' | '%') unary)*
 *   unary         → '-' unary | primary
 *   primary       → NUMBER | '(' expression ')'
 */
export function parse(tokens: Token[]): Program {
  let pos = 0;

  function current(): Token {
    return tokens[pos];
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

  /** primary → NUMBER | '(' expression ')' */
  function parsePrimary(): Expression {
    const tok = current();

    if (tok.type === TokenType.NUMBER) {
      pos++;
      return { type: "IntegerLiteral", value: parseInt(tok.value, 10) };
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
    const tok = current();
    if (tok.type === TokenType.RETURN) {
      pos++;
      const expression = parseExpression();
      expect(TokenType.SEMICOLON, "';' after return statement");
      return { type: "ReturnStatement", expression };
    }
    throw new Error(
      `Expected statement but got '${tok.value || tok.type}' at line ${tok.line}:${tok.col}`
    );
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
