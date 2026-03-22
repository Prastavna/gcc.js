import { describe, it, expect } from "vitest";
import { compile } from "../index.ts";
import type { PreprocessorOptions } from "../preprocessor.ts";

/**
 * Helper: compile C source and instantiate the WASM module
 */
async function compileAndInstantiate(source: string, options?: PreprocessorOptions): Promise<WebAssembly.Instance> {
  const result = compile(source, options);
  if (!result.ok) throw new Error(`compile failed: ${result.errors[0].message}`);
  const module = await WebAssembly.compile(result.wasm.buffer as ArrayBuffer);
  return WebAssembly.instantiate(module);
}

describe("integration: compile() end-to-end", () => {
  describe("hello world: int main() { return 42; }", () => {
    it("compiles successfully", () => {
      const result = compile("int main() { return 42; }");
      expect(result.ok).toBe(true);
    });

    it("produces a valid WASM module", async () => {
      const result = compile("int main() { return 42; }");
      if (!result.ok) throw new Error("compile failed");
      const module = await WebAssembly.compile(result.wasm.buffer as ArrayBuffer);
      expect(module).toBeInstanceOf(WebAssembly.Module);
    });

    it("main() returns 42", async () => {
      const instance = await compileAndInstantiate("int main() { return 42; }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(42);
    });
  });

  describe("return 0 (exit success)", () => {
    it("main() returns 0", async () => {
      const instance = await compileAndInstantiate("int main() { return 0; }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(0);
    });
  });

  describe("multiple functions", () => {
    it("compiles and exports two functions", async () => {
      const source = `
        int get_answer() { return 42; }
        int get_zero()   { return 0;  }
      `;
      const instance = await compileAndInstantiate(source);
      const getAnswer = instance.exports.get_answer as () => number;
      const getZero = instance.exports.get_zero as () => number;
      expect(getAnswer()).toBe(42);
      expect(getZero()).toBe(0);
    });
  });

  describe("whitespace variations", () => {
    it("handles minimal whitespace", async () => {
      const instance = await compileAndInstantiate("int main(){return 42;}");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(42);
    });

    it("handles excessive whitespace", async () => {
      const source = `
        int    main  (   )
        {

          return    42   ;

        }
      `;
      const instance = await compileAndInstantiate(source);
      const main = instance.exports.main as () => number;
      expect(main()).toBe(42);
    });
  });

  describe("arithmetic (milestone 2)", () => {
    it("2 + 3 = 5", async () => {
      const instance = await compileAndInstantiate("int main() { return 2 + 3; }");
      expect((instance.exports.main as () => number)()).toBe(5);
    });

    it("10 - 4 = 6", async () => {
      const instance = await compileAndInstantiate("int main() { return 10 - 4; }");
      expect((instance.exports.main as () => number)()).toBe(6);
    });

    it("3 * 7 = 21", async () => {
      const instance = await compileAndInstantiate("int main() { return 3 * 7; }");
      expect((instance.exports.main as () => number)()).toBe(21);
    });

    it("10 / 3 = 3 (integer division)", async () => {
      const instance = await compileAndInstantiate("int main() { return 10 / 3; }");
      expect((instance.exports.main as () => number)()).toBe(3);
    });

    it("10 % 3 = 1", async () => {
      const instance = await compileAndInstantiate("int main() { return 10 % 3; }");
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("operator precedence: 2 + 3 * 4 = 14", async () => {
      const instance = await compileAndInstantiate("int main() { return 2 + 3 * 4; }");
      expect((instance.exports.main as () => number)()).toBe(14);
    });

    it("parentheses override precedence: (2 + 3) * 4 = 20", async () => {
      const instance = await compileAndInstantiate("int main() { return (2 + 3) * 4; }");
      expect((instance.exports.main as () => number)()).toBe(20);
    });

    it("left associativity: 10 - 3 - 2 = 5", async () => {
      const instance = await compileAndInstantiate("int main() { return 10 - 3 - 2; }");
      expect((instance.exports.main as () => number)()).toBe(5);
    });

    it("complex: (1 + 2) * (3 + 4) = 21", async () => {
      const instance = await compileAndInstantiate("int main() { return (1 + 2) * (3 + 4); }");
      expect((instance.exports.main as () => number)()).toBe(21);
    });

    it("complex: 100 - 10 * 5 + 3 = 53", async () => {
      const instance = await compileAndInstantiate("int main() { return 100 - 10 * 5 + 3; }");
      expect((instance.exports.main as () => number)()).toBe(53);
    });

    it("unary minus: -42", async () => {
      const instance = await compileAndInstantiate("int main() { return -42; }");
      expect(((instance.exports.main as () => number)()) | 0).toBe(-42);
    });

    it("unary minus in expression: -2 + 5 = 3", async () => {
      const instance = await compileAndInstantiate("int main() { return -2 + 5; }");
      expect((instance.exports.main as () => number)()).toBe(3);
    });

    it("double negation: -(-10) = 10", async () => {
      const instance = await compileAndInstantiate("int main() { return -(-10); }");
      expect((instance.exports.main as () => number)()).toBe(10);
    });

    it("no spaces: 2+3*4 = 14", async () => {
      const instance = await compileAndInstantiate("int main() { return 2+3*4; }");
      expect((instance.exports.main as () => number)()).toBe(14);
    });
  });

  describe("local variables (milestone 3)", () => {
    it("int x = 42; return x;", async () => {
      const source = "int main() { int x = 42; return x; }";
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("int x = 10; int y = 20; return x + y;", async () => {
      const source = "int main() { int x = 10; int y = 20; return x + y; }";
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(30);
    });

    it("variable with expression initializer", async () => {
      const source = "int main() { int x = 2 + 3; return x * 4; }";
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(20);
    });

    it("three variables", async () => {
      const source = `int main() {
        int a = 1;
        int b = 2;
        int c = 3;
        return a + b + c;
      }`;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(6);
    });

    it("variable used in complex expression", async () => {
      const source = `int main() {
        int x = 10;
        int y = 3;
        return x * y + x - y;
      }`;
      const instance = await compileAndInstantiate(source);
      // 10 * 3 + 10 - 3 = 30 + 10 - 3 = 37
      expect((instance.exports.main as () => number)()).toBe(37);
    });

    it("variable initialized from another variable", async () => {
      const source = `int main() {
        int x = 5;
        int y = x + 1;
        return y;
      }`;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(6);
    });

    it("variable reassignment", async () => {
      const source = `int main() {
        int x = 1;
        x = 42;
        return x;
      }`;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("reassignment with expression", async () => {
      const source = `int main() {
        int x = 10;
        x = x + 5;
        return x;
      }`;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(15);
    });

    it("multiple reassignments", async () => {
      const source = `int main() {
        int x = 1;
        x = x + 1;
        x = x * 3;
        return x;
      }`;
      const instance = await compileAndInstantiate(source);
      // x = 1, x = 2, x = 6
      expect((instance.exports.main as () => number)()).toBe(6);
    });
  });

  describe("function parameters and calls (milestone 4)", () => {
    it("function with one param: identity(42) = 42", async () => {
      const source = `
        int identity(int x) { return x; }
        int main() { return identity(42); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("function with two params: add(3, 4) = 7", async () => {
      const source = `
        int add(int a, int b) { return a + b; }
        int main() { return add(3, 4); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(7);
    });

    it("params used in arithmetic", async () => {
      const source = `
        int calc(int x, int y) { return x * y + x; }
        int main() { return calc(5, 3); }
      `;
      const instance = await compileAndInstantiate(source);
      // 5*3 + 5 = 20
      expect((instance.exports.main as () => number)()).toBe(20);
    });

    it("nested function calls: double(double(3)) = 12", async () => {
      const source = `
        int double(int x) { return x + x; }
        int main() { return double(double(3)); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(12);
    });

    it("calling with expression arguments", async () => {
      const source = `
        int add(int a, int b) { return a + b; }
        int main() { return add(1 + 2, 3 * 4); }
      `;
      const instance = await compileAndInstantiate(source);
      // add(3, 12) = 15
      expect((instance.exports.main as () => number)()).toBe(15);
    });

    it("three params", async () => {
      const source = `
        int sum3(int a, int b, int c) { return a + b + c; }
        int main() { return sum3(10, 20, 30); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(60);
    });

    it("params and locals together", async () => {
      const source = `
        int compute(int x, int y) {
          int sum = x + y;
          int product = x * y;
          return sum + product;
        }
        int main() { return compute(3, 4); }
      `;
      const instance = await compileAndInstantiate(source);
      // sum=7, product=12, 7+12=19
      expect((instance.exports.main as () => number)()).toBe(19);
    });

    it("multiple functions calling each other", async () => {
      const source = `
        int square(int x) { return x * x; }
        int sum_of_squares(int a, int b) { return square(a) + square(b); }
        int main() { return sum_of_squares(3, 4); }
      `;
      const instance = await compileAndInstantiate(source);
      // 9 + 16 = 25
      expect((instance.exports.main as () => number)()).toBe(25);
    });

    it("exported function with params can be called from JS", async () => {
      const source = `
        int add(int a, int b) { return a + b; }
      `;
      const instance = await compileAndInstantiate(source);
      const add = instance.exports.add as (a: number, b: number) => number;
      expect(add(10, 20)).toBe(30);
      expect(add(0, 0)).toBe(0);
      expect(add(100, 200)).toBe(300);
    });

    it("zero-arg call to function defined later still works", async () => {
      // Functions are all declared at module level, order shouldn't matter for calls
      const source = `
        int main() { return get_value(); }
        int get_value() { return 99; }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(99);
    });
  });

  describe("control flow (milestone 5)", () => {
    it("if: returns branch based on condition", async () => {
      const source = `
        int max(int a, int b) {
          if (a > b) return a;
          return b;
        }
        int main() { return max(5, 3); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(5);
    });

    it("if/else", async () => {
      const source = `
        int abs(int x) {
          if (x < 0) {
            return -x;
          } else {
            return x;
          }
        }
        int main() { return abs(-7); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(7);
    });

    it("== comparison", async () => {
      const source = `
        int is_zero(int x) {
          if (x == 0) return 1;
          return 0;
        }
        int main() { return is_zero(0); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("!= comparison", async () => {
      const source = `
        int is_nonzero(int x) {
          if (x != 0) return 1;
          return 0;
        }
        int main() { return is_nonzero(5); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("<= and >= comparisons", async () => {
      const source = `
        int clamp(int x, int lo, int hi) {
          if (x <= lo) return lo;
          if (x >= hi) return hi;
          return x;
        }
        int main() { return clamp(50, 0, 10); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(10);
    });

    it("while loop: sum 1 to 10", async () => {
      const source = `
        int main() {
          int sum = 0;
          int i = 1;
          while (i <= 10) {
            sum = sum + i;
            i = i + 1;
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(55);
    });

    it("while loop: factorial", async () => {
      const source = `
        int factorial(int n) {
          int result = 1;
          int i = 1;
          while (i <= n) {
            result = result * i;
            i = i + 1;
          }
          return result;
        }
        int main() { return factorial(5); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(120);
    });

    it("for loop: sum 1 to 5", async () => {
      const source = `
        int main() {
          int sum = 0;
          for (int i = 1; i <= 5; i = i + 1) {
            sum = sum + i;
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(15);
    });

    it("for loop: fibonacci", async () => {
      const source = `
        int fib(int n) {
          int a = 0;
          int b = 1;
          for (int i = 0; i < n; i = i + 1) {
            int temp = b;
            b = a + b;
            a = temp;
          }
          return a;
        }
        int main() { return fib(10); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(55);
    });

    it("nested if inside while", async () => {
      const source = `
        int count_even(int n) {
          int count = 0;
          int i = 0;
          while (i < n) {
            if (i % 2 == 0) {
              count = count + 1;
            }
            i = i + 1;
          }
          return count;
        }
        int main() { return count_even(10); }
      `;
      const instance = await compileAndInstantiate(source);
      // 0,2,4,6,8 = 5 even numbers
      expect((instance.exports.main as () => number)()).toBe(5);
    });

    it("if/else with blocks", async () => {
      const source = `
        int sign(int x) {
          if (x > 0) {
            return 1;
          } else {
            if (x < 0) {
              return -1;
            } else {
              return 0;
            }
          }
        }
        int main() { return sign(-5); }
      `;
      const instance = await compileAndInstantiate(source);
      expect(((instance.exports.main as () => number)()) | 0).toBe(-1);
    });
  });

  describe("pointers and memory (milestone 6)", () => {
    it("address-of and dereference: basic round-trip", async () => {
      const source = `
        int main() {
          int x = 42;
          int *p = &x;
          return *p;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("write through pointer", async () => {
      const source = `
        int main() {
          int x = 10;
          int *p = &x;
          *p = 99;
          return x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(99);
    });

    it("two variables, pointer to each", async () => {
      const source = `
        int main() {
          int a = 1;
          int b = 2;
          int *pa = &a;
          int *pb = &b;
          return *pa + *pb;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(3);
    });

    it("pointer arithmetic: adjacent address-taken vars", async () => {
      const source = `
        int main() {
          int a = 10;
          int b = 20;
          int *p = &a;
          int *q = &b;
          return *p + *q;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(30);
    });

    it("swap via pointers", async () => {
      const source = `
        void swap(int *a, int *b) {
          int tmp = *a;
          *a = *b;
          *b = tmp;
        }
        int main() {
          int x = 1;
          int y = 2;
          swap(&x, &y);
          return x * 10 + y;
        }
      `;
      const instance = await compileAndInstantiate(source);
      // x=2, y=1, so 2*10+1 = 21
      expect((instance.exports.main as () => number)()).toBe(21);
    });
  });

  describe("strings and printf (milestone 7)", () => {
    /**
     * Helper: compile and instantiate with printf bridge.
     * Collects printf output into an array.
     */
    async function compileWithPrintf(source: string): Promise<{ instance: WebAssembly.Instance; output: string[] }> {
      const result = compile(source);
      if (!result.ok) throw new Error(`compile failed: ${result.errors[0].message}`);
      const module = await WebAssembly.compile(result.wasm.buffer as ArrayBuffer);
      const output: string[] = [];
      const instance = await WebAssembly.instantiate(module, {
        env: {
          printf: (ptr: number) => {
            // Read null-terminated string from memory
            const mem = new Uint8Array((instance.exports.memory as WebAssembly.Memory).buffer);
            let str = "";
            let i = ptr;
            while (mem[i] !== 0) {
              str += String.fromCharCode(mem[i]);
              i++;
            }
            output.push(str);
            return str.length;
          },
        },
      });
      return { instance, output };
    }

    it("printf with string literal", async () => {
      const source = `
        int printf(int ptr);
        int main() {
          printf("Hello, World!\\n");
          return 0;
        }
      `;
      const { instance, output } = await compileWithPrintf(source);
      const main = instance.exports.main as () => number;
      main();
      expect(output).toEqual(["Hello, World!\n"]);
    });

    it("multiple printf calls", async () => {
      const source = `
        int printf(int ptr);
        int main() {
          printf("hello ");
          printf("world");
          return 0;
        }
      `;
      const { instance, output } = await compileWithPrintf(source);
      (instance.exports.main as () => number)();
      expect(output).toEqual(["hello ", "world"]);
    });

    it("string literal as function argument", async () => {
      const source = `
        int printf(int ptr);
        int print_msg(int msg) {
          printf(msg);
          return 0;
        }
        int main() {
          print_msg("test message");
          return 0;
        }
      `;
      const { instance, output } = await compileWithPrintf(source);
      (instance.exports.main as () => number)();
      expect(output).toEqual(["test message"]);
    });

    it("empty string", async () => {
      const source = `
        int printf(int ptr);
        int main() {
          printf("");
          return 0;
        }
      `;
      const { instance, output } = await compileWithPrintf(source);
      (instance.exports.main as () => number)();
      expect(output).toEqual([""]);
    });

    it("string with escape sequences", async () => {
      const source = `
        int printf(int ptr);
        int main() {
          printf("a\\tb\\nc");
          return 0;
        }
      `;
      const { instance, output } = await compileWithPrintf(source);
      (instance.exports.main as () => number)();
      expect(output).toEqual(["a\tb\nc"]);
    });
  });

  describe("logical operators (milestone 8)", () => {
    it("&& returns 1 when both true", async () => {
      const source = `
        int main() {
          int x = 5;
          int y = 3;
          if (x > 0 && y > 0) return 1;
          return 0;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("&& returns 0 when left is false (short-circuit)", async () => {
      const source = `
        int main() {
          int x = 0;
          if (x && 1) return 1;
          return 0;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(0);
    });

    it("&& returns 0 when right is false", async () => {
      const source = `
        int main() {
          if (1 && 0) return 1;
          return 0;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(0);
    });

    it("|| returns 1 when left is true (short-circuit)", async () => {
      const source = `
        int main() {
          if (1 || 0) return 1;
          return 0;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("|| returns 1 when right is true", async () => {
      const source = `
        int main() {
          if (0 || 1) return 1;
          return 0;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("|| returns 0 when both false", async () => {
      const source = `
        int main() {
          if (0 || 0) return 1;
          return 0;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(0);
    });

    it("! negates truthy to 0", async () => {
      const source = "int main() { return !5; }";
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(0);
    });

    it("! negates 0 to 1", async () => {
      const source = "int main() { return !0; }";
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("double negation !!x", async () => {
      const source = "int main() { return !!42; }";
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("complex: x > 0 && x < 10", async () => {
      const source = `
        int in_range(int x) {
          if (x > 0 && x < 10) return 1;
          return 0;
        }
        int main() { return in_range(5); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("complex: x == 0 || x == 5", async () => {
      const source = `
        int check(int x) {
          if (x == 0 || x == 5) return 1;
          return 0;
        }
        int main() { return check(5); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("&& has higher precedence than ||", async () => {
      // 1 || 0 && 0 should be 1 (because && binds tighter: 1 || (0 && 0) = 1 || 0 = 1)
      const source = "int main() { return 1 || 0 && 0; }";
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("&& short-circuits: does not evaluate right when left is 0", async () => {
      // If short-circuit works, the division by zero never happens
      const source = `
        int main() {
          int x = 0;
          if (x && (10 / x > 0)) return 1;
          return 42;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("|| short-circuits: does not evaluate right when left is nonzero", async () => {
      const source = `
        int main() {
          int x = 1;
          if (x || (10 / 0 > 0)) return 42;
          return 0;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });
  });

  describe("ternary operator (milestone 8)", () => {
    it("condition true: returns consequent", async () => {
      const source = "int main() { return 1 ? 42 : 99; }";
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("condition false: returns alternate", async () => {
      const source = "int main() { return 0 ? 42 : 99; }";
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(99);
    });

    it("ternary with comparison condition", async () => {
      const source = `
        int abs(int x) {
          return x >= 0 ? x : -x;
        }
        int main() { return abs(-7); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(7);
    });

    it("ternary with variable", async () => {
      const source = `
        int main() {
          int x = 5;
          int y = x > 3 ? x * 2 : x + 1;
          return y;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(10);
    });

    it("nested ternary", async () => {
      const source = `
        int classify(int x) {
          return x > 0 ? 1 : x < 0 ? -1 : 0;
        }
        int main() { return classify(0); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(0);
    });

    it("ternary in function argument", async () => {
      const source = `
        int identity(int x) { return x; }
        int main() {
          int x = 1;
          return identity(x ? 42 : 0);
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });
  });

  describe("increment/decrement (milestone 8)", () => {
    it("prefix ++x returns new value", async () => {
      const source = `
        int main() {
          int x = 5;
          return ++x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(6);
    });

    it("postfix x++ returns old value", async () => {
      const source = `
        int main() {
          int x = 5;
          return x++;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(5);
    });

    it("postfix x++ actually increments", async () => {
      const source = `
        int main() {
          int x = 5;
          x++;
          return x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(6);
    });

    it("prefix --x returns new value", async () => {
      const source = `
        int main() {
          int x = 5;
          return --x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(4);
    });

    it("postfix x-- returns old value", async () => {
      const source = `
        int main() {
          int x = 5;
          return x--;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(5);
    });

    it("postfix x-- actually decrements", async () => {
      const source = `
        int main() {
          int x = 5;
          x--;
          return x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(4);
    });

    it("++x in for loop", async () => {
      const source = `
        int main() {
          int sum = 0;
          for (int i = 0; i < 5; ++i) {
            sum = sum + i;
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 0+1+2+3+4 = 10
      expect((instance.exports.main as () => number)()).toBe(10);
    });

    it("i++ in for loop", async () => {
      const source = `
        int main() {
          int sum = 0;
          for (int i = 0; i < 5; i++) {
            sum = sum + i;
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(10);
    });
  });

  describe("compound assignment (milestone 8)", () => {
    it("x += 5", async () => {
      const source = `
        int main() {
          int x = 10;
          x += 5;
          return x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(15);
    });

    it("x -= 3", async () => {
      const source = `
        int main() {
          int x = 10;
          x -= 3;
          return x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(7);
    });

    it("x *= 4", async () => {
      const source = `
        int main() {
          int x = 5;
          x *= 4;
          return x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(20);
    });

    it("x /= 2", async () => {
      const source = `
        int main() {
          int x = 10;
          x /= 2;
          return x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(5);
    });

    it("x %= 3", async () => {
      const source = `
        int main() {
          int x = 10;
          x %= 3;
          return x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("compound in loop: sum += i", async () => {
      const source = `
        int main() {
          int sum = 0;
          for (int i = 1; i <= 10; i++) {
            sum += i;
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(55);
    });

    it("chained compound: x += 1; x *= 3", async () => {
      const source = `
        int main() {
          int x = 2;
          x += 1;
          x *= 3;
          return x;
        }
      `;
      const instance = await compileAndInstantiate(source);
      // (2+1)*3 = 9
      expect((instance.exports.main as () => number)()).toBe(9);
    });
  });

  describe("comments (milestone 8)", () => {
    it("single-line comment is ignored", async () => {
      const source = `
        int main() {
          // this is a comment
          return 42;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("multi-line comment is ignored", async () => {
      const source = `
        int main() {
          /* this is
             a multi-line
             comment */
          return 42;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("comment after code on same line", async () => {
      const source = `
        int main() {
          int x = 10; // set x
          return x; // done
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(10);
    });
  });

  describe("combined milestone 8 features", () => {
    it("FizzBuzz-style classification using all features", async () => {
      const source = `
        int classify(int n) {
          int r = n % 3 == 0 && n % 5 == 0 ? 3
                : n % 3 == 0 ? 1
                : n % 5 == 0 ? 2
                : 0;
          return r;
        }
        int main() { return classify(15); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(3);
    });

    it("loop with ++, +=, &&", async () => {
      const source = `
        int main() {
          int sum = 0;
          int count = 0;
          for (int i = 0; i < 20; i++) {
            if (i % 2 == 0 && i > 0) {
              sum += i;
              count++;
            }
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      // even numbers > 0 and < 20: 2+4+6+8+10+12+14+16+18 = 90
      expect((instance.exports.main as () => number)()).toBe(90);
    });

    it("ternary used as initializer", async () => {
      const source = `
        int main() {
          int x = 10;
          int sign = x > 0 ? 1 : x < 0 ? -1 : 0;
          return sign;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("logical not combined with ternary", async () => {
      const source = `
        int main() {
          int x = 0;
          return !x ? 42 : 0;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });
  });

  describe("global variables (milestone 9)", () => {
    it("basic global variable read", async () => {
      const source = `
        int counter = 42;
        int main() { return counter; }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("global variable write", async () => {
      const source = `
        int counter = 0;
        int main() {
          counter = 10;
          return counter;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(10);
    });

    it("global modified by function", async () => {
      const source = `
        int counter = 0;
        void increment() { counter = counter + 1; }
        int main() {
          increment();
          increment();
          increment();
          return counter;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(3);
    });

    it("global with compound assignment", async () => {
      const source = `
        int total = 0;
        int main() {
          total += 10;
          total += 20;
          return total;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(30);
    });

    it("global with ++", async () => {
      const source = `
        int count = 0;
        int main() {
          count++;
          count++;
          count++;
          return count;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(3);
    });

    it("global prefix ++ returns new value", async () => {
      const source = `
        int x = 5;
        int main() { return ++x; }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(6);
    });

    it("global postfix ++ returns old value", async () => {
      const source = `
        int x = 5;
        int main() { return x++; }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(5);
    });

    it("multiple global variables", async () => {
      const source = `
        int x = 10;
        int y = 20;
        int main() { return x + y; }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(30);
    });

    it("global and local with same logic", async () => {
      const source = `
        int g = 100;
        int main() {
          int l = 50;
          return g + l;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(150);
    });

    it("global shared between functions", async () => {
      const source = `
        int state = 0;
        void set_state(int v) { state = v; }
        int get_state() { return state; }
        int main() {
          set_state(42);
          return get_state();
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("global counter with loop", async () => {
      const source = `
        int sum = 0;
        int main() {
          for (int i = 1; i <= 10; i++) {
            sum += i;
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(55);
    });

    it("global initialized to zero", async () => {
      const source = `
        int x = 0;
        int main() { return x; }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(0);
    });

    it("global with negative initializer", async () => {
      const source = `
        int x = -1;
        int main() { return x; }
      `;
      const instance = await compileAndInstantiate(source);
      expect(((instance.exports.main as () => number)()) | 0).toBe(-1);
    });

    it("global state persists across function calls", async () => {
      const source = `
        int calls = 0;
        int count_call() {
          calls++;
          return calls;
        }
        int main() {
          count_call();
          count_call();
          return count_call();
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(3);
    });
  });

  describe("arrays (milestone 9)", () => {
    it("basic array write and read", async () => {
      const source = `
        int main() {
          int arr[5];
          arr[0] = 10;
          return arr[0];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(10);
    });

    it("multiple array indices", async () => {
      const source = `
        int main() {
          int arr[5];
          arr[0] = 10;
          arr[1] = 20;
          return arr[0] + arr[1];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(30);
    });

    it("array initializer", async () => {
      const source = `
        int main() {
          int arr[3] = {1, 2, 3};
          return arr[0] + arr[1] + arr[2];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(6);
    });

    it("array in for loop", async () => {
      const source = `
        int main() {
          int arr[5];
          for (int i = 0; i < 5; i++) {
            arr[i] = i * 10;
          }
          return arr[0] + arr[1] + arr[2] + arr[3] + arr[4];
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 0 + 10 + 20 + 30 + 40 = 100
      expect((instance.exports.main as () => number)()).toBe(100);
    });

    it("array with computed index", async () => {
      const source = `
        int main() {
          int arr[5] = {10, 20, 30, 40, 50};
          int i = 2;
          return arr[i + 1];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(40);
    });

    it("array name decays to pointer (passed to function)", async () => {
      const source = `
        int sum_first_two(int *p) {
          return *p;
        }
        int main() {
          int arr[3] = {42, 10, 20};
          return sum_first_two(arr);
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("array sum with loop", async () => {
      const source = `
        int main() {
          int arr[5] = {1, 2, 3, 4, 5};
          int sum = 0;
          for (int i = 0; i < 5; i++) {
            sum += arr[i];
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(15);
    });

    it("array modified in loop then read", async () => {
      const source = `
        int main() {
          int arr[3];
          arr[0] = 1;
          arr[1] = arr[0] + 1;
          arr[2] = arr[1] + 1;
          return arr[2];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(3);
    });

    it("two arrays in same function", async () => {
      const source = `
        int main() {
          int a[3] = {1, 2, 3};
          int b[3] = {10, 20, 30};
          return a[2] + b[2];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(33);
    });

    it("array with expression initializers", async () => {
      const source = `
        int main() {
          int x = 5;
          int arr[3] = {x, x + 1, x * 2};
          return arr[0] + arr[1] + arr[2];
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 5 + 6 + 10 = 21
      expect((instance.exports.main as () => number)()).toBe(21);
    });
  });

  describe("error cases", () => {
    it("returns errors for invalid syntax", () => {
      const result = compile("this is not C code");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });

    it("returns errors for empty input", () => {
      // Empty input is technically valid (empty program), but produces
      // no useful WASM. The compiler may either succeed with an empty
      // module or return an error. Both are acceptable.
      const result = compile("");
      // Just verify it doesn't crash
      expect(typeof result.ok).toBe("boolean");
    });
  });

  describe("types: char, long, sizeof, casts", () => {
    it("char c = 'A'; return c; → 65", async () => {
      const instance = await compileAndInstantiate("int main() { char c = 'A'; return c; }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(65);
    });

    it("char c = '\\n'; return c; → 10", async () => {
      const instance = await compileAndInstantiate("int main() { char c = '\\n'; return c; }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(10);
    });

    it("sizeof(char) → 1", async () => {
      const instance = await compileAndInstantiate("int main() { return sizeof(char); }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(1);
    });

    it("sizeof(int) → 4", async () => {
      const instance = await compileAndInstantiate("int main() { return sizeof(int); }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(4);
    });

    it("sizeof(long) → 8", async () => {
      const instance = await compileAndInstantiate("int main() { return sizeof(long); }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(8);
    });

    it("long x = 100000; return (int)x; → 100000", async () => {
      const instance = await compileAndInstantiate("int main() { long x = 100000; return (int)x; }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(100000);
    });

    it("long a = 10; long b = 20; return (int)(a + b); → 30", async () => {
      const instance = await compileAndInstantiate("int main() { long a = 10; long b = 20; return (int)(a + b); }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(30);
    });

    it("int x = 5; long y = (long)x; return (int)y; → 5", async () => {
      const instance = await compileAndInstantiate("int main() { int x = 5; long y = (long)x; return (int)y; }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(5);
    });

    it("mixed: int a = 10; long b = 20; return (int)(a + b); → 30 (implicit promotion)", async () => {
      const instance = await compileAndInstantiate("int main() { int a = 10; long b = 20; return (int)(a + b); }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(30);
    });

    it("char c = 'A'; return c + 1; → 66", async () => {
      const instance = await compileAndInstantiate("int main() { char c = 'A'; return c + 1; }");
      const main = instance.exports.main as () => number;
      expect(main()).toBe(66);
    });

    it("target program: char c = 'A'; long big = 100000; int x = (int)big; return c + x; → 100065", async () => {
      const instance = await compileAndInstantiate(`
        int main() {
          char c = 'A';
          long big = 100000;
          int x = (int)big;
          return c + x;
        }
      `);
      const main = instance.exports.main as () => number;
      expect(main()).toBe(100065);
    });

    it("long function return type", async () => {
      const instance = await compileAndInstantiate(`
        long add_long(long a, long b) { return a + b; }
        int main() { return (int)add_long(100, 200); }
      `);
      const main = instance.exports.main as () => number;
      expect(main()).toBe(300);
    });

    it("cast char to long and back", async () => {
      const instance = await compileAndInstantiate(`
        int main() {
          char c = 'Z';
          long big = (long)c;
          return (int)big;
        }
      `);
      const main = instance.exports.main as () => number;
      expect(main()).toBe(90);
    });
  });

  describe("structs (milestone 10)", () => {
    it("basic struct field write and read", async () => {
      const source = `
        struct Point { int x; int y; };
        int main() {
          struct Point p;
          p.x = 3;
          p.y = 4;
          return p.x + p.y;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(7);
    });

    it("struct passed to function (by value)", async () => {
      const source = `
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
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(25);
    });

    it("two struct variables in same function", async () => {
      const source = `
        struct Point { int x; int y; };
        int main() {
          struct Point a;
          struct Point b;
          a.x = 1;
          a.y = 2;
          b.x = 10;
          b.y = 20;
          return a.x + a.y + b.x + b.y;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(33);
    });

    it("sizeof(struct Point) with two int fields → 8", async () => {
      const source = `
        struct Point { int x; int y; };
        int main() {
          return sizeof(struct Point);
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(8);
    });

    it("struct with mixed field types (char + int)", async () => {
      const source = `
        struct Mixed { char c; int val; };
        int main() {
          struct Mixed m;
          m.c = 65;
          m.val = 100;
          return m.c + m.val;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(165);
    });

    it("pointer to struct with arrow operator (read)", async () => {
      const source = `
        struct Point { int x; int y; };
        int main() {
          struct Point p;
          p.x = 42;
          p.y = 10;
          struct Point *ptr = &p;
          return ptr->x + ptr->y;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(52);
    });

    it("arrow assignment: p->x = 10", async () => {
      const source = `
        struct Point { int x; int y; };
        int main() {
          struct Point p;
          p.x = 0;
          p.y = 0;
          struct Point *ptr = &p;
          ptr->x = 10;
          ptr->y = 20;
          return p.x + p.y;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(30);
    });

    it("struct pointer param with arrow operator", async () => {
      const source = `
        struct Point { int x; int y; };
        void set_point(struct Point *p, int x, int y) {
          p->x = x;
          p->y = y;
        }
        int main() {
          struct Point p;
          set_point(&p, 5, 7);
          return p.x + p.y;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(12);
    });

    it("struct field in expression", async () => {
      const source = `
        struct Rect { int w; int h; };
        int area(struct Rect r) {
          return r.w * r.h;
        }
        int main() {
          struct Rect r;
          r.w = 5;
          r.h = 3;
          return area(r);
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(15);
    });

    it("sizeof(struct Mixed) with char + int has padding", async () => {
      const source = `
        struct Mixed { char c; int val; };
        int main() {
          return sizeof(struct Mixed);
        }
      `;
      const instance = await compileAndInstantiate(source);
      // char (1) + 3 padding + int (4) = 8
      expect((instance.exports.main as () => number)()).toBe(8);
    });
  });

  describe("Milestone 11: Dynamic memory (malloc/free)", () => {
    it("basic malloc + pointer indexing", async () => {
      const source = `
        int main() {
          int *arr = malloc(10 * sizeof(int));
          arr[0] = 10;
          arr[1] = 20;
          arr[2] = 30;
          return arr[0] + arr[1] + arr[2];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(60);
    });

    it("malloc + loop to fill array", async () => {
      const source = `
        int main() {
          int *arr = malloc(10 * sizeof(int));
          for (int i = 0; i < 10; i = i + 1) {
            arr[i] = i * i;
          }
          return arr[5];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(25);
    });

    it("free is a no-op (does not crash)", async () => {
      const source = `
        int main() {
          int *arr = malloc(5 * sizeof(int));
          arr[0] = 42;
          free(arr);
          return arr[0];
        }
      `;
      const instance = await compileAndInstantiate(source);
      // free is no-op, so arr[0] still readable
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("multiple mallocs return different addresses", async () => {
      const source = `
        int main() {
          int *a = malloc(4 * sizeof(int));
          int *b = malloc(4 * sizeof(int));
          a[0] = 111;
          b[0] = 222;
          return a[0] + b[0];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(333);
    });

    it("milestone 11 example: malloc + loop + free + return", async () => {
      const source = `
        int main() {
          int *arr = malloc(10 * sizeof(int));
          for (int i = 0; i < 10; i = i + 1) {
            arr[i] = i * i;
          }
          free(arr);
          return arr[5];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(25);
    });

    it("malloc with char pointer indexing", async () => {
      const source = `
        int main() {
          char *buf = malloc(10);
          buf[0] = 65;
          buf[1] = 66;
          buf[2] = 67;
          return buf[0] + buf[1] + buf[2];
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 65 + 66 + 67 = 198
      expect((instance.exports.main as () => number)()).toBe(198);
    });

    it("malloc with struct pointer", async () => {
      const source = `
        struct Point { int x; int y; };
        int main() {
          struct Point *p = malloc(sizeof(struct Point));
          p->x = 3;
          p->y = 4;
          return p->x * p->x + p->y * p->y;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(25);
    });

    it("malloc in a called function", async () => {
      const source = `
        int sum(int n) {
          int *arr = malloc(n * sizeof(int));
          for (int i = 0; i < n; i = i + 1) {
            arr[i] = i + 1;
          }
          int total = 0;
          for (int i = 0; i < n; i = i + 1) {
            total = total + arr[i];
          }
          free(arr);
          return total;
        }
        int main() {
          return sum(10);
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 1+2+3+...+10 = 55
      expect((instance.exports.main as () => number)()).toBe(55);
    });
  });

  describe("Milestone 13: Switch, break, continue", () => {
    it("basic switch with cases and default", async () => {
      const source = `
        int classify(int x) {
          switch (x) {
            case 0: return 0;
            case 1: return 1;
            default: return 2;
          }
        }
        int main() {
          return classify(0) * 100 + classify(1) * 10 + classify(5);
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(12);
    });

    it("switch with break", async () => {
      const source = `
        int test(int x) {
          int result = 0;
          switch (x) {
            case 1:
              result = 10;
              break;
            case 2:
              result = 20;
              break;
            default:
              result = 99;
              break;
          }
          return result;
        }
        int main() {
          return test(1) + test(2) + test(3);
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 10 + 20 + 99 = 129
      expect((instance.exports.main as () => number)()).toBe(129);
    });

    it("switch fall-through (no break)", async () => {
      const source = `
        int test(int x) {
          int result = 0;
          switch (x) {
            case 0:
              result = result + 1;
            case 1:
              result = result + 10;
            case 2:
              result = result + 100;
              break;
            default:
              result = 999;
              break;
          }
          return result;
        }
        int main() {
          return test(0);
        }
      `;
      const instance = await compileAndInstantiate(source);
      // case 0: result=1, falls to case 1: result=11, falls to case 2: result=111, break
      expect((instance.exports.main as () => number)()).toBe(111);
    });

    it("break in while loop", async () => {
      const source = `
        int main() {
          int i = 0;
          int sum = 0;
          while (i < 100) {
            if (i >= 5) break;
            sum = sum + i;
            i = i + 1;
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 0+1+2+3+4 = 10
      expect((instance.exports.main as () => number)()).toBe(10);
    });

    it("break in for loop", async () => {
      const source = `
        int main() {
          int sum = 0;
          for (int i = 0; i < 100; i = i + 1) {
            if (i >= 5) break;
            sum = sum + i;
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(10);
    });

    it("continue in while loop", async () => {
      const source = `
        int main() {
          int i = 0;
          int sum = 0;
          while (i < 10) {
            i = i + 1;
            if (i % 2 == 0) continue;
            sum = sum + i;
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 1+3+5+7+9 = 25
      expect((instance.exports.main as () => number)()).toBe(25);
    });

    it("continue in for loop (update still runs)", async () => {
      const source = `
        int sum_odd(int n) {
          int sum = 0;
          for (int i = 0; i < n; i = i + 1) {
            if (i % 2 == 0) continue;
            sum = sum + i;
          }
          return sum;
        }
        int main() {
          return sum_odd(10);
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 1+3+5+7+9 = 25
      expect((instance.exports.main as () => number)()).toBe(25);
    });

    it("switch inside a for loop with break and continue", async () => {
      const source = `
        int main() {
          int sum = 0;
          for (int i = 0; i < 10; i = i + 1) {
            switch (i % 3) {
              case 0:
                continue;
              case 1:
                sum = sum + i;
                break;
              default:
                sum = sum + i * 2;
                break;
            }
          }
          return sum;
        }
      `;
      const instance = await compileAndInstantiate(source);
      // i=0: skip(0%3=0), i=1: +1(1%3=1), i=2: +4(2%3=2), i=3: skip(3%3=0),
      // i=4: +4(4%3=1), i=5: +10(5%3=2), i=6: skip(6%3=0),
      // i=7: +7(7%3=1), i=8: +16(8%3=2), i=9: skip(9%3=0)
      // 1+4+4+10+7+16 = 42
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("nested loops with break", async () => {
      const source = `
        int main() {
          int count = 0;
          for (int i = 0; i < 5; i = i + 1) {
            for (int j = 0; j < 5; j = j + 1) {
              if (j >= 3) break;
              count = count + 1;
            }
          }
          return count;
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 5 iterations of i, each with 3 iterations of j = 15
      expect((instance.exports.main as () => number)()).toBe(15);
    });

    it("switch with only default", async () => {
      const source = `
        int main() {
          int x = 42;
          switch (x) {
            default: return 99;
          }
          return 0;
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(99);
    });

    it("milestone 13 example: classify function", async () => {
      const source = `
        int classify(int x) {
          switch (x) {
            case 0: return 0;
            case 1: return 1;
            default: return 2;
          }
        }
        int main() {
          return classify(0) + classify(1) + classify(99);
        }
      `;
      const instance = await compileAndInstantiate(source);
      // 0 + 1 + 2 = 3
      expect((instance.exports.main as () => number)()).toBe(3);
    });

    it("milestone 13 example: sum_odd with continue", async () => {
      const source = `
        int sum_odd(int n) {
          int sum = 0;
          for (int i = 0; i < n; i = i + 1) {
            if (i % 2 == 0) continue;
            sum = sum + i;
          }
          return sum;
        }
        int main() {
          return sum_odd(10);
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(25);
    });
  });

  // ── Milestone 15: Preprocessor ────────────────────────────

  describe("preprocessor", () => {
    it("compiles with #define constant", async () => {
      const source = `
        #define ANSWER 42
        int main() { return ANSWER; }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("compiles with #define array size", async () => {
      const source = `
        #define SIZE 3
        int main() {
          int arr[SIZE];
          arr[0] = 10;
          arr[1] = 20;
          arr[2] = 30;
          return arr[0] + arr[1] + arr[2];
        }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(60);
    });

    it("compiles with function-like macro", async () => {
      const source = `
        #define SQUARE(x) ((x) * (x))
        int main() { return SQUARE(7); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(49);
    });

    it("compiles with nested function-like macros", async () => {
      const source = `
        #define ADD(a, b) ((a) + (b))
        #define DOUBLE(x) ADD(x, x)
        int main() { return DOUBLE(21); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(42);
    });

    it("compiles with #ifdef conditional", async () => {
      const source = `
        #define USE_FAST
        #ifdef USE_FAST
        int compute() { return 100; }
        #else
        int compute() { return 1; }
        #endif
        int main() { return compute(); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(100);
    });

    it("compiles with #ifndef conditional", async () => {
      const source = `
        #ifndef DEBUG
        int mode() { return 0; }
        #else
        int mode() { return 1; }
        #endif
        int main() { return mode(); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(0);
    });

    it("compiles with pre-defined macros from options", async () => {
      const source = `
        #ifdef DEBUG
        int main() { return 1; }
        #else
        int main() { return 0; }
        #endif
      `;
      const instance = await compileAndInstantiate(source, { defines: { DEBUG: "1" } });
      expect((instance.exports.main as () => number)()).toBe(1);
    });

    it("compiles with #include from virtual filesystem", async () => {
      const files = {
        "math.h": `
          int square(int x) { return x * x; }
        `,
      };
      const source = `
        #include "math.h"
        int main() { return square(6); }
      `;
      const instance = await compileAndInstantiate(source, { files });
      expect((instance.exports.main as () => number)()).toBe(36);
    });

    it("compiles with MAX/MIN macros", async () => {
      const source = `
        #define MAX(a, b) ((a) > (b) ? (a) : (b))
        #define MIN(a, b) ((a) < (b) ? (a) : (b))
        int main() { return MAX(10, 20) + MIN(3, 5); }
      `;
      const instance = await compileAndInstantiate(source);
      expect((instance.exports.main as () => number)()).toBe(23);
    });

    it("compiles with include guard preventing double definition", async () => {
      const files = {
        "consts.h": [
          "#ifndef CONSTS_H",
          "#define CONSTS_H",
          "int get_val() { return 42; }",
          "#endif",
        ].join("\n"),
      };
      const source = `
        #include "consts.h"
        #include "consts.h"
        int main() { return get_val(); }
      `;
      const instance = await compileAndInstantiate(source, { files });
      expect((instance.exports.main as () => number)()).toBe(42);
    });
  });
});
