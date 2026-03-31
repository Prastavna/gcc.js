# @prastavna/gcc.js - Architecture

## Pipeline Overview

```
C source string
      │
      ▼
┌──────────────┐
│ Preprocessor │  source string → preprocessed string
└──────────────┘  (#define, #ifdef, #include expansion)
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

## Stage 0: Preprocessor (`preprocessor.ts`)

**Input:** `string` (C source code)
**Output:** `string` (preprocessed source, macros expanded, conditionals resolved)

The preprocessor runs before the lexer as a text transformation pass. It processes the source line by line.

### Directives

| Directive | Purpose |
|-----------|---------|
| `#define NAME value` | Object-like macro (text substitution) |
| `#define NAME(a, b) body` | Function-like macro (parameterized substitution) |
| `#undef NAME` | Removes a macro definition |
| `#ifdef NAME` | Include following lines if NAME is defined |
| `#ifndef NAME` | Include following lines if NAME is NOT defined |
| `#else` | Alternate branch for `#ifdef`/`#ifndef` |
| `#endif` | End conditional block |
| `#include "file"` / `#include <file>` | Include content from virtual filesystem |

### Macro expansion

- Object-like macros: simple text replacement with rescanning for chained macros
- Function-like macros: argument parsing with nested parenthesis tracking, parameter substitution in body
- "Blue paint" rule: a macro cannot expand itself (prevents infinite recursion)
- Identifiers inside string/char literals are not expanded

### Line preservation

Directive lines are replaced with blank lines in the output to preserve line numbers for error reporting.

### Virtual filesystem

`#include` resolves files from the `files` option passed to `compile()` or `preprocess()`. Circular includes are detected with a depth limit of 16.

---

## Stage 1: Lexer (`lexer.ts`)

**Input:** `string` (C source code)
**Output:** `Token[]`

The lexer scans the source character-by-character and produces a flat array of tokens.

### Supported tokens

| Category    | Tokens |
|-------------|--------|
| Keywords    | `int`, `void`, `char`, `long`, `unsigned`, `sizeof`, `return`, `if`, `else`, `while`, `for`, `enum`, `typedef`, `union` |
| Literals    | integer (`42`), string (`"hello\n"`), char (`'A'`), identifiers (`main`) |
| Operators   | `+`, `-`, `*`, `/`, `%`, `=` |
| Comparison  | `==`, `!=`, `<`, `>`, `<=`, `>=` |
| Bitwise     | `&`, `\|`, `^`, `~`, `<<`, `>>` |
| Pointer     | `&` |
| Punctuation | `(`, `)`, `{`, `}`, `;`, `,` |

Multi-character tokens (`==`, `!=`, `<=`, `>=`) use one-character lookahead. String literals handle escape sequences (`\n`, `\t`, `\r`, `\\`, `\"`, `\0`). Character literals (`'A'`, `'\n'`) produce `CHAR_LITERAL` tokens with the ASCII code as the value.

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
type_spec      → 'int' | 'void' | 'char' | 'long'

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
unary          → '-' unary | '!' unary | '*' unary | '&' IDENTIFIER
               | '++' IDENTIFIER | '--' IDENTIFIER | postfix
postfix        → primary ('++' | '--')*
primary        → NUMBER | STRING | CHAR_LITERAL | IDENTIFIER '(' arg_list? ')'
               | IDENTIFIER '[' expression ']' | IDENTIFIER
               | 'sizeof' '(' type_spec ')'
               | '(' type_spec ')' unary            (cast)
               | '(' expression ')'
