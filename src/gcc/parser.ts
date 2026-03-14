import { TokenType } from "./types.ts";
import type {
  Token,
  Program,
  FunctionDeclaration,
  Parameter,
  Statement,
  Expression,
  TypeSpecifier,
  BinaryOperator,
} from "./types.ts";

/**
 * Recursive descent parser with precedence climbing for expressions.
 *
 * Grammar (Milestone 4):
 *   program        → function_decl*
 *   function_decl  → type_spec IDENTIFIER '(' param_list? ')' '{' statement* '}'
 *   param_list     → param (',' param)*
 *   param          → type_spec IDENTIFIER
 *   type_spec      → 'int' | 'void'
 *   statement      → var_decl | return_stmt | expr_stmt
 *   var_decl       → type_spec IDENTIFIER '=' expression ';'
 *   return_stmt    → 'return' expression ';'
 *   expr_stmt      → expression ';'
 *   expression     → assignment
 *   assignment     → IDENTIFIER '=' assignment | additive
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
   */
  function parseAssignment(): Expression {
    if (
      current().type === TokenType.IDENTIFIER &&
      peek(1).type === TokenType.EQUALS
    ) {
      const name = current().value;
      pos += 2; // skip identifier and '='
      const value = parseAssignment();
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

  /** primary → NUMBER | IDENTIFIER '(' arg_list? ')' | IDENTIFIER | '(' expression ')' */
  function parsePrimary(): Expression {
    const tok = current();

    if (tok.type === TokenType.NUMBER) {
      pos++;
      return { type: "IntegerLiteral", value: parseInt(tok.value, 10) };
    }

    if (tok.type === TokenType.IDENTIFIER) {
      const name = tok.value;
      pos++;

      // Function call: IDENTIFIER '(' arg_list? ')'
      if (current().type === TokenType.LPAREN) {
        pos++; // skip '('
        const args: Expression[] = [];
        if (current().type !== TokenType.RPAREN) {
          args.push(parseExpression());
          while (current().type === TokenType.COMMA) {
            pos++; // skip ','
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

  // ── Statement & declaration parsing ────────────────────

  function parseStatement(): Statement {
    // Variable declaration: int x = expr;
    // Disambiguate from function start by checking for '=' after 'type IDENT'
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

    // Expression statement (e.g. x = 5;)
    const expression = parseExpression();
    expect(TokenType.SEMICOLON, "';' after expression statement");
    return { type: "ExpressionStatement", expression };
  }

  /** Parse parameter list: type_spec IDENTIFIER (',' type_spec IDENTIFIER)* */
  function parseParamList(): Parameter[] {
    const params: Parameter[] = [];
    if (current().type === TokenType.RPAREN) {
      return params; // empty param list
    }
    // First param
    const firstType = parseTypeSpec();
    const firstName = expect(TokenType.IDENTIFIER, "parameter name").value;
    params.push({ type: "Parameter", name: firstName, typeSpec: firstType });

    while (current().type === TokenType.COMMA) {
      pos++; // skip ','
      const paramType = parseTypeSpec();
      const paramName = expect(TokenType.IDENTIFIER, "parameter name").value;
      params.push({ type: "Parameter", name: paramName, typeSpec: paramType });
    }

    return params;
  }

  function parseFunctionDecl(): FunctionDeclaration {
    const returnType = parseTypeSpec();
    const name = expect(TokenType.IDENTIFIER, "function name").value;
    expect(TokenType.LPAREN, "'('");
    const params = parseParamList();
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
      params,
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
