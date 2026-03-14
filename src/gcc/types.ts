// ── Token Types ──────────────────────────────────────────────

export const TokenType = {
  // Keywords
  INT: "INT",
  VOID: "VOID",
  RETURN: "RETURN",
  IF: "IF",
  ELSE: "ELSE",
  WHILE: "WHILE",
  FOR: "FOR",

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

  // Pointer
  AMPERSAND: "AMPERSAND",  // &

  // Comparison operators
  EQ: "EQ",       // ==
  NEQ: "NEQ",     // !=
  LT: "LT",       // <
  GT: "GT",        // >
  LTE: "LTE",     // <=
  GTE: "GTE",     // >=

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
export type ComparisonOperator = "==" | "!=" | "<" | ">" | "<=" | ">=";

export interface BinaryExpression {
  type: "BinaryExpression";
  operator: BinaryOperator | ComparisonOperator;
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

export interface CallExpression {
  type: "CallExpression";
  callee: string;
  args: Expression[];
}

/** &x — takes the address of a variable */
export interface AddressOfExpression {
  type: "AddressOfExpression";
  name: string;
}

/** *p — reads through a pointer */
export interface DereferenceExpression {
  type: "DereferenceExpression";
  operand: Expression;
}

/** *p = val — writes through a pointer */
export interface DereferenceAssignment {
  type: "DereferenceAssignment";
  pointer: Expression;
  value: Expression;
}

export type Expression =
  | IntegerLiteral
  | BinaryExpression
  | UnaryExpression
  | Identifier
  | AssignmentExpression
  | CallExpression
  | AddressOfExpression
  | DereferenceExpression
  | DereferenceAssignment;

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

export interface IfStatement {
  type: "IfStatement";
  condition: Expression;
  consequent: Statement[];
  alternate: Statement[] | null;
}

export interface WhileStatement {
  type: "WhileStatement";
  condition: Expression;
  body: Statement[];
}

export interface ForStatement {
  type: "ForStatement";
  init: Statement;          // var decl or expr stmt
  condition: Expression;
  update: Expression;       // e.g. i = i + 1
  body: Statement[];
}

export type Statement =
  | ReturnStatement
  | VariableDeclaration
  | ExpressionStatement
  | IfStatement
  | WhileStatement
  | ForStatement;

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
