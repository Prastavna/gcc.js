# AGENTS.md

## Project Overview

gcc.js is a client-side C-to-WebAssembly compiler written in pure TypeScript. It takes C source code as a string and produces a runnable WASM module. No Emscripten, no native dependencies. There is playground web application as well written in pure TypeScript to try out the library.

## Build & Test

- **Runtime:** Bun (never use npm/npx)
- **Run tests:** `bun test`
- **Run dev server:** `bun run dev`
- **Build:** `bun run build`
- **Test framework:** Vitest

All tests must pass before any change is considered complete. There are currently 295 tests across 5 test files.

## Architecture

The compiler is a four-stage pipeline, each stage a pure function:

```
C source string → Lexer → Parser → Codegen → WASM binary (Uint8Array)
```

| Stage   | File              | Input       | Output          |
|---------|-------------------|-------------|-----------------|
| Lexer   | `src/gcc/lexer.ts`   | `string`    | `Token[]`       |
| Parser  | `src/gcc/parser.ts`  | `Token[]`   | `Program` (AST) |
| Codegen | `src/gcc/codegen.ts` | `Program`   | `Uint8Array`    |

Supporting files:
- `src/gcc/types.ts` — Token types, AST node interfaces, TypeSpecifier, compiler result types
- `src/gcc/wasm.ts` — WASM binary format helpers (LEB128 encoding, opcodes, section builders)
- `src/gcc/index.ts` — Public API entry point (`compile()` function)

## Key Design Decisions

1. **No WAT intermediate** — WASM binary is emitted directly from the AST
2. **Pure functions** — No shared mutable state between pipeline stages
3. **No optimization passes** — Codegen emits naive but correct WASM
4. **Memory only when needed** — Memory section only emitted when pointers, strings, or arrays are used
5. **Address-taken analysis** — Only variables with `&` taken go to linear memory; others stay as fast WASM locals
6. **Type-aware codegen** — `emitExpression` returns a `CType`, callers insert conversions as needed

## Type System

| C type | WASM type | Memory ops                      | sizeof |
|--------|-----------|----------------------------------|--------|
| `char` | i32       | `i32.load8_s` / `i32.store8`    | 1      |
| `int`  | i32       | `i32.load` / `i32.store`        | 4      |
| `long` | i64       | `i64.load` / `i64.store`        | 8      |

Implicit promotion rule: in binary ops, both operands promote to the wider type (char < int < long). Comparisons always return int.

## Test Structure

Tests are in `src/gcc/__tests__/`:

| File                  | What it tests                                      |
|-----------------------|----------------------------------------------------|
| `lexer.test.ts`       | Tokenization of all C constructs                   |
| `parser.test.ts`      | AST generation from token streams                  |
| `codegen.test.ts`     | WASM binary output from AST                        |
| `wasm.test.ts`        | LEB128 encoding and WASM helpers                   |
| `integration.test.ts` | End-to-end: C source → compile → instantiate → run |

Integration tests compile C source and run the resulting WASM module, checking return values.

## Coding Conventions

- TypeScript strict mode
- No external dependencies (pure TS)
- Test-first: tests are written before or alongside implementation
- Each milestone in `docs/PLAN.md` builds incrementally on the last
- The public API surface is one function: `compile(source: string): CompileResult`

## Documentation

- `docs/PLAN.md` — Milestone roadmap with status (Milestones 1-8 done)
- `docs/ARCHITECTURE.md` — Compiler internals and design
- `docs/API.md` — Public API reference and supported C subset

Keep all three docs updated when implementing new features.