arg_list       → expression (',' expression)*
```

### AST Node Types

**Expressions:** `IntegerLiteral`, `StringLiteral`, `CharLiteral`, `Identifier`, `BinaryExpression`, `UnaryExpression`, `AssignmentExpression`, `CompoundAssignmentExpression`, `CallExpression`, `AddressOfExpression`, `DereferenceExpression`, `DereferenceAssignment`, `LogicalExpression`, `TernaryExpression`, `UpdateExpression`, `ArrayAccessExpression`, `ArrayIndexAssignment`, `CastExpression`, `SizeofExpression`

**Statements:** `ReturnStatement`, `VariableDeclaration`, `ArrayDeclaration`, `ExpressionStatement`, `IfStatement`, `WhileStatement`, `ForStatement`

**Top-level:** `FunctionDeclaration`, `ExternFunctionDeclaration`, `GlobalVariableDeclaration`, `Program`

---

## Stage 3: Codegen (`codegen.ts`)

**Input:** `Program` (AST)
**Output:** `Uint8Array` (valid WASM binary module)

### WASM sections emitted

| ID | Section  | When emitted |
|----|----------|-------------|
| 1  | Type     | Always — function signatures (type-aware: i32/i64 params and returns) |
| 2  | Import   | When extern functions exist |
| 3  | Function | Always — maps func index → type index |
| 5  | Memory   | When pointers, strings, or arrays are used |
| 6  | Global   | When global variables exist |
| 7  | Export   | Always — exports all local functions + memory |
| 10 | Code     | Always — function bodies |
| 11 | Data     | When string literals exist |

### Function index numbering

Imported functions occupy indices `0..N-1`, local functions `N..N+M-1`. This is a WASM requirement.

### Variable storage strategy

Variables are analyzed per-function:
- **Address-taken** (`&x` appears): stored in WASM linear memory. Read/write use type-appropriate ops.
- **Normal**: stored as WASM locals. Read = `local.get`, write = `local.set`.
- **Parameters**: WASM locals `0..P-1`. Address-taken params are copied to memory at function entry.

### Type system

| C type | WASM local type | Memory ops | sizeof |
|--------|----------------|------------|--------|
| `char` / `unsigned char` | i32 | `i32.load8_s` / `i32.store8` | 1 |
| `short` / `unsigned short` | i32 | `i32.load16_s` / `i32.store16` | 2 |
| `int` / `unsigned int` | i32 | `i32.load` / `i32.store` | 4 |
| `float` | f32 | `f32.load` / `f32.store` | 4 |
| `long` | i64 | `i64.load` / `i64.store` | 8 |
| `double` | f64 | `f64.load` / `f64.store` | 8 |

Unsigned types use unsigned opcodes for division (`div_u`), remainder (`rem_u`), comparison (`lt_u`, `gt_u`, etc.), and right shift (`shr_u`). Float/double use FP-specific opcodes (`f32.add`, `f64.mul`, etc.).

**Type tracking:** The codegen maintains type maps (`localTypes`, `memVarTypes`, `globalTypes`, `funcReturnTypes`, `funcParamTypes`) to determine correct opcodes and conversions.

**`emitExpression` returns `CType`** — callers use the returned type to insert conversions as needed. The conversion matrix covers all 12 combinations between i32/i64/f32/f64 (e.g., `f64.convert_i32_s`, `i32.trunc_f64_s`, `f32.demote_f64`, `f64.promote_f32`).

**`inferType(expr)`** — computes expression result type without emitting code, used for promotion decisions.

**Promotion rule:** In binary ops, both operands are promoted to the wider type (char < int < long < float < double). Comparisons always return int.

**Cast parsing:** `(type)expr` is disambiguated from `(expr)` by lookahead — if `(` followed by type keyword then `)`, it's a cast.

### Memory layout

```
0x000 - 0x007   Reserved (NULL guard — ensures malloc never returns 0)
0x008+          Stack variables (address-taken locals, struct instances)
                String literal data (null-terminated, 4-byte aligned)
                Heap (bump allocator, 8-byte aligned, grows upward)
```

The heap pointer global is initialized to `max(nextStaticAddr, 8)`, ensuring the first `malloc()` call returns a non-zero address. This makes NULL (0) safe to use as a sentinel/end-of-list marker.

### Control flow mapping

| C construct    | WASM instructions |
|----------------|-------------------|
| `if/else`      | `if (void) ... else ... end` |
| `while`        | `block { loop { br_if, ..., br 0, end } end }` |
| `do-while`     | `block { loop { block { body } cond; br_if 0; end } end }` |
| `for`          | Desugared to init + while pattern |
| `goto`/labels  | State machine: `loop { block { ... br_table dispatch } }` |
| `return`       | `return` opcode (early return from anywhere) |

### Key helper: LEB128 encoding

WASM uses LEB128 (Little Endian Base 128) for variable-length integers:
- `encodeUnsignedLEB128(value)` — for lengths, indices
- `encodeSignedLEB128(value)` — for `i32.const` operands
- `encodeSignedLEB128_i64(value)` — for `i64.const` operands (uses BigInt)

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
5. **Multi-type support** — `char` and `int` map to WASM `i32`, `long` maps to `i64`, `float` maps to `f32`, `double` maps to `f64`. Type-aware codegen handles conversions automatically.
6. **Memory only when needed** — Memory section is only emitted when pointers or strings are used, keeping simple programs minimal.
7. **Address-taken analysis** — Only variables with `&` taken go to memory; others stay as fast WASM locals.
