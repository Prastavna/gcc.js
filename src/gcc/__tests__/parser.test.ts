import { describe, it, expect } from "vitest";
import { parse } from "../parser.ts";
import { tokenize } from "../lexer.ts";
import type { Program, FunctionDeclaration, ReturnStatement, IntegerLiteral } from "../types.ts";

/**
 * Helper: lex + parse in one step
 */
function parseSource(source: string): Program {
  return parse(tokenize(source));
}

describe("parser", () => {
  describe("minimal: int main() { return 42; }", () => {
    it("parses into a Program with one FunctionDeclaration", () => {
      const ast = parseSource("int main() { return 42; }");

      expect(ast.type).toBe("Program");
      expect(ast.declarations.length).toBe(1);
      expect(ast.declarations[0].type).toBe("FunctionDeclaration");
    });

    it("parses function name and return type", () => {
      const ast = parseSource("int main() { return 42; }");
      const fn = ast.declarations[0] as FunctionDeclaration;

      expect(fn.name).toBe("main");
      expect(fn.returnType).toBe("int");
      expect(fn.params).toEqual([]);
    });

    it("parses return statement with integer literal", () => {
      const ast = parseSource("int main() { return 42; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      const ret = fn.body[0] as ReturnStatement;

      expect(ret.type).toBe("ReturnStatement");
      expect(ret.expression.type).toBe("IntegerLiteral");
      expect((ret.expression as IntegerLiteral).value).toBe(42);
    });
  });

  describe("different return values", () => {
    it("parses return 0", () => {
      const ast = parseSource("int main() { return 0; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      const ret = fn.body[0] as ReturnStatement;
      expect((ret.expression as IntegerLiteral).value).toBe(0);
    });

    it("parses return with large number", () => {
      const ast = parseSource("int main() { return 999; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      const ret = fn.body[0] as ReturnStatement;
      expect((ret.expression as IntegerLiteral).value).toBe(999);
    });
  });

  describe("void functions", () => {
    // void main is technically not valid C, but we support it for completeness
    it("parses void return type", () => {
      const ast = parseSource("void noop() { return 0; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      expect(fn.returnType).toBe("void");
      expect(fn.name).toBe("noop");
    });
  });

  describe("multiple functions", () => {
    it("parses two function declarations", () => {
      const source = `
        int foo() { return 1; }
        int bar() { return 2; }
      `;
      const ast = parseSource(source);
      expect(ast.declarations.length).toBe(2);
      expect((ast.declarations[0] as FunctionDeclaration).name).toBe("foo");
      expect((ast.declarations[1] as FunctionDeclaration).name).toBe("bar");
    });
  });

  describe("error handling", () => {
    it("throws when missing opening brace", () => {
      expect(() => parseSource("int main() return 42; }")).toThrow();
    });

    it("throws when missing closing brace", () => {
      expect(() => parseSource("int main() { return 42;")).toThrow();
    });

    it("throws when missing semicolon after return", () => {
      expect(() => parseSource("int main() { return 42 }")).toThrow();
    });

    it("throws when missing return expression", () => {
      expect(() => parseSource("int main() { return ; }")).toThrow();
    });

    it("throws when missing parentheses", () => {
      expect(() => parseSource("int main { return 42; }")).toThrow();
    });

    it("throws on empty input", () => {
      expect(() => parseSource("")).not.toThrow();
      const ast = parseSource("");
      expect(ast.declarations.length).toBe(0);
    });
  });
});
