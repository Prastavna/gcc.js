# @prastavna/gcc.js

A client-side C-to-WebAssembly compiler written in pure TypeScript. Compiles a substantial subset of C89/ANSI-C to runnable WASM modules directly in the browser or any JavaScript runtime - no server, no Emscripten, no native dependencies.

## Features

- **Zero runtime dependencies** - entire compiler is pure TypeScript
- **Client-side compilation** - runs entirely in the browser or JS runtime
- **Small footprint** - generated compiler bundles to under 50KB
- **Full pipeline** - preprocessor, lexer, parser, and codegen in one package
- **635 passing tests** across 7 test suites
- **CLI support** - compile C files with `npx @prastavna/gcc.js code.c`
- **Interactive playground** - Vue 3 web app for live compilation

## Installation

```bash
npm install @prastavna/gcc.js
```

## CLI Usage

Compile C files to WebAssembly from the command line:

```bash
# Install globally
npm install -g @prastavna/gcc.js

# Or use directly with npx
npx @prastavna/gcc.js code.c                  # Outputs code.wasm
npx @prastavna/gcc.js code.c -o out.wasm      # Custom output file
npx @prastavna/gcc.js code.c -DDEBUG=1        # With preprocessor macros
```

## Quick Start

```ts
import { compile } from "@prastavna/gcc.js";

const result = compile(`
  int square(int x) { return x * x; }
  int main() { return square(7); }
`);

if (result.ok) {
  const module = await WebAssembly.instantiate(result.wasm);
  const exitCode = module.instance.exports.main();
  console.log(exitCode); // 49
}
```

### With preprocessor options

```ts
const result = compile(`
  #include "math.h"
  int main() { return square(6); }
`, {
  files: { "math.h": "int square(int x) { return x * x; }" },
  defines: { DEBUG: "1" },
});
```

### With imported functions

```ts
const result = compile(`
  extern int print(int value);
  int main() { print(42); return 0; }
`);

if (result.ok) {
  const module = await WebAssembly.compile(result.wasm.buffer);
  const instance = await WebAssembly.instantiate(module, {
    env: { print: (v) => console.log(v) },
  });
  instance.exports.main();
}
```

## Supported C Features

### Types

| Category | Types |
|----------|-------|
| Signed integers | `char` (8-bit), `short` (16-bit), `int` (32-bit), `long` (64-bit) |
| Unsigned integers | `unsigned char`, `unsigned short`, `unsigned int` |
| Floating-point | `float` (32-bit), `double` (64-bit) |
| Aggregate | `struct`, `union`, `enum` |
| Pointers | `int *`, `char *`, `void *`, function pointers |
| Arrays | Fixed-size, multi-dimensional, with initializer lists |
| Other | `typedef`, `sizeof()`, type casting, `const`, `volatile`, `static`, `extern` |

### Expressions

- Arithmetic: `+`, `-`, `*`, `/`, `%`
- Comparison: `==`, `!=`, `<`, `>`, `<=`, `>=`
- Logical: `&&`, `||`, `!` (with short-circuit evaluation)
- Bitwise: `&`, `|`, `^`, `~`, `<<`, `>>`
- Assignment: `=`, `+=`, `-=`, `*=`, `/=`, `%=`, `|=`, `&=`, `^=`, `<<=`, `>>=`
- Increment/decrement: `++x`, `x++`, `--x`, `x--`
- Ternary: `a ? b : c`
- Pointer operations: `&var`, `*ptr`, `ptr->field`
- Array/member access: `arr[i]`, `s.field`, `p->field`, `matrix[i][j]`
- Function pointers and indirect calls
- Comma operator

### Control Flow

- `if` / `else`
- `while`, `do` / `while`, `for`
- `switch` / `case` / `default`
- `break`, `continue`, `return`
- `goto` and labeled statements

### Preprocessor

- Object-like macros: `#define X 42`
- Function-like macros: `#define SQ(x) ((x)*(x))`
- Conditionals: `#ifdef`, `#ifndef`, `#if`, `#elif`, `#else`, `#endif`
- `#include "file"` / `#include <file>` via virtual filesystem
- `#undef`, `#error`, `#pragma`, `#line`
- `defined()` operator, stringification (`#`), token pasting (`##`)
- Include guards and circular include detection

### Declarations

