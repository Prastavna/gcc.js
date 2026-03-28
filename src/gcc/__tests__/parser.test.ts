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

    it("parses uninitialized declaration with zero default", () => {
      const ast = parseSource("int main() { int x; return x; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.name).toBe("x");
      expect(decl.initializer.type).toBe("IntegerLiteral");
      expect(decl.initializer.value).toBe(0);
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
        int twice(int x) { return x + x; }
        int main() { return twice(twice(3)); }
      `;
      const ast = parseSource(source);
      const main = ast.declarations[1] as FunctionDeclaration;
      const ret = main.body[0] as ReturnStatement;
      const outer = ret.expression as CallExpression;
      expect(outer.callee).toBe("twice");
      const inner = outer.args[0] as CallExpression;
      expect(inner.callee).toBe("twice");
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

  describe("structs (milestone 10)", () => {
    it("parses struct definition", () => {
      const ast = parseSource("struct Point { int x; int y; };");
      expect(ast.declarations.length).toBe(1);
      const decl = ast.declarations[0] as any;
      expect(decl.type).toBe("StructDeclaration");
      expect(decl.name).toBe("Point");
      expect(decl.fields.length).toBe(2);
      expect(decl.fields[0].name).toBe("x");
      expect(decl.fields[0].typeSpec).toBe("int");
      expect(decl.fields[1].name).toBe("y");
      expect(decl.fields[1].typeSpec).toBe("int");
    });

    it("parses struct variable declaration", () => {
      const ast = parseSource("struct Point { int x; int y; }; int main() { struct Point p; return 0; }");
      const func = ast.declarations[1] as any;
      expect(func.body[0].type).toBe("StructVariableDeclaration");
      expect(func.body[0].name).toBe("p");
      expect(func.body[0].structName).toBe("Point");
    });

    it("parses p.x as MemberAccessExpression", () => {
      const ast = parseSource("struct Point { int x; }; int main() { return p.x; }");
      const func = ast.declarations[1] as any;
      const expr = func.body[0].expression;
      expect(expr.type).toBe("MemberAccessExpression");
      expect(expr.object).toBe("p");
      expect(expr.member).toBe("x");
    });

    it("parses p.x = 3 as MemberAssignmentExpression", () => {
      const ast = parseSource("struct Point { int x; }; int main() { p.x = 3; return 0; }");
      const func = ast.declarations[1] as any;
      const expr = func.body[0].expression;
      expect(expr.type).toBe("MemberAssignmentExpression");
      expect(expr.object).toBe("p");
      expect(expr.member).toBe("x");
      expect(expr.value.type).toBe("IntegerLiteral");
    });

    it("parses p->x as ArrowAccessExpression", () => {
      const ast = parseSource("struct Point { int x; }; int main() { return p->x; }");
      const func = ast.declarations[1] as any;
      const expr = func.body[0].expression;
      expect(expr.type).toBe("ArrowAccessExpression");
      expect(expr.pointer).toBe("p");
      expect(expr.member).toBe("x");
    });

    it("parses p->x = 10 as ArrowAssignmentExpression", () => {
      const ast = parseSource("struct Point { int x; }; int main() { p->x = 10; return 0; }");
      const func = ast.declarations[1] as any;
      const expr = func.body[0].expression;
      expect(expr.type).toBe("ArrowAssignmentExpression");
      expect(expr.pointer).toBe("p");
      expect(expr.member).toBe("x");
      expect(expr.value.type).toBe("IntegerLiteral");
    });

    it("parses struct param in function", () => {
      const ast = parseSource("struct Point { int x; }; int f(struct Point p) { return p.x; }");
      const func = ast.declarations[1] as any;
      expect(func.params[0].typeSpec).toEqual({ kind: "struct", name: "Point" });
      expect(func.params[0].name).toBe("p");
    });
  });

  describe("milestone 18: do-while, goto, comma operator", () => {
    it("parses do-while statement", () => {
      const ast = parseSource("int main() { do { return 1; } while (1); }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const doWhile = func.body[0] as any;
      expect(doWhile.type).toBe("DoWhileStatement");
      expect(doWhile.body).toHaveLength(1);
      expect(doWhile.body[0].type).toBe("ReturnStatement");
      expect(doWhile.condition.type).toBe("IntegerLiteral");
    });

    it("parses goto statement", () => {
      const ast = parseSource("int main() { goto done; return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const gotoStmt = func.body[0] as any;
      expect(gotoStmt.type).toBe("GotoStatement");
      expect(gotoStmt.label).toBe("done");
    });

    it("parses labeled statement", () => {
      const ast = parseSource("int main() { done: return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const labeled = func.body[0] as any;
      expect(labeled.type).toBe("LabeledStatement");
      expect(labeled.label).toBe("done");
      expect(labeled.body.type).toBe("ReturnStatement");
    });

    it("parses comma expression", () => {
      const ast = parseSource("int main() { int x = (1, 2, 3); return x; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      // The initializer is the parenthesized comma expression
      expect(decl.initializer.type).toBe("CommaExpression");
      expect(decl.initializer.expressions).toHaveLength(3);
    });

    it("comma does not affect function arguments", () => {
      const ast = parseSource("int main() { add(1, 2); return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const exprStmt = func.body[0] as any;
      expect(exprStmt.expression.type).toBe("CallExpression");
      expect(exprStmt.expression.args).toHaveLength(2);
    });
  });

  describe("floating-point support (milestone 19)", () => {
    it("parses double literal as FloatingLiteral", () => {
      const ast = parseSource("int main() { return 3.14; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const ret = func.body[0] as ReturnStatement;
      expect(ret.expression.type).toBe("FloatingLiteral");
      expect((ret.expression as any).value).toBeCloseTo(3.14);
      expect((ret.expression as any).isFloat).toBe(false);
    });

    it("parses float literal with f suffix", () => {
      const ast = parseSource("int main() { return 3.14f; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const ret = func.body[0] as ReturnStatement;
      expect(ret.expression.type).toBe("FloatingLiteral");
      expect((ret.expression as any).value).toBeCloseTo(3.14);
      expect((ret.expression as any).isFloat).toBe(true);
    });

    it("parses float variable declaration", () => {
      const ast = parseSource("int main() { float x = 1.5f; return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.typeSpec).toBe("float");
    });

    it("parses double variable declaration", () => {
      const ast = parseSource("int main() { double x = 1.5; return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.typeSpec).toBe("double");
    });

    it("parses scientific notation as FloatingLiteral", () => {
      const ast = parseSource("int main() { return 1e5; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const ret = func.body[0] as ReturnStatement;
      expect(ret.expression.type).toBe("FloatingLiteral");
      expect((ret.expression as any).value).toBe(100000);
      expect((ret.expression as any).isFloat).toBe(false);
    });

    it("parses float function declaration", () => {
      const ast = parseSource("float add(float a, float b) { return a; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      expect(func.returnType).toBe("float");
      expect(func.params[0].typeSpec).toBe("float");
      expect(func.params[1].typeSpec).toBe("float");
    });
  });

  describe("short, const, volatile, storage classes (milestone 20)", () => {
    it("parses short type specifier", () => {
      const ast = parseSource("int main() { short x = 5; return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.typeSpec).toBe("short");
    });

    it("parses unsigned short type specifier", () => {
      const ast = parseSource("int main() { unsigned short x = 5; return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.typeSpec).toBe("unsigned short");
    });

    it("parses signed int as int", () => {
      const ast = parseSource("int main() { signed int x = 5; return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.typeSpec).toBe("int");
    });

    it("parses signed char as char", () => {
      const ast = parseSource("int main() { signed char x = 65; return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.typeSpec).toBe("char");
    });

    it("parses const volatile qualifiers", () => {
      const ast = parseSource("int main() { const volatile int x = 42; return x; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.typeSpec).toBe("int");
    });

    it("parses register qualifier", () => {
      const ast = parseSource("int main() { register int i = 0; return i; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      expect(func.body[0].type).toBe("VariableDeclaration");
    });

    it("parses static function declaration", () => {
      const ast = parseSource("static int helper() { return 1; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      expect(func.isStatic).toBe(true);
    });

    it("parses const global variable", () => {
      const ast = parseSource("const int MAX = 100; int main() { return MAX; }");
      const g = ast.declarations[0] as any;
      expect(g.type).toBe("GlobalVariableDeclaration");
      expect(g.isConst).toBe(true);
    });

    it("parses extern variable declaration", () => {
      const ast = parseSource("extern int x; int main() { return 0; }");
      expect(ast.declarations).toHaveLength(1); // extern skipped
      expect(ast.declarations[0].type).toBe("FunctionDeclaration");
    });

    it("parses uninitialized variable with zero default", () => {
      const ast = parseSource("int main() { short s; return 0; }");
      const func = ast.declarations[0] as FunctionDeclaration;
      const decl = func.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.typeSpec).toBe("short");
      expect(decl.initializer.value).toBe(0);
    });
  });

  // ── Milestone 22: Forward declarations and function pointers ──

  describe("forward declarations and function pointers", () => {
    it("parses forward declaration as ForwardDeclaration", () => {
      const ast = parseSource("int foo(int x); int foo(int x) { return x; }");
      expect(ast.declarations[0].type).toBe("ForwardDeclaration");
      expect(ast.declarations[1].type).toBe("FunctionDeclaration");
    });

    it("parses extern function as ExternFunctionDeclaration", () => {
      const ast = parseSource("extern int printf(int ptr);");
      expect(ast.declarations[0].type).toBe("ExternFunctionDeclaration");
    });

    it("parses function pointer variable declaration", () => {
      const ast = parseSource("int add(int a, int b) { return a + b; } int main() { int (*fn)(int, int) = add; return fn(1, 2); }");
      const main = ast.declarations[1] as FunctionDeclaration;
      const decl = main.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.typeSpec).toEqual({ kind: "functionPointer", returnType: "int", paramTypes: ["int", "int"] });
    });

    it("parses function pointer parameter", () => {
      const ast = parseSource("int apply(int (*op)(int, int), int x) { return op(x, x); }");
      const func = ast.declarations[0] as FunctionDeclaration;
      expect(func.params[0].typeSpec).toEqual({ kind: "functionPointer", returnType: "int", paramTypes: ["int", "int"] });
      expect(func.params[0].name).toBe("op");
    });

    it("parses typedef for function pointer", () => {
      const ast = parseSource("typedef int (*BinOp)(int, int); int add(int a, int b) { return a + b; } int main() { BinOp fn = add; return fn(1, 2); }");
      const main = ast.declarations[1] as FunctionDeclaration;
      const decl = main.body[0] as any;
      expect(decl.type).toBe("VariableDeclaration");
      expect(decl.typeSpec).toEqual({ kind: "functionPointer", returnType: "int", paramTypes: ["int", "int"] });
    });

    it("marks indirect calls on function pointer variables", () => {
      const ast = parseSource("int add(int a, int b) { return a + b; } int main() { int (*fn)(int, int) = add; return fn(1, 2); }");
      const main = ast.declarations[1] as FunctionDeclaration;
      const ret = main.body[1] as any;
      const call = ret.expression as CallExpression;
      expect(call.indirect).toBe(true);
      expect(call.callee).toBe("fn");
    });
  });

  // ── M23: Multi-dimensional arrays and advanced arrays ──
  describe("M23: multi-dimensional arrays", () => {
    it("parses 2D array declaration", () => {
      const ast = parseSource("int main() { int matrix[3][4]; return 0; }");
      const func = ast.declarations[0] as any;
      expect(func.body[0].type).toBe("ArrayDeclaration");
      expect(func.body[0].dimensions).toEqual([3, 4]);
      expect(func.body[0].size).toBe(12);
    });

    it("parses char[] from string literal", () => {
      const ast = parseSource('int main() { char name[] = "hello"; return 0; }');
      const func = ast.declarations[0] as any;
      expect(func.body[0].type).toBe("ArrayDeclaration");
      expect(func.body[0].stringInit).toBe("hello");
      expect(func.body[0].dimensions).toEqual([6]); // 5 chars + null
      expect(func.body[0].size).toBe(6);
    });

    it("parses chained array access (matrix[i][j])", () => {
      const ast = parseSource("int main() { int m[2][3]; return m[1][2]; }");
      const func = ast.declarations[0] as any;
      const ret = func.body[1] as any;
      const access = ret.expression;
      expect(access.type).toBe("ArrayAccessExpression");
      // outer access: array is inner ArrayAccessExpression, index is 2
      expect(typeof access.array).toBe("object");
      expect(access.array.type).toBe("ArrayAccessExpression");
      expect(access.array.array).toBe("m");
    });

    it("parses nested initializer lists", () => {
      const ast = parseSource("int main() { int m[2][2] = {{1, 2}, {3, 4}}; return 0; }");
      const func = ast.declarations[0] as any;
      const decl = func.body[0];
      expect(decl.type).toBe("ArrayDeclaration");
      expect(decl.initializer.length).toBe(2);
      expect(Array.isArray(decl.initializer[0])).toBe(true);
      expect(decl.initializer[0].length).toBe(2);
    });

    it("parses struct array declaration", () => {
      const ast = parseSource("struct Point { int x; int y; }; int main() { struct Point pts[3]; return 0; }");
      const func = ast.declarations[1] as any;
      expect(func.body[0].type).toBe("ArrayDeclaration");
      expect(func.body[0].typeSpec).toEqual({ kind: "struct", name: "Point" });
      expect(func.body[0].dimensions).toEqual([3]);
    });

    it("parses array access followed by member access (pts[i].x)", () => {
      const ast = parseSource("struct Point { int x; int y; }; int main() { struct Point pts[3]; return pts[1].x; }");
      const func = ast.declarations[1] as any;
      const ret = func.body[1] as any;
      const memberAccess = ret.expression;
      expect(memberAccess.type).toBe("MemberAccessExpression");
      expect(memberAccess.member).toBe("x");
      expect(typeof memberAccess.object).toBe("object");
      expect(memberAccess.object.type).toBe("ArrayAccessExpression");
    });

    it("parses chained array index assignment (matrix[i][j] = val)", () => {
      const ast = parseSource("int main() { int m[2][2]; m[0][1] = 42; return 0; }");
      const func = ast.declarations[0] as any;
      const assign = func.body[1] as any;
      // ExpressionStatement wrapping ArrayIndexAssignment
      const expr = assign.expression;
      expect(expr.type).toBe("ArrayIndexAssignment");
      expect(typeof expr.array).toBe("object");
      expect(expr.array.type).toBe("ArrayAccessExpression");
    });

    it("parses struct array member assignment (pts[i].x = val)", () => {
      const ast = parseSource("struct Point { int x; int y; }; int main() { struct Point pts[2]; pts[0].x = 10; return 0; }");
      const func = ast.declarations[1] as any;
      const assign = func.body[1] as any;
      const expr = assign.expression;
      expect(expr.type).toBe("MemberAssignmentExpression");
      expect(expr.member).toBe("x");
      expect(typeof expr.object).toBe("object");
      expect(expr.object.type).toBe("ArrayAccessExpression");
    });
  });

  // ── M24: Struct and union enhancements ──
  describe("M24: struct enhancements", () => {
    it("parses nested struct definition", () => {
      const ast = parseSource("struct Line { struct Point { int x; int y; } start; struct Point end; };");
      // Nested struct Point should be injected as first declaration
      expect(ast.declarations[0].type).toBe("StructDeclaration");
      expect((ast.declarations[0] as any).name).toBe("Point");
      expect(ast.declarations[1].type).toBe("StructDeclaration");
      expect((ast.declarations[1] as any).name).toBe("Line");
    });

    it("parses chained member access (a.b.x)", () => {
      const ast = parseSource("struct Line { struct Point { int x; int y; } start; struct Point end; }; int main() { struct Line ln; return ln.start.x; }");
      const func = ast.declarations.find((d: any) => d.type === "FunctionDeclaration") as any;
      const ret = func.body[1] as any;
      const expr = ret.expression;
      expect(expr.type).toBe("MemberAccessExpression");
      expect(expr.member).toBe("x");
      expect(typeof expr.object).toBe("object");
      expect(expr.object.type).toBe("MemberAccessExpression");
      expect(expr.object.member).toBe("start");
      expect(expr.object.object).toBe("ln");
    });

    it("parses chained member assignment (a.b.x = val)", () => {
      const ast = parseSource("struct Line { struct Point { int x; int y; } start; struct Point end; }; int main() { struct Line ln; ln.start.x = 1; return 0; }");
      const func = ast.declarations.find((d: any) => d.type === "FunctionDeclaration") as any;
      const assign = func.body[1] as any;
      const expr = assign.expression;
      expect(expr.type).toBe("MemberAssignmentExpression");
      expect(expr.member).toBe("x");
      expect(typeof expr.object).toBe("object");
      expect(expr.object.type).toBe("MemberAccessExpression");
    });

    it("parses struct initializer list", () => {
      const ast = parseSource("struct Point { int x; int y; }; int main() { struct Point p = {1, 2}; return 0; }");
      const func = ast.declarations.find((d: any) => d.type === "FunctionDeclaration") as any;
      const decl = func.body[0];
      expect(decl.type).toBe("StructVariableDeclaration");
      expect(Array.isArray(decl.initializer)).toBe(true);
      expect(decl.initializer.length).toBe(2);
    });

    it("parses struct copy declaration", () => {
      const ast = parseSource("struct Point { int x; int y; }; int main() { struct Point p1; struct Point p2 = p1; return 0; }");
      const func = ast.declarations.find((d: any) => d.type === "FunctionDeclaration") as any;
      const decl = func.body[1];
      expect(decl.type).toBe("StructVariableDeclaration");
      expect(decl.initializer).toBeDefined();
      expect(decl.initializer.type).toBe("Identifier");
      expect(decl.initializer.name).toBe("p1");
    });
  });

  // ── M25: Void pointers and variadic functions ─────────────
  describe("M25: void pointers and variadic functions", () => {
    it("parses multiple declarators", () => {
      const ast = parseSource("int main() { int a = 10, b = 20; return a + b; }");
      const func = ast.declarations[0] as any;
      expect(func.body[0].type).toBe("VariableDeclaration");
      expect(func.body[0].name).toBe("a");
      expect(func.body[1].type).toBe("VariableDeclaration");
      expect(func.body[1].name).toBe("b");
    });

    it("parses pointer cast expression", () => {
      const ast = parseSource("int main() { int x = 1; void *p = &x; int *ip = (int *)p; return *ip; }");
      const func = ast.declarations[0] as any;
      const castDecl = func.body[2]; // int *ip = (int *)p
      expect(castDecl.pointer).toBe(true);
      expect(castDecl.initializer.type).toBe("CastExpression");
      expect(castDecl.initializer.pointer).toBe(true);
    });

    it("parses variadic function declaration", () => {
      const ast = parseSource("int sum(int count, ...) { return 0; }");
      const func = ast.declarations[0] as any;
      expect(func.type).toBe("FunctionDeclaration");
      expect(func.variadic).toBe(true);
      expect(func.params.length).toBe(1);
      expect(func.params[0].name).toBe("count");
    });

    it("parses va_arg expression", () => {
      const ast = parseSource("int sum(int count, ...) { va_list args; va_start(args, count); int x = va_arg(args, int); va_end(args); return x; }");
      const func = ast.declarations[0] as any;
      const vaArgDecl = func.body[2]; // int x = va_arg(args, int)
      expect(vaArgDecl.initializer.type).toBe("VaArgExpression");
      expect(vaArgDecl.initializer.vaList).toBe("args");
      expect(vaArgDecl.initializer.argType).toBe("int");
    });

    it("parses void pointer return type", () => {
      const ast = parseSource("void *get_ptr(int *p) { return p; }");
      const func = ast.declarations[0] as any;
      expect(func.returnPointer).toBe(true);
      expect(func.returnType).toBe("void");
    });
  });
});
