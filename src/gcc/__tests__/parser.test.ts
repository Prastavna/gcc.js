import { describe, it, expect } from "vitest";
import { parse } from "../parser.ts";
import { tokenize } from "../lexer.ts";
import type { Program, FunctionDeclaration, ReturnStatement, IntegerLiteral, BinaryExpression, UnaryExpression, VariableDeclaration, Identifier, CallExpression } from "../types.ts";

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

  describe("local variables (milestone 3)", () => {
    it("parses variable declaration with initializer", () => {
      const ast = parseSource("int main() { int x = 10; return x; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      expect(fn.body.length).toBe(2);

      const decl = fn.body[0] as VariableDeclaration;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.name).toBe("x");
      expect(decl.typeSpec).toBe("int");
      expect(decl.initializer.type).toBe("IntegerLiteral");
      expect((decl.initializer as IntegerLiteral).value).toBe(10);
    });

    it("parses variable reference in return expression", () => {
      const ast = parseSource("int main() { int x = 42; return x; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      const ret = fn.body[1] as ReturnStatement;
      expect(ret.expression.type).toBe("Identifier");
      expect((ret.expression as Identifier).name).toBe("x");
    });

    it("parses variable reference in arithmetic", () => {
      const ast = parseSource("int main() { int x = 10; int y = 20; return x + y; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      const ret = fn.body[2] as ReturnStatement;
      const bin = ret.expression as BinaryExpression;
      expect(bin.operator).toBe("+");
      expect((bin.left as Identifier).name).toBe("x");
      expect((bin.right as Identifier).name).toBe("y");
    });

    it("parses variable declaration with expression initializer", () => {
      const ast = parseSource("int main() { int x = 2 + 3; return x; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      const decl = fn.body[0] as VariableDeclaration;
      expect(decl.initializer.type).toBe("BinaryExpression");
    });

    it("parses multiple variable declarations", () => {
      const source = `int main() {
        int a = 1;
        int b = 2;
        int c = 3;
        return a + b + c;
      }`;
      const ast = parseSource(source);
      const fn = ast.declarations[0] as FunctionDeclaration;
      expect(fn.body.length).toBe(4); // 3 decls + 1 return
    });

    it("parses variable reassignment", () => {
      const ast = parseSource("int main() { int x = 1; x = 2; return x; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      expect(fn.body.length).toBe(3);
      expect(fn.body[1].type).toBe("ExpressionStatement");
    });

    it("throws on declaration without initializer", () => {
      expect(() => parseSource("int main() { int x; return x; }")).toThrow();
    });
  });

  describe("function parameters and calls (milestone 4)", () => {
    it("parses function with one parameter", () => {
      const ast = parseSource("int identity(int x) { return x; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      expect(fn.params.length).toBe(1);
      expect(fn.params[0].name).toBe("x");
      expect(fn.params[0].typeSpec).toBe("int");
    });

    it("parses function with two parameters", () => {
      const ast = parseSource("int add(int a, int b) { return a + b; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      expect(fn.params.length).toBe(2);
      expect(fn.params[0].name).toBe("a");
      expect(fn.params[1].name).toBe("b");
    });

    it("parses function with no parameters (empty parens)", () => {
      const ast = parseSource("int foo() { return 1; }");
      const fn = ast.declarations[0] as FunctionDeclaration;
      expect(fn.params.length).toBe(0);
    });

    it("parses function call with no arguments", () => {
      const source = `
        int foo() { return 42; }
        int main() { return foo(); }
      `;
      const ast = parseSource(source);
      const main = ast.declarations[1] as FunctionDeclaration;
      const ret = main.body[0] as ReturnStatement;
      expect(ret.expression.type).toBe("CallExpression");
      const call = ret.expression as CallExpression;
      expect(call.callee).toBe("foo");
      expect(call.args.length).toBe(0);
    });

    it("parses function call with arguments", () => {
      const source = `
        int add(int a, int b) { return a + b; }
        int main() { return add(3, 4); }
      `;
      const ast = parseSource(source);
      const main = ast.declarations[1] as FunctionDeclaration;
      const ret = main.body[0] as ReturnStatement;
      const call = ret.expression as CallExpression;
      expect(call.callee).toBe("add");
      expect(call.args.length).toBe(2);
      expect((call.args[0] as IntegerLiteral).value).toBe(3);
      expect((call.args[1] as IntegerLiteral).value).toBe(4);
    });

    it("parses function call with expression arguments", () => {
      const source = `
        int add(int a, int b) { return a + b; }
        int main() { return add(1 + 2, 3 * 4); }
      `;
      const ast = parseSource(source);
      const main = ast.declarations[1] as FunctionDeclaration;
      const ret = main.body[0] as ReturnStatement;
      const call = ret.expression as CallExpression;
      expect(call.args[0].type).toBe("BinaryExpression");
      expect(call.args[1].type).toBe("BinaryExpression");
    });

    it("parses nested function calls", () => {
      const source = `
        int double(int x) { return x + x; }
        int main() { return double(double(3)); }
      `;
      const ast = parseSource(source);
      const main = ast.declarations[1] as FunctionDeclaration;
      const ret = main.body[0] as ReturnStatement;
      const outer = ret.expression as CallExpression;
      expect(outer.callee).toBe("double");
      const inner = outer.args[0] as CallExpression;
      expect(inner.callee).toBe("double");
      expect((inner.args[0] as IntegerLiteral).value).toBe(3);
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

  describe("logical operators (milestone 8)", () => {
    it("parses && as LogicalExpression", () => {
      const ast = parseSource("int main() { return a && b; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("LogicalExpression");
      expect(expr.operator).toBe("&&");
      expect(expr.left.type).toBe("Identifier");
      expect(expr.right.type).toBe("Identifier");
    });

    it("parses || as LogicalExpression", () => {
      const ast = parseSource("int main() { return a || b; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("LogicalExpression");
      expect(expr.operator).toBe("||");
    });

    it("&& has higher precedence than ||", () => {
      // a || b && c  should parse as  a || (b && c)
      const ast = parseSource("int main() { return a || b && c; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("LogicalExpression");
      expect(expr.operator).toBe("||");
      expect(expr.right.type).toBe("LogicalExpression");
      expect(expr.right.operator).toBe("&&");
    });

    it("parses ! as unary operator", () => {
      const ast = parseSource("int main() { return !x; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("UnaryExpression");
      expect(expr.operator).toBe("!");
    });

    it("double negation !!x", () => {
      const ast = parseSource("int main() { return !!x; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("UnaryExpression");
      expect(expr.operator).toBe("!");
      expect(expr.operand.type).toBe("UnaryExpression");
      expect(expr.operand.operator).toBe("!");
    });
  });

  describe("ternary operator (milestone 8)", () => {
    it("parses a ? b : c as TernaryExpression", () => {
      const ast = parseSource("int main() { return a ? 1 : 0; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("TernaryExpression");
      expect(expr.condition.type).toBe("Identifier");
      expect(expr.consequent.type).toBe("IntegerLiteral");
      expect(expr.alternate.type).toBe("IntegerLiteral");
    });

    it("nested ternary (right-associative)", () => {
      // a ? b : c ? d : e  parses as  a ? b : (c ? d : e)
      const ast = parseSource("int main() { return a ? 1 : b ? 2 : 3; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("TernaryExpression");
      expect(expr.alternate.type).toBe("TernaryExpression");
    });
  });

  describe("increment/decrement (milestone 8)", () => {
    it("parses prefix ++x", () => {
      const ast = parseSource("int main() { return ++x; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("UpdateExpression");
      expect(expr.operator).toBe("++");
      expect(expr.prefix).toBe(true);
      expect(expr.name).toBe("x");
    });

    it("parses postfix x++", () => {
      const ast = parseSource("int main() { return x++; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("UpdateExpression");
      expect(expr.operator).toBe("++");
      expect(expr.prefix).toBe(false);
      expect(expr.name).toBe("x");
    });

    it("parses prefix --x", () => {
      const ast = parseSource("int main() { return --x; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("UpdateExpression");
      expect(expr.operator).toBe("--");
      expect(expr.prefix).toBe(true);
    });

    it("parses postfix x--", () => {
      const ast = parseSource("int main() { return x--; }");
      const ret = ast.declarations[0] as any;
      const expr = ret.body[0].expression;
      expect(expr.type).toBe("UpdateExpression");
      expect(expr.operator).toBe("--");
      expect(expr.prefix).toBe(false);
    });
  });

  describe("arrays (milestone 9)", () => {
    it("parses array declaration", () => {
      const ast = parseSource("int main() { int arr[5]; return 0; }");
      const func = ast.declarations[0] as any;
      expect(func.body[0].type).toBe("ArrayDeclaration");
      expect(func.body[0].name).toBe("arr");
      expect(func.body[0].size).toBe(5);
      expect(func.body[0].initializer).toBeUndefined();
    });

    it("parses array declaration with initializer", () => {
      const ast = parseSource("int main() { int arr[3] = {1, 2, 3}; return 0; }");
      const func = ast.declarations[0] as any;
      expect(func.body[0].type).toBe("ArrayDeclaration");
      expect(func.body[0].size).toBe(3);
      expect(func.body[0].initializer.length).toBe(3);
      expect(func.body[0].initializer[0].type).toBe("IntegerLiteral");
    });

    it("parses array access expression", () => {
      const ast = parseSource("int main() { return arr[0]; }");
      const func = ast.declarations[0] as any;
      const expr = func.body[0].expression;
      expect(expr.type).toBe("ArrayAccessExpression");
      expect(expr.array).toBe("arr");
      expect(expr.index.type).toBe("IntegerLiteral");
    });

    it("parses array index assignment", () => {
      const ast = parseSource("int main() { arr[0] = 10; return 0; }");
      const func = ast.declarations[0] as any;
      const expr = func.body[0].expression;
      expect(expr.type).toBe("ArrayIndexAssignment");
      expect(expr.array).toBe("arr");
      expect(expr.index.type).toBe("IntegerLiteral");
      expect(expr.value.type).toBe("IntegerLiteral");
    });

    it("parses array access with computed index", () => {
      const ast = parseSource("int main() { return arr[i + 1]; }");
      const func = ast.declarations[0] as any;
      const expr = func.body[0].expression;
      expect(expr.type).toBe("ArrayAccessExpression");
      expect(expr.index.type).toBe("BinaryExpression");
    });
  });

  describe("compound assignment (milestone 8)", () => {
    it("parses x += 1", () => {
      const ast = parseSource("int main() { x += 1; return 0; }");
      const func = ast.declarations[0] as any;
      const stmt = func.body[0];
      expect(stmt.type).toBe("ExpressionStatement");
      expect(stmt.expression.type).toBe("CompoundAssignmentExpression");
      expect(stmt.expression.operator).toBe("+=");
      expect(stmt.expression.name).toBe("x");
    });

    it("parses all compound operators", () => {
      const ops = ["+=", "-=", "*=", "/=", "%="];
      for (const op of ops) {
        const ast = parseSource(`int main() { x ${op} 1; return 0; }`);
        const func = ast.declarations[0] as any;
        expect(func.body[0].expression.operator).toBe(op);
      }
    });
  });

  describe("char, long, cast, sizeof", () => {
    it("parses char c = 'A';", () => {
      const ast = parseSource("int main() { char c = 'A'; return c; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.typeSpec).toBe("char");
      expect(decl.initializer.type).toBe("CharLiteral");
      expect(decl.initializer.value).toBe(65);
    });

    it("parses long x = 100;", () => {
      const ast = parseSource("int main() { long x = 100; return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.typeSpec).toBe("long");
    });

    it("parses (int)x as CastExpression", () => {
      const ast = parseSource("int main() { long x = 5; return (int)x; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const ret = func.body[1] as any;
      expect(ret.expression.type).toBe("CastExpression");
      expect(ret.expression.targetType).toBe("int");
      expect(ret.expression.operand.type).toBe("Identifier");
    });

    it("parses sizeof(int) as SizeofExpression", () => {
      const ast = parseSource("int main() { return sizeof(int); }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const ret = func.body[0] as any;
      expect(ret.expression.type).toBe("SizeofExpression");
      expect(ret.expression.targetType).toBe("int");
    });

    it("(x + 1) still parses as parenthesized expr", () => {
      const ast = parseSource("int main() { int x = 5; return (x + 1); }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const ret = func.body[1] as any;
      expect(ret.expression.type).toBe("BinaryExpression");
    });
  });
});
