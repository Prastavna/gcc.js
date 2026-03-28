<script setup lang="ts">
defineProps<{
  compiling: boolean
  downloadable: boolean
}>()

const emit = defineEmits<{
  compile: []
  example: [code: string]
  download: []
}>()

const examples: { label: string; code: string }[] = [
  {
    label: 'Return 42',
    code: `int main() {\n    return 42;\n}`,
  },
  {
    label: 'Return 0',
    code: `int main() {\n    return 0;\n}`,
  },
  {
    label: 'Two functions',
    code: `int get_answer() {\n    return 42;\n}\n\nint get_zero() {\n    return 0;\n}`,
  },
  {
    label: 'Large number',
    code: `int main() {\n    return 100000;\n}`,
  },
  {
    label: 'Arithmetic',
    code: `int main() {\n    return 2 + 3 * 4;\n}`,
  },
  {
    label: 'Precedence',
    code: `int main() {\n    return (2 + 3) * 4;\n}`,
  },
  {
    label: 'Unary minus',
    code: `int main() {\n    return -(-10) + 5;\n}`,
  },
  {
    label: 'Variables',
    code: `int main() {\n    int x = 10;\n    int y = 20;\n    return x + y;\n}`,
  },
  {
    label: 'Reassignment',
    code: `int main() {\n    int x = 1;\n    x = x + 1;\n    x = x * 3;\n    return x;\n}`,
  },
  {
    label: 'Function calls',
    code: `int add(int a, int b) {\n    return a + b;\n}\n\nint main() {\n    return add(3, 4);\n}`,
  },
  {
    label: 'Sum of squares',
    code: `int square(int x) {\n    return x * x;\n}\n\nint sum_of_squares(int a, int b) {\n    return square(a) + square(b);\n}\n\nint main() {\n    return sum_of_squares(3, 4);\n}`,
  },
  {
    label: 'Factorial',
    code: `int factorial(int n) {\n    int result = 1;\n    int i = 1;\n    while (i <= n) {\n        result = result * i;\n        i = i + 1;\n    }\n    return result;\n}\n\nint main() {\n    return factorial(5);\n}`,
  },
  {
    label: 'Fibonacci',
    code: `int fib(int n) {\n    int a = 0;\n    int b = 1;\n    for (int i = 0; i < n; i = i + 1) {\n        int temp = b;\n        b = a + b;\n        a = temp;\n    }\n    return a;\n}\n\nint main() {\n    return fib(10);\n}`,
  },
  {
    label: 'If/else',
    code: `int abs(int x) {\n    if (x < 0) {\n        return -x;\n    } else {\n        return x;\n    }\n}\n\nint main() {\n    return abs(-7);\n}`,
  },
  {
    label: 'Swap (pointers)',
    code: `void swap(int *a, int *b) {\n    int tmp = *a;\n    *a = *b;\n    *b = tmp;\n}\n\nint main() {\n    int x = 1;\n    int y = 2;\n    swap(&x, &y);\n    return x * 10 + y;\n}`,
  },
  {
    label: 'Hello World',
    code: `int printf(int ptr);\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}`,
  },
  {
    label: 'Arrays',
    code: `int main() {\n    int arr[5] = {1, 2, 3, 4, 5};\n    int sum = 0;\n    for (int i = 0; i < 5; i++) {\n        sum += arr[i];\n    }\n    return sum;\n}`,
  },
  {
    label: 'Structs',
    code: `struct Point { int x; int y; };\n\nint distance_sq(struct Point p) {\n    return p.x * p.x + p.y * p.y;\n}\n\nint main() {\n    struct Point p;\n    p.x = 3;\n    p.y = 4;\n    return distance_sq(p);\n}`,
  },
  {
    label: 'Struct pointers',
    code: `struct Point { int x; int y; };\n\nvoid set_point(struct Point *p, int x, int y) {\n    p->x = x;\n    p->y = y;\n}\n\nint main() {\n    struct Point p;\n    set_point(&p, 5, 7);\n    return p.x + p.y;\n}`,
  },
  {
    label: 'Dynamic memory',
    code: `int main() {\n    int *arr = malloc(10 * sizeof(int));\n    for (int i = 0; i < 10; i = i + 1) {\n        arr[i] = i * i;\n    }\n    int sum = 0;\n    for (int i = 0; i < 10; i = i + 1) {\n        sum += arr[i];\n    }\n    free(arr);\n    return sum;\n}`,
  },
  {
    label: 'Switch/case',
    code: `int classify(int x) {\n    switch (x) {\n        case 0: return 0;\n        case 1: return 1;\n        case 2: return 2;\n        default: return 99;\n    }\n}\n\nint main() {\n    return classify(0) + classify(1) + classify(5);\n}`,
  },
  {
    label: 'Break & continue',
    code: `int sum_odd(int n) {\n    int sum = 0;\n    for (int i = 0; i < n; i = i + 1) {\n        if (i % 2 == 0) continue;\n        sum = sum + i;\n    }\n    return sum;\n}\n\nint main() {\n    return sum_odd(20);\n}`,
  },
  {
    label: 'Linked list',
    code: `struct Node { int value; struct Node *next; };\n\nstruct Node *push(struct Node *head, int val) {\n    struct Node *n = malloc(sizeof(struct Node));\n    n->value = val;\n    n->next = head;\n    return n;\n}\n\nint sum(struct Node *head) {\n    int total = 0;\n    struct Node *cur = head;\n    while (cur != 0) {\n        total = total + cur->value;\n        cur = cur->next;\n    }\n    return total;\n}\n\nint main() {\n    struct Node *list = 0;\n    for (int i = 1; i <= 10; i = i + 1) {\n        list = push(list, i);\n    }\n    return sum(list);\n}`,
  },
  {
    label: '#define constants',
    code: `#define WIDTH 10\n#define HEIGHT 5\n#define AREA(w, h) ((w) * (h))\n\nint main() {\n    return AREA(WIDTH, HEIGHT);\n}`,
  },
  {
    label: '#ifdef conditional',
    code: `#define USE_FAST\n\n#ifdef USE_FAST\nint compute(int x) {\n    return x * x;\n}\n#else\nint compute(int x) {\n    int result = 0;\n    for (int i = 0; i < x; i++) {\n        result += x;\n    }\n    return result;\n}\n#endif\n\nint main() {\n    return compute(7);\n}`,
  },
  {
    label: 'MAX/MIN macros',
    code: `#define MAX(a, b) ((a) > (b) ? (a) : (b))\n#define MIN(a, b) ((a) < (b) ? (a) : (b))\n#define CLAMP(x, lo, hi) MIN(MAX(x, lo), hi)\n\nint main() {\n    int val = 150;\n    return CLAMP(val, 0, 100);\n}`,
  },
  {
    label: 'Enum + switch',
    code: `enum Color { RED, GREEN, BLUE };\n\nint classify(int c) {\n    switch (c) {\n        case RED: return 0;\n        case GREEN: return 1;\n        case BLUE: return 2;\n        default: return 99;\n    }\n}\n\nint main() {\n    return classify(GREEN);\n}`,
  },
  {
    label: 'Bitwise flags',
    code: `int main() {\n    int flags = 0;\n    flags = flags | (1 << 0);  // set bit 0\n    flags = flags | (1 << 2);  // set bit 2\n    flags = flags & ~(1 << 0); // clear bit 0\n    return flags;  // 4\n}`,
  },
  {
    label: 'Typedef + unsigned',
    code: `typedef unsigned int uint;\ntypedef int bool;\n\nbool is_even(uint x) {\n    return (x & 1) == 0;\n}\n\nint main() {\n    uint x = 42;\n    return is_even(x);\n}`,
  },
  {
    label: 'Do-while loop',
    code: `int main() {\n    int i = 0;\n    do {\n        i = i + 1;\n    } while (i < 5);\n    return i;\n}`,
  },
  {
    label: 'Comma operator',
    code: `int main() {\n    int x = 0;\n    int y = (x = 10, x + 5);\n    return y;\n}`,
  },
  {
    label: 'Goto & labels',
    code: `int main() {\n    int sum = 0;\n    int i = 1;\ntop:\n    if (i > 10) goto done;\n    sum = sum + i;\n    i = i + 1;\n    goto top;\ndone:\n    return sum;\n}`,
  },
  {
    label: 'Float arithmetic',
    code: `float add(float a, float b) {\n    return a + b;\n}\n\nint main() {\n    float x = 3.14f;\n    float y = 2.86f;\n    return (int)add(x, y);\n}`,
  },
  {
    label: 'Double sqrt approx',
    code: `double sqrt_approx(double x) {\n    double guess = x / 2.0;\n    for (int i = 0; i < 20; i = i + 1) {\n        guess = (guess + x / guess) / 2.0;\n    }\n    return guess;\n}\n\nint main() {\n    return (int)sqrt_approx(144.0);\n}`,
  },
  {
    label: 'Mixed int/float',
    code: `int main() {\n    int a = 7;\n    double b = 3.14;\n    float f = 1.5f;\n    return (int)(a + b + (double)f);\n}`,
  },
  {
    label: 'Short type',
    code: `short add_short(short a, short b) {\n    return a + b;\n}\n\nint main() {\n    short s = 10;\n    return add_short(s, (short)5);\n}`,
  },
  {
    label: 'Const & static',
    code: `const int MAX = 100;\nstatic int helper() { return 42; }\n\nint main() {\n    const volatile int x = helper();\n    return x + MAX;\n}`,
  },
  {
    label: '#if / #elif',
    code: `#define VERSION 3\n\n#if VERSION > 2\nint get_value() { return 42; }\n#elif VERSION == 2\nint get_value() { return 20; }\n#else\nint get_value() { return 0; }\n#endif\n\nint main() {\n    return get_value();\n}`,
  },
  {
    label: 'Stringify & paste',
    code: `#define CONCAT(a, b) a##b\n#define MAKE_VAR(n) CONCAT(var, n)\n\nint main() {\n    int MAKE_VAR(1) = 10;\n    int MAKE_VAR(2) = 20;\n    return var1 + var2;\n}`,
  },
  {
    label: 'Function pointers',
    code: `int add(int a, int b) { return a + b; }\nint mul(int a, int b) { return a * b; }\n\nint apply(int (*op)(int, int), int x, int y) {\n    return op(x, y);\n}\n\nint main() {\n    int (*fn)(int, int) = add;\n    int result = apply(fn, 3, 4);\n    fn = mul;\n    return result + fn(5, 6);\n}`,
  },
  {
    label: '2D array',
    code: `int main() {\n    int matrix[3][4];\n    for (int i = 0; i < 3; i = i + 1) {\n        for (int j = 0; j < 4; j = j + 1) {\n            matrix[i][j] = i * 4 + j;\n        }\n    }\n    return matrix[2][3];\n}`,
  },
  {
    label: 'Char array',
    code: `int main() {\n    char name[] = "hello";\n    int sum = 0;\n    for (int i = 0; i < 5; i = i + 1) {\n        sum = sum + name[i];\n    }\n    return sum;\n}`,
  },
  {
    label: 'Array of structs',
    code: `struct Point { int x; int y; };\n\nint main() {\n    struct Point pts[3] = {{1, 2}, {3, 4}, {5, 6}};\n    int sum = 0;\n    for (int i = 0; i < 3; i = i + 1) {\n        sum = sum + pts[i].x + pts[i].y;\n    }\n    return sum;\n}`,
  },
  {
    label: 'Nested structs',
    code: `struct Line {\n    struct Point { int x; int y; } start;\n    struct Point end;\n};\n\nint main() {\n    struct Line ln;\n    ln.start.x = 1;\n    ln.start.y = 2;\n    ln.end.x = 3;\n    ln.end.y = 4;\n\n    struct Line ln2 = ln;\n    ln2.start.x = 99;\n\n    return ln.start.x + ln2.start.x;\n}`,
  },
  {
    label: 'Variadic sum',
    code: `int sum(int count, ...) {\n    int total = 0;\n    va_list args;\n    va_start(args, count);\n    for (int i = 0; i < count; i = i + 1) {\n        total = total + va_arg(args, int);\n    }\n    va_end(args);\n    return total;\n}\n\nint main() {\n    return sum(4, 10, 20, 30, 40);\n}`,
  },
  {
    label: 'Void ptr memcpy',
    code: `void *memcpy(void *dest, void *src, int n) {\n    char *d = (char *)dest;\n    char *s = (char *)src;\n    for (int i = 0; i < n; i = i + 1) {\n        d[i] = s[i];\n    }\n    return dest;\n}\n\nint main() {\n    int a = 42, b = 0;\n    memcpy(&b, &a, sizeof(int));\n    return b;\n}`,
  },
  {
    label: 'Sorted linked list',
    code: `typedef struct { float x, y; } Vec2;\ntypedef struct Node { Vec2 pos; struct Node *next; } Node;\n\nstatic Node *insert_sorted(Node *head, Vec2 v) {\n    Node *n = (Node *)malloc(sizeof(Node));\n    n->pos = v;\n    n->next = 0;\n    if (head == 0 || v.x < head->pos.x) {\n        n->next = head;\n        return n;\n    }\n    Node *cur = head;\n    while (cur->next != 0 && cur->next->pos.x < v.x) {\n        cur = cur->next;\n    }\n    n->next = cur->next;\n    cur->next = n;\n    return head;\n}\n\nint main() {\n    Node *list = 0;\n    float coords[] = {3.0f, 0.0f, 1.0f, 0.0f, 4.0f, 0.0f, 5.0f, 0.0f};\n    for (int i = 0; i < 8; i = i + 2) {\n        Vec2 v;\n        v.x = coords[i];\n        v.y = coords[i + 1];\n        list = insert_sorted(list, v);\n    }\n    float sum = 0.0f;\n    Node *cur = list;\n    while (cur != 0) {\n        sum = sum + cur->pos.x;\n        cur = cur->next;\n    }\n    return (int)sum;\n}`,
  },
]

