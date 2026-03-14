import { describe, it, expect } from "vitest";
import { parse } from "../parser.ts";
import { tokenize } from "../lexer.ts";
import type { Program, FunctionDeclaration, ReturnStatement, IntegerLiteral, BinaryExpression, UnaryExpression } from "../types.ts";

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

  describe("arithmetic expressions (milestone 2)", () => {
    function getReturnExpr(source: string) {
      const ast = parseSource(source);
      const fn = ast.declarations[0] as FunctionDeclaration;
      return (fn.body[0] as ReturnStatement).expression;
    }

    it("parses addition", () => {
      const expr = getReturnExpr("int main() { return 2 + 3; }");
      expect(expr.type).toBe("BinaryExpression");
      const bin = expr as BinaryExpression;
      expect(bin.operator).toBe("+");
      expect((bin.left as IntegerLiteral).value).toBe(2);
      expect((bin.right as IntegerLiteral).value).toBe(3);
    });

    it("parses subtraction", () => {
      const expr = getReturnExpr("int main() { return 10 - 4; }");
      const bin = expr as BinaryExpression;
      expect(bin.operator).toBe("-");
      expect((bin.left as IntegerLiteral).value).toBe(10);
      expect((bin.right as IntegerLiteral).value).toBe(4);
    });

    it("parses multiplication", () => {
      const expr = getReturnExpr("int main() { return 3 * 7; }");
      const bin = expr as BinaryExpression;
      expect(bin.operator).toBe("*");
    });

    it("parses division", () => {
      const expr = getReturnExpr("int main() { return 10 / 2; }");
      const bin = expr as BinaryExpression;
      expect(bin.operator).toBe("/");
    });

    it("parses modulo", () => {
      const expr = getReturnExpr("int main() { return 10 % 3; }");
      const bin = expr as BinaryExpression;
      expect(bin.operator).toBe("%");
    });

    it("respects * over + precedence: 2 + 3 * 4 = 2 + (3 * 4)", () => {
      const expr = getReturnExpr("int main() { return 2 + 3 * 4; }");
      // Should be: BinaryExpr(+, 2, BinaryExpr(*, 3, 4))
      const bin = expr as BinaryExpression;
      expect(bin.operator).toBe("+");
      expect((bin.left as IntegerLiteral).value).toBe(2);
      const right = bin.right as BinaryExpression;
      expect(right.operator).toBe("*");
      expect((right.left as IntegerLiteral).value).toBe(3);
      expect((right.right as IntegerLiteral).value).toBe(4);
    });

    it("respects left associativity: 10 - 3 - 2 = (10 - 3) - 2", () => {
      const expr = getReturnExpr("int main() { return 10 - 3 - 2; }");
      const bin = expr as BinaryExpression;
      expect(bin.operator).toBe("-");
      expect((bin.right as IntegerLiteral).value).toBe(2);
      const left = bin.left as BinaryExpression;
      expect(left.operator).toBe("-");
      expect((left.left as IntegerLiteral).value).toBe(10);
      expect((left.right as IntegerLiteral).value).toBe(3);
    });

    it("parses parenthesized expressions: (2 + 3) * 4", () => {
      const expr = getReturnExpr("int main() { return (2 + 3) * 4; }");
      const bin = expr as BinaryExpression;
      expect(bin.operator).toBe("*");
      expect((bin.right as IntegerLiteral).value).toBe(4);
      const left = bin.left as BinaryExpression;
      expect(left.operator).toBe("+");
      expect((left.left as IntegerLiteral).value).toBe(2);
      expect((left.right as IntegerLiteral).value).toBe(3);
    });

    it("parses nested parentheses: ((1 + 2))", () => {
      const expr = getReturnExpr("int main() { return ((1 + 2)); }");
      const bin = expr as BinaryExpression;
      expect(bin.operator).toBe("+");
      expect((bin.left as IntegerLiteral).value).toBe(1);
      expect((bin.right as IntegerLiteral).value).toBe(2);
    });

    it("parses unary minus", () => {
      const expr = getReturnExpr("int main() { return -42; }");
      expect(expr.type).toBe("UnaryExpression");
      const un = expr as UnaryExpression;
      expect(un.operator).toBe("-");
      expect((un.operand as IntegerLiteral).value).toBe(42);
    });

    it("parses unary minus in expression: -2 + 3", () => {
      const expr = getReturnExpr("int main() { return -2 + 3; }");
      const bin = expr as BinaryExpression;
      expect(bin.operator).toBe("+");
      expect(bin.left.type).toBe("UnaryExpression");
      expect((bin.right as IntegerLiteral).value).toBe(3);
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