- Functions with parameters and return types
- Forward declarations and extern imports
- Global and local variables with initializers
- Structs with nested definitions, initializer lists, copy-by-value
- Unions, enums with explicit/auto-increment values
- Typedef aliases (including for structs and function pointers)
- Variadic functions with `va_list`, `va_start`, `va_arg`, `va_end`
- Multiple declarators: `int a = 10, b = 20;`

## Caveats and Limitations

### Not Supported

- **No recursion in macros** - prevented by the "blue paint" rule
- **No struct/union bit-fields** or `#pragma pack`
- **No C99/C11 features** - `_Bool`, `_Generic`, `_Pragma`, VLAs, designated initializers
- **No C++ features** - templates, classes, namespaces, etc.
- **No standard library** - `printf`, `malloc`, etc. must be provided via imports or implemented in C
- **No linker** - single translation unit only (one source string per compile)
- **No optimization passes** - codegen emits correct but naive WASM
- **No WAT output** - binary WASM only
- **No incremental compilation** - each `compile()` call is independent

### Pointer Restrictions

- No arbitrary pointer arithmetic beyond `ptr[i]` indexing
- No arbitrary pointer casts except `void *` and `(char *)` for byte access
- NULL (address 0) is reserved; the built-in bump allocator never returns 0

### Memory Model

- WASM linear memory (64KB minimum, grows via `memory.grow`)
- First 8 bytes reserved as NULL guard
- Simple bump allocator for heap (no `free`, no fragmentation recovery)
- Stack variables are allocated at compile time
- Memory section is only emitted when pointers, strings, or arrays are used

### Type System

- Implicit promotion: `char` < `short` < `int` < `long` < `float` < `double`
- `const` is enforced at compile time; `volatile` and `register` are accepted but have no effect
- `static` functions are not exported from the WASM module
- No bit-fields in structs, no tagged unions

## API

### `compile(source, options?)`

Main entry point. Returns `{ ok: true, wasm: Uint8Array }` on success or `{ ok: false, errors: CompileError[] }` on failure.

```ts
interface PreprocessorOptions {
  files?: Record<string, string>;    // Virtual filesystem for #include
  defines?: Record<string, string>;  // Pre-defined macros (-D equivalent)
}

interface CompileError {
  stage: "preprocessor" | "lexer" | "parser" | "codegen";
  message: string;
  line: number;
  col: number;
}
```

### Lower-level APIs

For advanced usage, individual pipeline stages are exported:

```ts
import { preprocess, tokenize, parse, generate } from "@prastavna/gcc.js";
// preprocess: source → preprocessed source
// tokenize:   source → Token[]
// parse:      Token[] → AST
// generate:   AST → Uint8Array
```

## Compiler Pipeline

```
C source string
      |
      v
 Preprocessor    #define, #ifdef, #include expansion
      |
      v
    Lexer         Tokenization into Token[]
      |
      v
    Parser        Recursive descent → AST
      |
      v
   Codegen        Direct WASM binary emission
      |
      v
 Uint8Array       Valid WASM module
```

Each stage is a pure function with no shared mutable state.

## Development

```bash
# Install dependencies
bun install

# Run all 625 tests
bun test

# Watch mode
bun run test:watch

# Build
bun run build
```

### Playground

An interactive web playground built with Vue 3, Tailwind CSS, and Shiki syntax highlighting:

```bash
cd playground
bun install
bun run dev    # http://localhost:5173
```

Features:
- Live C code editor with line numbers
- Real-time compilation and WASM execution
- Ctrl+Enter to compile
- Pre-loaded example programs
- Export compiled WASM binary

### Project Structure

```
@prastavna/gcc.js/
├── src/
│   ├── cli.ts              # CLI entry point (npx @prastavna/gcc.js)
│   ├── gcc/
│   │   ├── index.ts        # Main compile() API
│   │   ├── preprocessor.ts # C preprocessor
│   │   ├── lexer.ts        # Tokenizer
│   │   ├── parser.ts       # Recursive descent parser
│   │   ├── codegen.ts      # WASM binary code generator
│   │   ├── wasm.ts         # WASM binary format helpers (LEB128)
│   │   ├── types.ts        # Token types, AST nodes, CType enum
│   │   └── __tests__/      # 625 tests across 6 files
│   └── __tests__/
│       └── cli.test.ts     # CLI tests
├── playground/             # Vue 3 interactive web app
├── docs/
│   ├── PLAN.md             # Development roadmap
│   ├── ARCHITECTURE.md     # Compiler internals
│   └── API.md              # Full API reference
└── package.json
```

## License

MIT
