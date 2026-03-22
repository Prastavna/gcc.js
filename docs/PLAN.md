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

### Milestone 5: Control flow [DONE]
```c
int abs(int x) {
    if (x < 0) return -x;
    return x;
}
```
- [x] `if` / `else` (with blocks and single statements)
- [x] Comparison operators: `<`, `>`, `<=`, `>=`, `==`, `!=`
- [x] `while` loops
- [x] `for` loops (with var decl or expr init)
- [x] Nested control flow (if inside while, etc.)

### Milestone 6: Pointers and memory [DONE]
```c
int main() {
    int x = 42;
    int *p = &x;
    return *p;
}
```
- [x] WASM linear memory (1 page, 64KB)
- [x] Address-of operator `&x`
- [x] Dereference read `*p`
- [x] Dereference write `*p = val`
- [x] Pointer parameters (`void swap(int *a, int *b)`)
- [x] Address-taken variables automatically memory-backed
- [x] Non-address-taken variables stay as fast WASM locals

### Milestone 7: Strings and printf (via JS bridge) [DONE]
```c
int printf(int ptr);
int main() {
    printf("Hello, World!\n");
    return 0;
}
```
- [x] String literals stored in WASM linear memory (DATA section)
- [x] `printf` as an imported function from `env.printf`
- [x] Extern function declarations (`int printf(int ptr);`)
- [x] WASM Import section for extern functions
- [x] Escape sequences: `\n`, `\t`, `\r`, `\\`, `\"`, `\0`
- [x] Null-terminated strings in memory

---

## Phase 2: Towards C89

### Milestone 8: More types and type casting [DONE]
```c
int main() {
    char c = 'A';
    long big = 100000;
    int x = (int)big;
    return c + x;
}
```
- [x] `char` type (8-bit in memory, i32 in WASM locals, sizeof=1)
- [x] `long` type (i64 in WASM, 8 bytes in memory, sizeof=8)
- [x] Character literals (`'A'`, `'\n'`, `'\0'`, `'\\'`)
- [x] Type casting (`(int)expr`, `(char)expr`, `(long)expr`)
- [x] Implicit int promotion in mixed expressions (int+long → long)
- [x] `sizeof(type)` operator (compile-time constant)
- [x] Type-aware function signatures (param/return types in WASM)
- [x] Type-aware memory operations (i32.load8_s for char, i64.load/store for long)
- [x] Argument type conversion in function calls

### Milestone 9: Arrays [DONE]
```c
int main() {
    int arr[5];
    arr[0] = 10;
    arr[1] = 20;
    return arr[0] + arr[1];
}
```
- [x] Fixed-size array declarations (`int arr[5]`)
- [x] Array indexing read (`arr[i]`)
- [x] Array indexing write (`arr[i] = val`)
- [x] Arrays in linear memory (contiguous)
- [x] Array as function parameter (decays to pointer)
- [x] Array initializers (`int arr[3] = {1, 2, 3}`)

### Milestone 10: Structs [DONE]
```c
struct Point { int x; int y; };
int distance_sq(struct Point p) {
    return p.x * p.x + p.y * p.y;
}
int main() {
    struct Point p;
    p.x = 3;
    p.y = 4;
    return distance_sq(p);
}
```
- [x] Struct type declarations (`struct Point { int x; int y; };`)
- [x] Struct variable declarations (`struct Point p;`)
- [x] Member access read/write (`p.x`, `p.x = val`)
- [x] Pointer-to-struct arrow operator read/write (`p->x`, `p->x = val`)
- [x] Struct layout in linear memory with natural alignment
- [x] Struct as function parameter (passed by value via pointer copy)
- [x] Struct pointer parameter (`struct Point *p`)
- [x] `sizeof(struct Point)`
- [x] Mixed field types (char/int/long with padding)

### Milestone 11: Dynamic memory (malloc/free) [DONE]
```c
int printf(int ptr);
int main() {
    int *arr = malloc(10 * sizeof(int));
    for (int i = 0; i < 10; i = i + 1) {
        arr[i] = i * i;
    }
    printf("done\n");
    free(arr);
    return arr[5];
}
```
- [x] Built-in `malloc` (bump allocator on linear memory)
- [x] Built-in `free` (no-op initially, then freelist)
- [x] Pointer indexing (`ptr[i]` as sugar for `*(ptr + i * sizeof(T))`)
- [x] `sizeof` for all types
- [x] Grow memory via `memory.grow` when needed

