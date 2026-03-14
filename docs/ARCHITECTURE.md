# gcc.js - Architecture

## Pipeline Overview

```
C source string
      │
      ▼
┌──────────┐
│  Lexer   │  source string → Token[]
└──────────┘
      │
      ▼
┌──────────┐
│  Parser  │  Token[] → AST (Program node)
└──────────┘
      │
      ▼
┌──────────┐
│  Codegen │  AST → Uint8Array (WASM binary)
└──────────┘
      │
      ▼
┌──────────┐
│  Runtime │  Uint8Array → WebAssembly.Instance (callable exports)
└──────────┘
```

Each stage is a pure function. No shared mutable state between stages.

---

## Stage 1: Lexer (`lexer.ts`)

**Input:** `string` (C source code)
**Output:** `Token[]`

The lexer scans the source character-by-character and produces a flat array of tokens.

### Supported tokens

| Category    | Tokens |
|-------------|--------|
| Keywords    | `int`, `void`, `return`, `if`, `else`, `while`, `for` |
| Literals    | integer (`42`), string (`"hello\n"`), identifiers (`main`) |
| Operators   | `+`, `-`, `*`, `/`, `%`, `=` |
| Comparison  | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Pointer     | `&` |
| Punctuation | `(`, `)`, `{`, `}`, `;`, `,` |

Multi-character tokens (`==`, `!=`, `<=`, `>=`) use one-character lookahead. String literals handle escape sequences (`\n`, `\t`, `\r`, `\\`, `\"`, `\0`).

Each token carries `type`, `value`, `line`, and `col`.

---

## Stage 2: Parser (`parser.ts`)

**Input:** `Token[]`
**Output:** `Program` (AST root node)

Recursive descent parser with precedence climbing for expressions.

### Grammar

```
program        → declaration*
declaration    → extern_decl | function_decl
extern_decl    → type_spec IDENTIFIER '(' param_list? ')' ';'
function_decl  → type_spec IDENTIFIER '(' param_list? ')' '{' statement* '}'
param_list     → param (',' param)*
param          → type_spec '*'? IDENTIFIER
type_spec      → 'int' | 'void'

statement      → var_decl | return_stmt | if_stmt | while_stmt
               | for_stmt | expr_stmt
var_decl       → type_spec '*'? IDENTIFIER '=' expression ';'
return_stmt    → 'return' expression ';'
if_stmt        → 'if' '(' expression ')' block_or_stmt ('else' block_or_stmt)?
while_stmt     → 'while' '(' expression ')' block_or_stmt
for_stmt       → 'for' '(' (var_decl | expr_stmt) expression ';' expression ')' block_or_stmt
expr_stmt      → expression ';'
block_or_stmt  → '{' statement* '}' | statement

expression     → assignment
assignment     → '*' unary '=' assignment | IDENTIFIER '=' assignment | comparison
comparison     → additive (('==' | '!=' | '<' | '>' | '<=' | '>=') additive)*
additive       → multiplicative (('+' | '-') multiplicative)*
multiplicative → unary (('*' | '/' | '%') unary)*
unary          → '-' unary | '*' unary | '&' IDENTIFIER | primary
primary        → NUMBER | STRING | IDENTIFIER '(' arg_list? ')' | IDENTIFIER | '(' expression ')'
arg_list       → expression (',' expression)*
```

### AST Node Types

**Expressions:** `IntegerLiteral`, `StringLiteral`, `Identifier`, `BinaryExpression`, `UnaryExpression`, `AssignmentExpression`, `CallExpression`, `AddressOfExpression`, `DereferenceExpression`, `DereferenceAssignment`

**Statements:** `ReturnStatement`, `VariableDeclaration`, `ExpressionStatement`, `IfStatement`, `WhileStatement`, `ForStatement`

**Top-level:** `FunctionDeclaration`, `ExternFunctionDeclaration`, `Program`

---

## Stage 3: Codegen (`codegen.ts`)

**Input:** `Program` (AST)
**Output:** `Uint8Array` (valid WASM binary module)

### WASM sections emitted

| ID | Section  | When emitted |
|----|----------|-------------|
| 1  | Type     | Always — function signatures |
| 2  | Import   | When extern functions exist |
| 3  | Function | Always — maps func index → type index |
| 5  | Memory   | When pointers or strings are used |
| 7  | Export   | Always — exports all local functions + memory |
| 10 | Code     | Always — function bodies |
| 11 | Data     | When string literals exist |

### Function index numbering

Imported functions occupy indices `0..N-1`, local functions `N..N+M-1`. This is a WASM requirement.

### Variable storage strategy

Variables are analyzed per-function:
- **Address-taken** (`&x` appears): stored in WASM linear memory. Read = `i32.load`, write = `i32.store`.
- **Normal**: stored as WASM locals. Read = `local.get`, write = `local.set`.
- **Parameters**: WASM locals `0..P-1`. Address-taken params are copied to memory at function entry.

### Memory layout

```
0x000 - 0x3FF   Stack variables (address-taken locals, 4 bytes each)
0x400+          String literal data (null-terminated, 4-byte aligned)
```

### Control flow mapping

| C construct    | WASM instructions |
|----------------|-------------------|
| `if/else`      | `if (void) ... else ... end` |
| `while`        | `block { loop { br_if, ..., br 0, end } end }` |
| `for`          | Desugared to init + while pattern |
| `return`       | `return` opcode (early return from anywhere) |

### Key helper: LEB128 encoding

WASM uses LEB128 (Little Endian Base 128) for variable-length integers:
- `encodeUnsignedLEB128(value)` — for lengths, indices
- `encodeSignedLEB128(value)` — for `i32.const` operands

---

## Stage 4: Runtime (part of `index.ts`)

The `compile()` function returns a `CompileResult`:

```ts
type CompileResult =
  | { ok: true; wasm: Uint8Array }
  | { ok: false; errors: CompileError[] };
```

The caller instantiates the WASM module, providing imports as needed:

```ts
const result = compile(source);
if (result.ok) {
  const module = await WebAssembly.compile(result.wasm);
  const instance = await WebAssembly.instantiate(module, {
    env: {
      printf: (ptr) => { /* read string from memory at ptr */ },
    },
  });
  instance.exports.main();
}
```

---

## Design Decisions

1. **No WAT intermediate** — We emit WASM binary directly.
2. **Pure functions** — Each stage is `(input) => output` with no side effects.
3. **No optimization passes** — Codegen emits naive but correct WASM.
4. **Single-file compilation** — One C source string → one WASM module.
5. **32-bit integers** — `int` maps to WASM `i32`. `long` → `i64` in future.
6. **Memory only when needed** — Memory section is only emitted when pointers or strings are used, keeping simple programs minimal.
7. **Address-taken analysis** — Only variables with `&` taken go to memory; others stay as fast WASM locals.
