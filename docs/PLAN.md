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
- [x] **Target**: a linked list program that compiles and runs correctly — **DONE**
- [x] Validates: structs, pointers, malloc, loops, function calls all working together
- [x] Fixed: malloc heap starts at non-zero address (NULL-safe)
- [x] Fixed: struct pointer field declarations (`struct Node *next;`)
- [x] This is the "graduation" test for the compiler

---

## Phase 3: Full C89 Coverage

### Milestone 18: do-while, goto, comma operator
```c
int main() {
    int i = 0;
    do {
        i = i + 1;
    } while (i < 5);

    int x = (1, 2, 3);

    goto done;
    i = 999;
done:
    return i + x;
}
```
- [x] `do { ... } while (cond);` loop
- [x] Comma operator (`(a, b, c)` — evaluates all, returns last)
- [x] `goto` and labels (`goto done; ... done:`)

### Milestone 19: Floating point
```c
double sqrt_approx(double x) {
    double guess = x / 2.0;
    for (int i = 0; i < 20; i = i + 1) {
        guess = (guess + x / guess) / 2.0;
    }
    return guess;
}

int main() {
    float f = 3.14f;
    double d = 2.718281828;
    return (int)(f + (float)d);
}
```
- [x] `float` type (WASM `f32`)
- [x] `double` type (WASM `f64`)
- [x] Floating-point literals (`3.14`, `3.14f`)
- [x] FP arithmetic (`+`, `-`, `*`, `/`)
- [x] FP comparisons (`<`, `>`, `<=`, `>=`, `==`, `!=`)
- [x] Casts between int/float/double (`(int)3.14`, `(double)42`)
- [x] Implicit promotion in mixed expressions (int+double → double)
- [x] `sizeof(float)` = 4, `sizeof(double)` = 8
- [x] FP function parameters and return types

### Milestone 20: short, const, volatile, storage classes
```c
const int MAX = 100;
static int counter = 0;

short add_short(short a, short b) {
    return a + b;
}

int main() {
    register int i;
    const volatile int x = 42;
    short s = 10;
    return add_short(s, (short)5) + MAX;
}
```
- [ ] `short` type (16-bit signed, WASM i32, memory: i32.load16_s / i32.store16)
- [ ] `unsigned short` type
- [ ] `signed` keyword (explicit: `signed char`, `signed int`)
- [ ] `const` qualifier (parsed and accepted, enforced at parse/compile time)
- [ ] `volatile` qualifier (parsed and accepted, no-op for WASM)
- [ ] `static` storage class (file-scope linkage — not exported)
- [ ] `extern` storage class (declaration without definition)
- [ ] `register` storage class (parsed and accepted, hint only)
- [ ] `auto` storage class (parsed and accepted, default for locals)

### Milestone 21: Advanced preprocessor
```c
#if defined(DEBUG) && (VERSION > 2)
int get_value() { return 42; }
#elif VERSION == 1
int get_value() { return 0; }
#else
int get_value() { return -1; }
#endif

#define STRINGIFY(x) #x
#define CONCAT(a, b) a##b

int main() {
    return get_value();
}
```
- [ ] `#if` with constant expressions (arithmetic, comparisons, logical)
- [ ] `#elif` with constant expressions
- [ ] `defined(NAME)` operator inside `#if` / `#elif`
- [ ] `#error "message"` directive
- [ ] Stringification operator (`#param` in function-like macros)
- [ ] Token pasting operator (`a##b` in function-like macros)
- [ ] `#line` directive (update reported line numbers)
- [ ] `#pragma` (parsed and ignored)

### Milestone 22: Forward declarations and function pointers
```c
// Forward declarations
int bar(int x);
int foo(int x) { return x > 0 ? bar(x - 1) : 0; }
int bar(int x) { return x + foo(x - 1); }

// Function pointers
int add(int a, int b) { return a + b; }
int mul(int a, int b) { return a * b; }

int apply(int (*op)(int, int), int x, int y) {
    return op(x, y);
}

int main() {
    int (*fn)(int, int) = add;
    int result = apply(fn, 3, 4);
    fn = mul;
    return result + fn(5, 6);
}
```
- [ ] Forward function declarations (`int foo(int);` before definition)
- [ ] Function pointer types (`int (*fp)(int, int)`)
- [ ] Function pointer variables and assignment
- [ ] Calling through function pointers (`fp(args)`)
- [ ] Function pointers as parameters
- [ ] WASM `call_indirect` and table section for indirect calls
- [ ] `typedef` for function pointer types

