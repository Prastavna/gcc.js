import { describe, it, expect } from "vitest";
import { compile } from "../index.ts";

/**
 * Helper: compile C source and instantiate the WASM module
 */
async function compileAndInstantiate(source: string): Promise<WebAssembly.Instance> {
  const result = compile(source);
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
});