### Milestone 12: Global variables and static data [DONE]
```c
int counter = 0;
void increment() { counter = counter + 1; }
int main() {
    increment();
    increment();
    return counter;
}
```
- [x] Global variable declarations (outside functions)
- [x] WASM globals (mutable i32/i64)
- [x] Static initialization
- Global arrays and structs (deferred to structs milestone)

### Milestone 13: Switch, break, continue [DONE]
```c
int classify(int x) {
    switch (x) {
        case 0: return 0;
        case 1: return 1;
        default: return 2;
    }
}
int sum_odd(int n) {
    int sum = 0;
    for (int i = 0; i < n; i = i + 1) {
        if (i % 2 == 0) continue;
        sum = sum + i;
    }
    return sum;
}
```
- [x] `switch` / `case` / `default` (nested blocks with dispatch)
- [x] `break` in loops and switch
- [x] `continue` in loops (for-loop correctly runs update before looping)
- [x] Fall-through between cases (natural block nesting)
- Labeled loops (stretch, deferred)

### Milestone 14: Logical operators and comma [DONE]
```c
int main() {
    int x = 5;
    if (x > 0 && x < 10) return 1;
    if (x == 0 || x == 5) return 2;
    int y = (x = 3, x + 1);
    return !y;
}
```
- [x] `&&` (short-circuit AND)
- [x] `||` (short-circuit OR)
- [x] `!` (logical NOT)
- Comma operator (not yet)
- [x] Ternary operator (`a ? b : c`)
- [x] Compound assignment (`+=`, `-=`, `*=`, `/=`, `%=`)
- [x] Increment/decrement (`++`, `--`)

### Milestone 15: Preprocessor [DONE]
```c
#define MAX_SIZE 100
#define SQUARE(x) ((x) * (x))

int main() {
    int arr[MAX_SIZE];
    arr[0] = SQUARE(5);
    return arr[0];
}
```
- [x] `#define` constants (text substitution)
- [x] `#define` function-like macros
- [x] `#ifdef` / `#ifndef` / `#else` / `#endif`
- [x] `#include` (virtual in-memory file system)
- [x] `#undef`
- [x] Line number preservation (blank lines for directives)
- [x] Include guards (`#ifndef`/`#define`/`#endif` pattern)
- [x] Pre-defined macros via options (`defines` parameter)
- [x] Circular include detection (max depth 16)

### Milestone 16: Enums, typedefs, and union [DONE]
```c
typedef unsigned int uint;
enum Color { RED, GREEN, BLUE };
union Value {
    int i;
    char c;
};
int main() {
    enum Color c = GREEN;
    uint x = 42;
    return c + x;
}
```
- [x] `enum` declarations (integer constants, auto-increment, explicit values)
- [x] `typedef` (type aliases for all types including unsigned and struct)
- [x] `union` (overlapping memory layout, sizeof = max field)
- [x] `unsigned int` and `unsigned char` types
- [x] Bitwise operators (`&`, `|`, `^`, `~`, `<<`, `>>`)

### Milestone 17: Complete program target
```c
int printf(int ptr);

struct Node {
    int value;
    struct Node *next;
};

struct Node* push(struct Node *head, int val) {
    struct Node *n = malloc(sizeof(struct Node));
    n->value = val;
    n->next = head;
    return n;
}

int sum_list(struct Node *head) {
    int sum = 0;
    while (head != 0) {
        sum = sum + head->value;
        head = head->next;
    }
    return sum;
}

int main() {
    struct Node *list = 0;
    for (int i = 1; i <= 10; i = i + 1) {
        list = push(list, i);
    }
    return sum_list(list);
}
```
- **Target**: a linked list program that compiles and runs correctly
- Validates: structs, pointers, malloc, loops, function calls all working together
- This is the "graduation" test for the compiler

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
