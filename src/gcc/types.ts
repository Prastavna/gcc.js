// ── Token Types ──────────────────────────────────────────────

export const TokenType = {
  // Keywords
  INT: "INT",
  VOID: "VOID",
  RETURN: "RETURN",

  // Literals
  NUMBER: "NUMBER",
  IDENTIFIER: "IDENTIFIER",

  // Punctuation
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  LBRACE: "LBRACE",
  RBRACE: "RBRACE",
  SEMICOLON: "SEMICOLON",
  COMMA: "COMMA",

  // Operators
  PLUS: "PLUS",
  MINUS: "MINUS",
  STAR: "STAR",
  SLASH: "SLASH",
  PERCENT: "PERCENT",
  EQUALS: "EQUALS",

  // Special
  EOF: "EOF",
} as const;

export type TokenType = (typeof TokenType)[keyof typeof TokenType];

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  col: number;
}

// ── AST Node Types ───────────────────────────────────────────

export type TypeSpecifier = "int" | "void";

export interface IntegerLiteral {
  type: "IntegerLiteral";
  value: number;
}

export type BinaryOperator = "+" | "-" | "*" | "/" | "%";

export interface BinaryExpression {
  type: "BinaryExpression";
  operator: BinaryOperator;
  left: Expression;
  right: Expression;
}

export type UnaryOperator = "-";

export interface UnaryExpression {
  type: "UnaryExpression";
  operator: UnaryOperator;
  operand: Expression;
}

export interface Identifier {
  type: "Identifier";
  name: string;
}

export interface AssignmentExpression {
  type: "AssignmentExpression";
  name: string;
  value: Expression;
}

export type Expression =
  | IntegerLiteral
  | BinaryExpression
  | UnaryExpression
  | Identifier
  | AssignmentExpression;

export interface ReturnStatement {
  type: "ReturnStatement";
  expression: Expression;
}

export interface VariableDeclaration {
  type: "VariableDeclaration";
  name: string;
  typeSpec: TypeSpecifier;
  initializer: Expression;
}

export interface ExpressionStatement {
  type: "ExpressionStatement";
  expression: Expression;
}

export type Statement = ReturnStatement | VariableDeclaration | ExpressionStatement;

export interface Parameter {
  type: "Parameter";
  name: string;
  typeSpec: TypeSpecifier;
}

export interface FunctionDeclaration {
  type: "FunctionDeclaration";
  name: string;
  returnType: TypeSpecifier;
  params: Parameter[];
  body: Statement[];
}

export type Declaration = FunctionDeclaration;

export interface Program {
  type: "Program";
  declarations: Declaration[];
}

// ── Compiler Result Types ────────────────────────────────────

export interface CompileError {
  stage: "lexer" | "parser" | "codegen";
  message: string;
  line: number;
  col: number;
}

export type CompileResult =
  | { ok: true; wasm: Uint8Array }
  | { ok: false; errors: CompileError[] };