const showDropdown = ref(false)

function selectExample(code: string) {
  emit('example', code)
  showDropdown.value = false
}

import { ref } from 'vue'
</script>

<template>
  <div class="flex items-center justify-between border-b border-[var(--color-border)] bg-zinc-900 px-4 py-2">
    <!-- Left: title -->
    <div class="flex items-center gap-3">
      <h1 class="text-sm font-bold tracking-tight text-zinc-100">gcc.js</h1>
      <span class="text-xs text-zinc-600">playground</span>
    </div>

    <!-- Right: actions -->
    <div class="flex items-center gap-2">
      <!-- Download button -->
      <button
        v-if="downloadable"
        class="rounded border border-[var(--color-border)] bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors cursor-pointer"
        @click="emit('download')"
      >
        Download .wasm
      </button>

      <!-- Examples dropdown -->
      <div class="relative">
        <button
          class="rounded border border-[var(--color-border)] bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors cursor-pointer"
          @click="showDropdown = !showDropdown"
        >
          Examples
        </button>
        <div
          v-if="showDropdown"
          class="absolute right-0 top-full z-10 mt-1 min-w-[160px] rounded border border-[var(--color-border)] bg-zinc-800 py-1 shadow-xl"
        >
          <button
            v-for="ex in examples"
            :key="ex.label"
            class="block w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 cursor-pointer"
            @click="selectExample(ex.code)"
          >
            {{ ex.label }}
          </button>
        </div>
      </div>

      <!-- Compile button -->
      <button
        :disabled="compiling"
        class="rounded bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-zinc-950 hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors cursor-pointer"
        @click="emit('compile')"
      >
        {{ compiling ? 'Compiling...' : 'Compile' }}
        <kbd class="ml-1.5 text-[10px] opacity-60">Ctrl+Enter</kbd>
      </button>
    </div>
  </div>
</template>
