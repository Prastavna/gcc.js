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

  // Operators (Milestone 2+)
  PLUS: "PLUS",
  MINUS: "MINUS",
  STAR: "STAR",
  SLASH: "SLASH",
  PERCENT: "PERCENT",

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

export type Expression = IntegerLiteral | BinaryExpression | UnaryExpression;

export interface ReturnStatement {
  type: "ReturnStatement";
  expression: Expression;
}

// For now, Statement is just ReturnStatement. Grows with milestones.
export type Statement = ReturnStatement;

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
