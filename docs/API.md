# gcc.js - API Reference

## Installation

```ts
import { compile } from "./gcc";
```

No npm package yet. Import directly from source.

---

## `compile(source: string): CompileResult`

Compiles C source code to a WASM binary module.

**Parameters:**
- `source` — C source code as a string

**Returns:** `CompileResult`

```ts
type CompileResult =
  | { ok: true; wasm: Uint8Array }
  | { ok: false; errors: CompileError[] };
```

**Example:**

```ts
const result = compile(`
  int main() { return 42; }
`);

if (result.ok) {
  const module = await WebAssembly.instantiate(result.wasm);
  const exitCode = module.instance.exports.main();
  console.log(exitCode); // 42
}
```

---

## `CompileError`

```ts
interface CompileError {
  stage: "lexer" | "parser" | "codegen";
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

## Supported C Subset (through Milestone 8)

### Types
- `int` (32-bit signed), `char` (8-bit signed), `long` (64-bit signed), `void`
- Type casting: `(int)expr`, `(char)expr`, `(long)expr`
- `sizeof(type)` — compile-time constant (char=1, int=4, long=8)
- Implicit promotion in mixed expressions (int+long → long)

### Literals
- Integer: `42`, `0`, `-1`
- Character: `'A'`, `'\n'`, `'\0'`, `'\t'`
- String: `"hello\n"`

### Declarations
- Functions: `int add(int a, int b) { ... }`
- Extern functions: `int printf(int ptr);`
- Local variables: `int x = 10;`, `char c = 'A';`, `long big = 100000;`
- Global variables: `int counter = 0;`
- Arrays: `int arr[5] = {1, 2, 3, 4, 5};`
- Pointer variables: `int *p = &x;`

### Expressions
- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `&&`, `||`, `!`
- Ternary: `a ? b : c`
- Assignment: `x = val`, `x += val`, `x -= val`, etc.
- Increment/decrement: `++x`, `x++`, `--x`, `x--`
- Pointers: `&x`, `*p`, `*p = val`
- Arrays: `arr[i]`, `arr[i] = val`
- Function calls: `add(3, 4)`

### Statements
- `return expr;`
- `if (cond) { ... } else { ... }`
- `while (cond) { ... }`
- `for (init; cond; update) { ... }`

See [PLAN.md](./PLAN.md) for the full roadmap.
