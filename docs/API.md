# gcc.js - API Reference

## Installation

```ts
import { compile } from "./gcc";
```

No npm package yet. Import directly from source.

---

## `compile(source: string, options?: PreprocessorOptions): CompileResult`

Compiles C source code to a WASM binary module. The source is preprocessed first (macro expansion, conditional compilation, includes).

**Parameters:**
- `source` — C source code as a string
- `options` — Optional preprocessor options

```ts
interface PreprocessorOptions {
  /** Virtual filesystem for #include: filename → source content */
  files?: Record<string, string>;
  /** Pre-defined macros (like -D on the command line) */
  defines?: Record<string, string>;
}
```

**Returns:** `CompileResult`

```ts
type CompileResult =
  | { ok: true; wasm: Uint8Array }
  | { ok: false; errors: CompileError[] };
```

**Example:**

```ts
const result = compile(`
  #define ANSWER 42
  int main() { return ANSWER; }
`);

if (result.ok) {
  const module = await WebAssembly.instantiate(result.wasm);
  const exitCode = module.instance.exports.main();
  console.log(exitCode); // 42
}
```

**Example with options:**

```ts
const result = compile(`
  #include "math.h"
  int main() { return square(6); }
`, {
  files: { "math.h": "int square(int x) { return x * x; }" },
  defines: { DEBUG: "1" },
});
```

---

## `CompileError`

```ts
interface CompileError {
  stage: "preprocessor" | "lexer" | "parser" | "codegen";
  message: string;
  line: number;
  col: number;
}
```

**Fields:**
- `stage` — which compiler phase produced the error
- `message` — human-readable error description
- `line` — 1-based line number in source
- `col` — 1-based column number in source

**Example error:**

```ts
const result = compile(`int main() { return; }`);
// result.ok === false
// result.errors[0]:
// {
//   stage: "parser",
//   message: "expected expression after 'return'",
//   line: 1,
//   col: 22
// }
```

---

## Lower-level APIs

These are exported for testing and advanced usage. Not part of the stable API.

### `preprocess(source: string, options?: PreprocessorOptions): string`

Preprocesses C source: expands macros, evaluates conditionals, inlines `#include` files.

```ts
import { preprocess } from "./gcc/preprocessor";

const result = preprocess("#define X 42\nreturn X;");
// "return 42;"
```

### `tokenize(source: string): Token[]`

Lexes source into tokens.

```ts
import { tokenize } from "./gcc/lexer";

const tokens = tokenize("int main() { return 42; }");
// [
//   { type: TokenType.INT,        value: "int",  line: 1, col: 1  },
//   { type: TokenType.IDENTIFIER, value: "main", line: 1, col: 5  },
//   { type: TokenType.LPAREN,     value: "(",    line: 1, col: 9  },
//   ...
// ]
```

### `parse(tokens: Token[]): Program`

Parses tokens into an AST. Throws `ParseError` on invalid input.

```ts
import { parse } from "./gcc/parser";

const ast = parse(tokens);
// { type: "Program", declarations: [ ... ] }
```

### `generate(ast: Program): Uint8Array`

Generates a WASM binary from an AST. Throws `CodegenError` on invalid AST.

```ts
import { generate } from "./gcc/codegen";

const wasmBytes = generate(ast);
```

---

## Supported C Subset (through Milestone 22)

### Types
- `int` (32-bit signed), `char` (8-bit signed), `short` (16-bit signed), `long` (64-bit signed), `void`
- `unsigned int`, `unsigned char`, `unsigned short`
- `signed` keyword (explicit: `signed char`, `signed int`, `signed short`, `signed long`)
- `float` (32-bit IEEE 754), `double` (64-bit IEEE 754)
- `enum` declarations with auto-increment and explicit values
- `typedef` type aliases
- `union` (overlapping memory layout)
- Type casting: `(int)expr`, `(char)expr`, `(short)expr`, `(long)expr`, `(float)expr`, `(double)expr`, `(unsigned int)expr`, `(unsigned short)expr`, `(signed int)expr`
- `sizeof(type)` — compile-time constant (char=1, short=2, int=4, float=4, long=8, double=8, union=max field)
- Implicit promotion in mixed expressions (char < short < int < long < float < double)

### Qualifiers and Storage Classes
- `const` — parsed and accepted; const globals emitted as immutable WASM globals
- `volatile` — parsed and accepted (no-op for WASM)
- `static` — functions marked static are not exported from WASM module
- `extern` — variable declarations parsed and skipped; extern functions (no body) imported
- `register` — parsed and accepted (hint only, no effect)
- `auto` — parsed and accepted (default for locals, no effect)

### Literals
- Integer: `42`, `0`, `-1`
- Floating-point: `3.14`, `3.14f`, `1e5`, `2.5e-3f`, `.5`
- Character: `'A'`, `'\n'`, `'\0'`, `'\t'`
- String: `"hello\n"`

### Declarations
- Functions: `int add(int a, int b) { ... }`
- Forward declarations: `int foo(int x);` (before definition)
- Extern functions: `int printf(int ptr);`
- Function pointer variables: `int (*fp)(int, int) = add;`
- Function pointer parameters: `int apply(int (*op)(int, int), int x, int y)`
- `typedef` for function pointers: `typedef int (*BinOp)(int, int);`
- Local variables: `int x = 10;`, `char c = 'A';`, `long big = 100000;`, `float f = 3.14f;`, `double d = 2.718;`
- Global variables: `int counter = 0;`
- Arrays: `int arr[5] = {1, 2, 3, 4, 5};`
- Pointer variables: `int *p = &x;`

### Expressions
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Bitwise: `&`, `|`, `^`, `~`, `<<`, `>>`
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `&&`, `||`, `!`
- Ternary: `a ? b : c`
- Assignment: `x = val`, `x += val`, `x -= val`, etc.
- Increment/decrement: `++x`, `x++`, `--x`, `x--`
- Pointers: `&x`, `*p`, `*p = val`
- Arrays: `arr[i]`, `arr[i] = val`
- Function calls: `add(3, 4)`, `fp(3, 4)` (indirect via function pointer)
- Comma operator: `(a, b, c)` — evaluates all, returns last

### Statements
- `return expr;`
- `if (cond) { ... } else { ... }`
- `while (cond) { ... }`
- `do { ... } while (cond);`
- `for (init; cond; update) { ... }`
- `goto label;` and `label: statement`

### Preprocessor
- `#define NAME value` — object-like macro
- `#define NAME(a, b) body` — function-like macro
- `#undef NAME`
- `#ifdef NAME` / `#ifndef NAME` / `#else` / `#endif`
- `#if` / `#elif` with constant expressions (arithmetic, comparisons, logical, bitwise)
- `defined(NAME)` operator inside `#if` / `#elif`
- `#include "file"` / `#include <file>` (virtual filesystem)
- Include guards
- `#error "message"` — abort compilation with error
- `#pragma` — parsed and ignored
- `#line` — parsed and accepted
- Stringification operator (`#param` in function-like macros)
- Token pasting operator (`a##b` in function-like macros)

See [PLAN.md](./PLAN.md) for the full roadmap.
