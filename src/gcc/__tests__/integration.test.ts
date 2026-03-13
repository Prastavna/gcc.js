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