### Milestone 23: Multi-dimensional arrays and advanced arrays
```c
int main() {
    int matrix[3][4];
    for (int i = 0; i < 3; i = i + 1) {
        for (int j = 0; j < 4; j = j + 1) {
            matrix[i][j] = i * 4 + j;
        }
    }

    char name[] = "hello";

    struct Point { int x; int y; };
    struct Point pts[3] = {{1, 2}, {3, 4}, {5, 6}};

    int *p = matrix[1];
    return matrix[2][3] + name[0] + pts[1].x;
}
```
- [ ] Multi-dimensional arrays (`int a[3][4]`)
- [ ] Array of structs (`struct Point pts[10]`)
- [ ] `char[]` initialized from string literal (`char s[] = "hello"`)
- [ ] Array decay to pointer (`int *p = arr`)
- [ ] Pointer arithmetic (`p + n`, `p - n`, `p1 - p2`)
- [ ] Row access on 2D arrays (`matrix[i]` decays to `int *`)
- [ ] Nested initializer lists (`{{1, 2}, {3, 4}}`)

### Milestone 24: Struct and union enhancements
```c
struct Line {
    struct Point { int x; int y; } start;
    struct Point end;
};

int main() {
    struct Line ln;
    ln.start.x = 1;
    ln.start.y = 2;
    ln.end.x = 3;
    ln.end.y = 4;

    struct Line ln2 = ln;
    ln2.start.x = 99;

    return ln.start.x + ln2.start.x;
}
```
- [ ] Nested struct definitions (`struct A { struct B { ... } b; }`)
- [ ] Nested member access (`a.b.x`, `a->b.x`)
- [ ] Struct assignment (copy by value: `a = b`)
- [ ] Struct initializer lists (`struct Point p = {1, 2}`)
- [ ] Struct return from functions (`struct Point make_point(int x, int y)`)
- [ ] Anonymous structs/unions inside other structs
- [ ] Bitfield declarations (`int x : 4;`)

### Milestone 25: void pointers and variadic functions
```c
void *memcpy(void *dest, void *src, int n) {
    char *d = (char *)dest;
    char *s = (char *)src;
    for (int i = 0; i < n; i = i + 1) {
        d[i] = s[i];
    }
    return dest;
}

int sum(int count, ...) {
    // simplified variadic — uses stack-based va_list
    int total = 0;
    va_list args;
    va_start(args, count);
    for (int i = 0; i < count; i = i + 1) {
        total = total + va_arg(args, int);
    }
    va_end(args);
    return total;
}

int main() {
    int a = 10, b = 20;
    void *p = &a;
    memcpy(&b, &a, sizeof(int));
    return b + sum(3, 1, 2, 3);
}
```
- [ ] `void *` type (generic pointer, implicit cast to/from any pointer)
- [ ] Casting between `void *` and typed pointers
- [ ] `void *` function parameters and return types
- [ ] Variadic function declarations (`int printf(char *fmt, ...)`)
- [ ] `va_list`, `va_start`, `va_arg`, `va_end` (built-in macros/types)
- [ ] Multiple declarators in one statement (`int a = 10, b = 20;`)

### Milestone 26: C89 graduation test
```c
#include "stdlib.h"

typedef struct {
    float x, y;
} Vec2;

typedef struct Node {
    Vec2 pos;
    struct Node *next;
} Node;

static Node *insert_sorted(Node *head, Vec2 v) {
    Node *n = (Node *)malloc(sizeof(Node));
    n->pos = v;
    n->next = 0;
    if (head == 0 || v.x < head->pos.x) {
        n->next = head;
        return n;
    }
    Node *cur = head;
    while (cur->next != 0 && cur->next->pos.x < v.x) {
        cur = cur->next;
    }
    n->next = cur->next;
    cur->next = n;
    return head;
}

int main() {
    Node *list = 0;
    float coords[] = {3.0f, 1.0f, 4.0f, 1.0f, 5.0f, 9.0f};
    for (int i = 0; i < 6; i = i + 2) {
        Vec2 v;
        v.x = coords[i];
        v.y = coords[i + 1];
        list = insert_sorted(list, v);
    }
    // sum the sorted x coords: 1.0 + 3.0 + 4.0 + 5.0 = 13.0 → truncate to 13
    float sum = 0.0f;
    Node *cur = list;
    while (cur != 0) {
        sum = sum + cur->pos.x;
        cur = cur->next;
    }
    return (int)sum;
}
```
- [ ] **Target**: a non-trivial program using floats, structs, pointers, malloc, typedef, static
- [ ] Validates: the full C89 subset working together as a coherent language
- [ ] This is the C89 "graduation" test for the compiler

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
