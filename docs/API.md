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

## Supported C Subset (Milestone 1)

```c
int main() {
  return <integer_literal>;
}
```

That's it. Arithmetic, variables, control flow, and more come in later milestones. See [PLAN.md](./PLAN.md) for the roadmap.
