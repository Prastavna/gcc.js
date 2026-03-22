import { describe, it, expect } from "vitest";
import { preprocess } from "../preprocessor.ts";

describe("preprocessor", () => {
  // ── Object-like #define ──────────────────────────────────

  describe("#define object-like macros", () => {
    it("substitutes a simple constant", () => {
      const src = `#define X 42\nreturn X;`;
      expect(preprocess(src)).toContain("return 42;");
    });

    it("substitutes multiple macros in one line", () => {
      const src = `#define A 1\n#define B 2\nreturn A + B;`;
      expect(preprocess(src)).toContain("return 1 + 2;");
    });

    it("chains macro expansion (macro expands to another macro)", () => {
      const src = `#define A B\n#define B 99\nreturn A;`;
      expect(preprocess(src)).toContain("return 99;");
    });

    it("does not expand inside string literals", () => {
      const src = `#define X 42\nprintf("X is X");`;
      expect(preprocess(src)).toContain('"X is X"');
    });

    it("does not expand inside char literals", () => {
      const src = `#define a 42\nchar c = 'a';`;
      expect(preprocess(src)).toContain("'a'");
    });

    it("does not expand partial identifiers", () => {
      const src = `#define X 42\nint MAX = 100;`;
      const result = preprocess(src);
      expect(result).toContain("MAX");
      expect(result).not.toContain("MA42");
    });

    it("handles empty body (flag macro)", () => {
      const src = `#define EMPTY\nint x = 5;`;
      const result = preprocess(src);
      expect(result).toContain("int x = 5;");
    });

    it("replaces macro with empty body to nothing", () => {
      const src = `#define INLINE\nINLINE int foo() { return 1; }`;
      const result = preprocess(src);
      expect(result).toContain(" int foo()");
    });

    it("prevents infinite self-recursion", () => {
      const src = `#define A A\nreturn A;`;
      expect(preprocess(src)).toContain("return A;");
    });
  });

  // ── Function-like #define ────────────────────────────────

  describe("#define function-like macros", () => {
    it("expands a simple function macro", () => {
      const src = `#define SQUARE(x) ((x) * (x))\nreturn SQUARE(5);`;
      expect(preprocess(src)).toContain("return ((5) * (5));");
    });

    it("expands with multiple parameters", () => {
      const src = `#define ADD(a, b) ((a) + (b))\nreturn ADD(3, 4);`;
      expect(preprocess(src)).toContain("return ((3) + (4));");
    });

    it("handles nested macro calls", () => {
      const src = `#define SQUARE(x) ((x) * (x))\n#define ADD(a, b) ((a) + (b))\nreturn SQUARE(ADD(1, 2));`;
      const result = preprocess(src);
      expect(result).toContain("((((1) + (2))) * (((1) + (2))))");
    });

    it("handles arguments with nested parentheses", () => {
      const src = `#define F(x) (x)\nreturn F((1 + 2));`;
      expect(preprocess(src)).toContain("return ((1 + 2));");
    });

    it("does not expand function macro without parentheses", () => {
      const src = `#define FOO(x) (x)\nint FOO = 5;`;
      expect(preprocess(src)).toContain("int FOO = 5;");
    });

    it("errors on wrong argument count", () => {
      const src = `#define ADD(a, b) ((a) + (b))\nreturn ADD(1);`;
      expect(() => preprocess(src)).toThrow(/expects 2 arguments, got 1/);
    });

    it("handles zero-argument function macro", () => {
      const src = `#define ZERO() 0\nreturn ZERO();`;
      expect(preprocess(src)).toContain("return 0;");
    });

    it("does not substitute param names inside strings in macro body", () => {
      const src = `#define MSG(x) "value is x"\nchar *s = MSG(42);`;
      const result = preprocess(src);
      expect(result).toContain('"value is x"');
    });
  });

  // ── #ifdef / #ifndef / #else / #endif ────────────────────

  describe("conditional compilation", () => {
    it("#ifdef includes code when macro is defined", () => {
      const src = `#define DEBUG\n#ifdef DEBUG\nint x = 1;\n#endif`;
      expect(preprocess(src)).toContain("int x = 1;");
    });

    it("#ifdef excludes code when macro is not defined", () => {
      const src = `#ifdef DEBUG\nint x = 1;\n#endif`;
      expect(preprocess(src)).not.toContain("int x = 1;");
    });

    it("#ifndef includes code when macro is not defined", () => {
      const src = `#ifndef DEBUG\nint x = 1;\n#endif`;
      expect(preprocess(src)).toContain("int x = 1;");
    });

    it("#ifndef excludes code when macro is defined", () => {
      const src = `#define DEBUG\n#ifndef DEBUG\nint x = 1;\n#endif`;
      expect(preprocess(src)).not.toContain("int x = 1;");
    });

    it("#else takes the alternate branch", () => {
      const src = `#ifdef DEBUG\nint x = 1;\n#else\nint x = 2;\n#endif`;
      const result = preprocess(src);
      expect(result).not.toContain("int x = 1;");
      expect(result).toContain("int x = 2;");
    });

    it("#else with defined macro takes first branch", () => {
      const src = `#define DEBUG\n#ifdef DEBUG\nint x = 1;\n#else\nint x = 2;\n#endif`;
      const result = preprocess(src);
      expect(result).toContain("int x = 1;");
      expect(result).not.toContain("int x = 2;");
    });

    it("handles nested conditionals", () => {
      const src = [
        "#define A",
        "#ifdef A",
        "#ifdef B",
        "int x = 1;",
        "#else",
        "int x = 2;",
        "#endif",
        "#endif",
      ].join("\n");
      const result = preprocess(src);
      expect(result).not.toContain("int x = 1;");
      expect(result).toContain("int x = 2;");
    });

    it("skips nested #ifdef in inactive region", () => {
      const src = [
        "#ifdef UNDEF",
        "#ifdef ALSO_UNDEF",
        "int x = 1;",
        "#endif",
        "#endif",
      ].join("\n");
      expect(preprocess(src)).not.toContain("int x = 1;");
    });

    it("include guard pattern works", () => {
      const src = [
        "#ifndef HEADER_H",
        "#define HEADER_H",
        "int x = 42;",
        "#endif",
        "#ifndef HEADER_H",
        "int y = 99;",
        "#endif",
      ].join("\n");
      const result = preprocess(src);
      expect(result).toContain("int x = 42;");
      expect(result).not.toContain("int y = 99;");
    });

    it("errors on #endif without #ifdef", () => {
      expect(() => preprocess("#endif")).toThrow(/#endif without #ifdef/);
    });

    it("errors on unterminated #ifdef", () => {
      expect(() => preprocess("#ifdef X\nint x;")).toThrow(/unterminated/);
    });

    it("errors on duplicate #else", () => {
      expect(() => preprocess("#ifdef X\n#else\n#else\n#endif")).toThrow(/duplicate #else/);
    });
  });

  // ── #undef ───────────────────────────────────────────────

  describe("#undef", () => {
    it("undefines a macro", () => {
      const src = `#define X 42\n#undef X\nreturn X;`;
      expect(preprocess(src)).toContain("return X;");
    });

    it("undefine affects subsequent #ifdef", () => {
      const src = [
        "#define X",
        "#undef X",
        "#ifdef X",
        "int y = 1;",
        "#endif",
      ].join("\n");
      expect(preprocess(src)).not.toContain("int y = 1;");
    });
  });

  // ── #include ─────────────────────────────────────────────

  describe("#include", () => {
    it("includes a virtual file with double quotes", () => {
      const files = { "header.h": "int helper() { return 1; }" };
      const src = `#include "header.h"\nint main() { return helper(); }`;
      const result = preprocess(src, { files });
      expect(result).toContain("int helper() { return 1; }");
      expect(result).toContain("int main()");
    });

    it("includes a virtual file with angle brackets", () => {
      const files = { "stdio.h": "int printf(int ptr);" };
      const src = `#include <stdio.h>\nint main() { return 0; }`;
      const result = preprocess(src, { files });
      expect(result).toContain("int printf(int ptr);");
    });

    it("errors on file not found", () => {
      expect(() => preprocess(`#include "missing.h"`)).toThrow(/file not found/);
    });

    it("handles nested includes", () => {
      const files = {
        "a.h": `#include "b.h"\nint a() { return b(); }`,
        "b.h": "int b() { return 42; }",
      };
      const src = `#include "a.h"\nint main() { return a(); }`;
      const result = preprocess(src, { files });
      expect(result).toContain("int b() { return 42; }");
      expect(result).toContain("int a() { return b(); }");
    });

    it("errors on circular includes", () => {
      const files = {
        "a.h": `#include "b.h"`,
        "b.h": `#include "a.h"`,
      };
      expect(() => preprocess(`#include "a.h"`, { files })).toThrow(/maximum #include depth/);
    });

    it("include guard prevents double inclusion", () => {
      const files = {
        "header.h": [
          "#ifndef HEADER_H",
          "#define HEADER_H",
          "int value = 42;",
          "#endif",
        ].join("\n"),
      };
      const src = `#include "header.h"\n#include "header.h"\nint main() { return value; }`;
      const result = preprocess(src, { files });
      // Should only contain "int value = 42;" once
      const count = (result.match(/int value = 42;/g) || []).length;
      expect(count).toBe(1);
    });

    it("macros from included files are visible", () => {
      const files = { "defs.h": "#define MAX 100" };
      const src = `#include "defs.h"\nint arr[MAX];`;
      const result = preprocess(src, { files });
      expect(result).toContain("int arr[100];");
    });
  });

  // ── PreprocessorOptions ──────────────────────────────────

  describe("options", () => {
    it("accepts pre-defined macros", () => {
      const src = `#ifdef DEBUG\nint x = 1;\n#endif`;
      const result = preprocess(src, { defines: { DEBUG: "1" } });
      expect(result).toContain("int x = 1;");
    });

    it("pre-defined macros expand in source", () => {
      const src = "int x = VERSION;";
      const result = preprocess(src, { defines: { VERSION: "42" } });
      expect(result).toContain("int x = 42;");
    });
  });

  // ── Line preservation ────────────────────────────────────

  describe("line number preservation", () => {
    it("preserves line count with blank lines for directives", () => {
      const src = "#define X 42\nint main() {\n    return X;\n}";
      const result = preprocess(src);
      const lines = result.split("\n");
      expect(lines.length).toBe(4); // same number of lines
      expect(lines[0]).toBe(""); // directive replaced with blank
      expect(lines[2]).toContain("return 42;");
    });
  });

  // ── Edge cases ───────────────────────────────────────────

  describe("edge cases", () => {
    it("handles empty source", () => {
      expect(preprocess("")).toBe("");
    });

    it("handles source with no directives", () => {
      const src = "int main() { return 0; }";
      expect(preprocess(src)).toBe(src);
    });

    it("handles # with spaces before directive name", () => {
      const src = "#  define X 42\nreturn X;";
      expect(preprocess(src)).toContain("return 42;");
    });

    it("handles directive with leading whitespace", () => {
      const src = "  #define X 42\nreturn X;";
      expect(preprocess(src)).toContain("return 42;");
    });
  });
});
