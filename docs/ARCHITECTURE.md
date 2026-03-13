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

The lexer scans the source character-by-character and produces a flat array of tokens. It handles:

- Keywords: `int`, `return`, `if`, `else`, `while`, `for`, `void`
- Identifiers: `[a-zA-Z_][a-zA-Z0-9_]*`
- Integer literals: `[0-9]+`
- Operators: `+`, `-`, `*`, `/`, `%`, `=`, `==`, `!=`, `<`, `>`, `<=`, `>=`
- Punctuation: `(`, `)`, `{`, `}`, `;`, `,`
- Whitespace and comments are skipped

Each token carries:
- `type` — enum value (e.g., `TokenType.INT`, `TokenType.RETURN`)
- `value` — the raw string (e.g., `"42"`, `"main"`)
- `line` and `col` — for error reporting

### Milestone 1 tokens (minimal set)

```
INT, RETURN, IDENTIFIER, NUMBER, LPAREN, RPAREN, LBRACE, RBRACE, SEMICOLON
```

---

## Stage 2: Parser (`parser.ts`)

**Input:** `Token[]`
**Output:** `Program` (AST root node)

Recursive descent parser. Produces an AST with the following node types:

### AST Node Types (Milestone 1)

```
Program
  └── FunctionDeclaration
        ├── name: string
        ├── returnType: "int" | "void"
        ├── params: Parameter[]
        └── body: Statement[]
              └── ReturnStatement
                    └── expression: Expression
                          └── IntegerLiteral
                                └── value: number
```

### Grammar (Milestone 1)

```
program         → function_decl*
function_decl   → type_spec IDENTIFIER '(' param_list? ')' compound_stmt
type_spec       → 'int' | 'void'
param_list      → param (',' param)*
param           → type_spec IDENTIFIER
compound_stmt   → '{' statement* '}'
statement       → return_stmt
return_stmt     → 'return' expression ';'
expression      → integer_literal
integer_literal → NUMBER
```

The grammar grows with each milestone. The parser is designed so new productions can be added without rewriting existing code.

---

## Stage 3: Codegen (`codegen.ts`)

**Input:** `Program` (AST)
**Output:** `Uint8Array` (valid WASM binary module)

The codegen walks the AST and emits a WASM binary module. It directly writes bytes — no text format (WAT) intermediate.

### WASM Binary Format

A WASM module is a sequence of sections, each with a section ID and byte length:

```
magic   : 0x00 0x61 0x73 0x6D  ("\0asm")
version : 0x01 0x00 0x00 0x00  (version 1)
sections: [type, function, export, code, ...]
```

### Sections emitted for Milestone 1

| ID | Section    | Purpose                                   |
|----|------------|-------------------------------------------|
| 1  | Type       | Declare function signatures `() -> i32`   |
| 3  | Function   | Map function index to type index          |
| 7  | Export     | Export `main` by name                     |
| 10 | Code       | Function bodies (WASM bytecode)           |

### WASM instruction mapping (Milestone 1)

| C construct      | WASM instruction       |
|------------------|------------------------|
| `return 42;`     | `i32.const 42`, `end`  |
| `int` return type| function sig `() -> i32`|

### Key helper: LEB128 encoding

WASM uses LEB128 (Little Endian Base 128) for variable-length integers. The `wasm.ts` module provides:

- `encodeUnsignedLEB128(value)` — for lengths, indices
- `encodeSignedLEB128(value)` — for `i32.const` operands

---

## Stage 4: Runtime (part of `index.ts`)

**Input:** `Uint8Array` (WASM binary)
**Output:** `WebAssembly.Instance` with callable exports

```ts
const module = await WebAssembly.compile(wasmBytes);
const instance = await WebAssembly.instantiate(module, imports);
const result = instance.exports.main();
```

For Milestone 1, `imports` is empty. Later milestones add imported functions (e.g., `printf` mapped to `console.log`).

---

## Error Handling

Every stage can produce errors. Errors include:

- **Source location** (`line`, `col`)
- **Stage** (lexer / parser / codegen)
- **Message** (human-readable)

```ts
interface CompileError {
  stage: "lexer" | "parser" | "codegen";
  message: string;
  line: number;
  col: number;
}
```

The `compile()` function returns a discriminated union:

```ts
type CompileResult =
  | { ok: true; wasm: Uint8Array }
  | { ok: false; errors: CompileError[] };
```

---

## Design Decisions

1. **No WAT intermediate** — We emit WASM binary directly. WAT is only useful for debugging; we can add a `disassemble()` utility later if needed.

2. **Pure functions** — Each stage is `(input) => output` with no side effects. This makes testing trivial.

3. **No optimization passes** — For Milestone 1-5, the codegen emits naive but correct WASM. Optimization is a future concern.

4. **Single-file compilation** — No linker, no object files. One C source string produces one WASM module. Multi-file support is a much later milestone.

5. **32-bit integers only (initially)** — WASM has `i32` and `i64`. We start with `i32` for C's `int` type. `long`/`long long` maps to `i64` later.
