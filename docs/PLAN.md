# gcc.js - Project Plan

A client-side C-to-WebAssembly compiler written in pure TypeScript. No server, no Emscripten, no native dependencies. Takes C source code as a string, produces a runnable WASM module in the browser.

## Approach

**Custom C-subset compiler in TypeScript.**

We write every stage — lexer, parser, codegen — from scratch in TS. Start with the smallest possible C subset and grow it incrementally. This gives us zero dependencies, smallest possible bundle size, full debuggability, and complete control over the compilation pipeline.

## Why not TCC/Clang compiled to WASM?

| Concern        | TCC-to-WASM             | Custom TS compiler      |
| -------------- | ----------------------- | ----------------------- |
| Bundle size    | 500KB - 1MB             | < 50KB (initially)      |
| Dependencies   | Emscripten toolchain    | None                    |
| Debuggability  | Opaque WASM blob        | Pure TS, step-through   |
| Extensibility  | Modify C code, rebuild  | Modify TS, hot-reload   |
| C coverage     | Full C99                | Subset, grows over time |
| Build complexity | Complex cross-compile | Standard bun/vite       |

---

## Milestones

### Milestone 0: Scaffolding (Current)
- [x] Project structure
- [x] Documentation
- [x] Vitest configuration
- [x] Type definitions and interfaces
- [x] Test cases (written before implementation)

### Milestone 1: Return a number [DONE]
Compile `int main() { return 42; }` to a working WASM module.

**What this proves:** The full pipeline works end-to-end.

**Components needed:**
- Lexer: tokenize keywords (`int`, `return`), identifiers, numbers, braces, parens, semicolons
- Parser: parse a function definition with a return statement
- WASM codegen: emit a valid WASM binary with one exported function
- Runtime: instantiate the WASM module and call the exported function

**C subset supported:**
```c
int main() { return <integer_literal>; }
```

### Milestone 2: Arithmetic expressions [DONE]
```c
int main() { return 2 + 3 * 4; }
```
- [x] Operators: `+`, `-`, `*`, `/`, `%`
- [x] Operator precedence (`*`/`/`/`%` binds tighter than `+`/`-`)
- [x] Left associativity (`10 - 3 - 2` = `(10 - 3) - 2`)
- [x] Parenthesized expressions: `(2 + 3) * 4`
- [x] Unary minus: `-42`, `-(-10)`, `-2 + 5`

### Milestone 3: Local variables [DONE]
```c
int main() {
    int x = 10;
    int y = 20;
    return x + y;
}
```
- [x] Variable declarations with initializers (`int x = 10;`)
- [x] Variable references in expressions (`return x + y;`)
- [x] Variable reassignment (`x = x + 1;`)
- [x] Expression statements (`x = 5;`)
- [x] WASM locals (`local.get`, `local.set`)

### Milestone 4: Function parameters and multiple functions [DONE]
```c
int add(int a, int b) { return a + b; }
int main() { return add(3, 4); }
```
- [x] Function parameters (`int add(int a, int b)`)
- [x] Function calls (`add(3, 4)`)
- [x] Nested calls (`double(double(3))`)
- [x] Params + locals together in same function
- [x] Per-function type signatures in WASM
- [x] Multiple function exports callable from JS

### Milestone 5: Control flow
```c
int abs(int x) {
    if (x < 0) return -x;
    return x;
}
```
- `if` / `else`
- Comparison operators: `<`, `>`, `<=`, `>=`, `==`, `!=`
- `while` loops
- `for` loops

### Milestone 6: Pointers and memory
```c
int main() {
    int x = 42;
    int *p = &x;
    return *p;
}
```
- WASM linear memory
- Address-of operator `&`
- Dereference operator `*`
- Pointer arithmetic

### Milestone 7: Strings and printf (via JS bridge)
```c
#include <stdio.h>
int main() {
    printf("Hello, World!\n");
    return 0;
}
```
- String literals stored in WASM memory
- `printf` implemented as an imported JS function
- Minimal libc headers (in-memory)

---

## Technical Stack

| Tool       | Purpose              |
| ---------- | -------------------- |
| Bun        | Runtime & package mgr|
| TypeScript | Language             |
| Vite       | Bundling & dev server|
| Vitest     | Testing              |

## Project Structure

```
gcc.js/
├── docs/
│   ├── PLAN.md              # This file
│   ├── ARCHITECTURE.md      # Compiler architecture
│   └── API.md               # Public API reference
├── src/
│   ├── gcc/
│   │   ├── index.ts         # Public API entry point
│   │   ├── lexer.ts         # Tokenizer
│   │   ├── parser.ts        # AST builder
│   │   ├── codegen.ts       # WASM binary emitter
│   │   ├── wasm.ts          # WASM binary format helpers
│   │   ├── types.ts         # Token, AST, and compiler types
│   │   └── __tests__/
│   │       ├── lexer.test.ts
│   │       ├── parser.test.ts
│   │       ├── codegen.test.ts
│   │       └── integration.test.ts
│   ├── main.ts              # Demo app
│   └── ...
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## Principles

1. **Test-first** — tests are written before implementation
2. **Incremental** — each milestone builds on the last, nothing is throwaway
3. **Pure TypeScript** — no native dependencies, no WASM blobs of other compilers
4. **Spec-driven** — the WASM binary format spec is the source of truth for codegen
5. **Small surface** — the public API is one function: `compile(source: string)`
