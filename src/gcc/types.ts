// ── Token Types ──────────────────────────────────────────────

export const TokenType = {
  // Keywords
  INT: "INT",
  VOID: "VOID",
  CHAR: "CHAR",
  LONG: "LONG",
  SIZEOF: "SIZEOF",
  STRUCT: "STRUCT",
  RETURN: "RETURN",
  IF: "IF",
  ELSE: "ELSE",
  WHILE: "WHILE",
  FOR: "FOR",
  SWITCH: "SWITCH",
  CASE: "CASE",
  DEFAULT: "DEFAULT",
  BREAK: "BREAK",
  CONTINUE: "CONTINUE",
  ENUM: "ENUM",
  TYPEDEF: "TYPEDEF",
  UNION: "UNION",
  UNSIGNED: "UNSIGNED",
  DO: "DO",
  GOTO: "GOTO",
  FLOAT: "FLOAT",
  DOUBLE: "DOUBLE",
  SHORT: "SHORT",
  SIGNED: "SIGNED",
  CONST: "CONST",
  VOLATILE: "VOLATILE",
  STATIC: "STATIC",
  EXTERN: "EXTERN",
  REGISTER: "REGISTER",
  AUTO: "AUTO",

  // Literals
  NUMBER: "NUMBER",
  STRING: "STRING",
  CHAR_LITERAL: "CHAR_LITERAL",
  IDENTIFIER: "IDENTIFIER",

  // Punctuation
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  LBRACE: "LBRACE",
  RBRACE: "RBRACE",
  LBRACKET: "LBRACKET",
  RBRACKET: "RBRACKET",
  SEMICOLON: "SEMICOLON",
  COMMA: "COMMA",

  // Operators
  PLUS: "PLUS",
  MINUS: "MINUS",
  STAR: "STAR",
  SLASH: "SLASH",
  PERCENT: "PERCENT",
  EQUALS: "EQUALS",

  // Pointer / Bitwise
  AMPERSAND: "AMPERSAND",  // &
  PIPE: "PIPE",            // |
  CARET: "CARET",          // ^
  TILDE: "TILDE",          // ~
  LEFT_SHIFT: "LEFT_SHIFT",   // <<
  RIGHT_SHIFT: "RIGHT_SHIFT", // >>

  // Comparison operators
  EQ: "EQ",       // ==
  NEQ: "NEQ",     // !=
  LT: "LT",       // <
  GT: "GT",        // >
  LTE: "LTE",     // <=
  GTE: "GTE",     // >=

  // Logical operators
  BANG: "BANG",           // !
  AND_AND: "AND_AND",    // &&
  PIPE_PIPE: "PIPE_PIPE", // ||

  // Ternary
  QUESTION: "QUESTION",  // ?
  COLON: "COLON",        // :

  // Member access
  DOT: "DOT",                   // .
  ARROW: "ARROW",               // ->

  // Increment/decrement
  PLUS_PLUS: "PLUS_PLUS",     // ++
  MINUS_MINUS: "MINUS_MINUS", // --

  // Compound assignment
  PLUS_EQUALS: "PLUS_EQUALS",       // +=
  MINUS_EQUALS: "MINUS_EQUALS",     // -=
  STAR_EQUALS: "STAR_EQUALS",       // *=
  SLASH_EQUALS: "SLASH_EQUALS",     // /=
  PERCENT_EQUALS: "PERCENT_EQUALS", // %=

  // Variadic
  ELLIPSIS: "ELLIPSIS",       // ...

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

export interface StructTypeSpecifier {
  kind: "struct";
  name: string;
}

export interface UnionTypeSpecifier {
  kind: "union";
  name: string;
}

export interface FunctionPointerTypeSpecifier {
  kind: "functionPointer";
  returnType: TypeSpecifier;
  paramTypes: TypeSpecifier[];
}

export type TypeSpecifier = "int" | "void" | "char" | "short" | "long" | "float" | "double" | "unsigned int" | "unsigned char" | "unsigned short" | StructTypeSpecifier | UnionTypeSpecifier | FunctionPointerTypeSpecifier;

export interface IntegerLiteral {
  type: "IntegerLiteral";
  value: number;
}

export interface FloatingLiteral {
  type: "FloatingLiteral";
  value: number;
  isFloat: boolean; // true = float (f32), false = double (f64)
}

export interface StringLiteral {
  type: "StringLiteral";
  value: string;
}

export type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "&" | "|" | "^" | "<<" | ">>";
export type ComparisonOperator = "==" | "!=" | "<" | ">" | "<=" | ">=";

export interface BinaryExpression {
  type: "BinaryExpression";
  operator: BinaryOperator | ComparisonOperator;
  left: Expression;
  right: Expression;
}

export type UnaryOperator = "-" | "!" | "~";

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
  indirect?: boolean; // true when calling through a function pointer
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

/** && or || — short-circuit logical operators */
export type LogicalOperator = "&&" | "||";

export interface LogicalExpression {
  type: "LogicalExpression";
  operator: LogicalOperator;
  left: Expression;
  right: Expression;
}

/** a ? b : c — ternary conditional */
export interface TernaryExpression {
  type: "TernaryExpression";
  condition: Expression;
  consequent: Expression;
  alternate: Expression;
}

/** ++x, x++, --x, x-- — prefix/postfix increment/decrement */
export interface UpdateExpression {
  type: "UpdateExpression";
  operator: "++" | "--";
  prefix: boolean;
  name: string;
}

/** x += val, x -= val, etc. — compound assignment */
export type CompoundAssignmentOperator = "+=" | "-=" | "*=" | "/=" | "%=";

export interface CompoundAssignmentExpression {
  type: "CompoundAssignmentExpression";
  operator: CompoundAssignmentOperator;
  name: string;
  value: Expression;
}

/** arr[i] — reads an array element (array can be a name or a sub-expression for chained access like matrix[i][j]) */
export interface ArrayAccessExpression {
  type: "ArrayAccessExpression";
  array: string | Expression;
  index: Expression;
}

/** arr[i] = val — writes an array element */
export interface ArrayIndexAssignment {
  type: "ArrayIndexAssignment";
  array: string | Expression;
  index: Expression;
  value: Expression;
}

/** 'A' — character literal with ASCII value */
export interface CharLiteral {
  type: "CharLiteral";
  value: number;
}

/** (type)expr — type cast expression */
export interface CastExpression {
  type: "CastExpression";
  targetType: TypeSpecifier;
  operand: Expression;
  pointer?: boolean;  // (char *)expr — cast to pointer type
}

/** va_arg(ap, type) — read next variadic argument */
export interface VaArgExpression {
  type: "VaArgExpression";
  vaList: string;
  argType: TypeSpecifier;
}

/** sizeof(type) — compile-time size constant */
export interface SizeofExpression {
  type: "SizeofExpression";
  targetType: TypeSpecifier;
}

/** p.x — reads a struct field (object can be a name or expression like pts[i].x) */
export interface MemberAccessExpression {
  type: "MemberAccessExpression";
  object: string | Expression;
  member: string;
}

/** p.x = val — writes a struct field */
export interface MemberAssignmentExpression {
  type: "MemberAssignmentExpression";
  object: string | Expression;
  member: string;
  value: Expression;
}

/** p->x — reads a struct field through a pointer */
export interface ArrowAccessExpression {
  type: "ArrowAccessExpression";
  pointer: string;
  member: string;
}

/** p->x = val — writes a struct field through a pointer */
export interface ArrowAssignmentExpression {
  type: "ArrowAssignmentExpression";
  pointer: string;
  member: string;
  value: Expression;
}

/** (a, b, c) — evaluates all, returns last */
export interface CommaExpression {
  type: "CommaExpression";
  expressions: Expression[];
}

export type Expression =
  | IntegerLiteral
  | FloatingLiteral
  | StringLiteral
  | CharLiteral
  | BinaryExpression
  | UnaryExpression
  | Identifier
  | AssignmentExpression
  | CallExpression
  | AddressOfExpression
  | DereferenceExpression
  | DereferenceAssignment
  | LogicalExpression
  | TernaryExpression
  | UpdateExpression
  | CompoundAssignmentExpression
  | ArrayAccessExpression
  | ArrayIndexAssignment
  | CastExpression
  | SizeofExpression
  | MemberAccessExpression
  | MemberAssignmentExpression
  | ArrowAccessExpression
  | ArrowAssignmentExpression
  | CommaExpression
  | VaArgExpression;

export interface ReturnStatement {
  type: "ReturnStatement";
  expression: Expression;
}

export interface VariableDeclaration {
  type: "VariableDeclaration";
  name: string;
  typeSpec: TypeSpecifier;
  initializer: Expression;
  pointer?: boolean;
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

export interface ArrayDeclaration {
  type: "ArrayDeclaration";
  name: string;
  typeSpec: TypeSpecifier;
  size: number;
  dimensions: number[];          // [5] for int[5], [3,4] for int[3][4]
  initializer?: (Expression | Expression[])[];  // nested lists for 2D arrays
  stringInit?: string;           // char name[] = "hello"
}

export interface BreakStatement {
  type: "BreakStatement";
}

export interface ContinueStatement {
  type: "ContinueStatement";
}

export interface DoWhileStatement {
  type: "DoWhileStatement";
  condition: Expression;
  body: Statement[];
}

export interface GotoStatement {
  type: "GotoStatement";
  label: string;
}

export interface LabeledStatement {
  type: "LabeledStatement";
  label: string;
  body: Statement;
}

export interface SwitchCase {
  value: Expression | null; // null for default
  body: Statement[];
}

export interface SwitchStatement {
  type: "SwitchStatement";
  discriminant: Expression;
  cases: SwitchCase[];
}

export interface StructVariableDeclaration {
  type: "StructVariableDeclaration";
  name: string;
  structName: string;
  initializer?: Expression[] | Expression;  // {1, 2} list or another struct var for copy
}

export type Statement =
  | ReturnStatement
  | VariableDeclaration
  | ArrayDeclaration
  | StructVariableDeclaration
  | ExpressionStatement
  | IfStatement
  | WhileStatement
  | ForStatement
  | DoWhileStatement
  | BreakStatement
  | ContinueStatement
  | SwitchStatement
  | GotoStatement
  | LabeledStatement;

export interface Parameter {
  type: "Parameter";
  name: string;
  typeSpec: TypeSpecifier;
  pointer?: boolean;
}

export interface FunctionDeclaration {
  type: "FunctionDeclaration";
  name: string;
  returnType: TypeSpecifier;
  params: Parameter[];
  body: Statement[];
  isStatic?: boolean;
  returnPointer?: boolean;
  variadic?: boolean;
}

export interface ExternFunctionDeclaration {
  type: "ExternFunctionDeclaration";
  name: string;
  returnType: TypeSpecifier;
  params: Parameter[];
  returnPointer?: boolean;
  variadic?: boolean;
}

export interface ForwardDeclaration {
  type: "ForwardDeclaration";
  name: string;
  returnType: TypeSpecifier;
  params: Parameter[];
  returnPointer?: boolean;
  variadic?: boolean;
}

export interface GlobalVariableDeclaration {
  type: "GlobalVariableDeclaration";
  name: string;
  typeSpec: TypeSpecifier;
  initializer: Expression;
  isStatic?: boolean;
  isConst?: boolean;
}

export interface StructFieldDeclaration {
  name: string;
  typeSpec: TypeSpecifier;
  pointer?: boolean;  // for struct Node *next; fields
}

export interface StructDeclaration {
  type: "StructDeclaration";
  name: string;
  fields: StructFieldDeclaration[];
}

export interface EnumDeclaration {
  type: "EnumDeclaration";
  name: string | null;
  members: { name: string; value: number }[];
}

export interface UnionDeclaration {
  type: "UnionDeclaration";
  name: string;
  fields: StructFieldDeclaration[];
}

export type Declaration = FunctionDeclaration | ExternFunctionDeclaration | ForwardDeclaration | GlobalVariableDeclaration | StructDeclaration | EnumDeclaration | UnionDeclaration;

export interface Program {
  type: "Program";
  declarations: Declaration[];
}

// ── Compiler Result Types ────────────────────────────────────

export interface CompileError {
  stage: "preprocessor" | "lexer" | "parser" | "codegen";
  message: string;
  line: number;
  col: number;
}

export type CompileResult =
  | { ok: true; wasm: Uint8Array }
  | { ok: false; errors: CompileError[] };
