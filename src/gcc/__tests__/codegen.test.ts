import { describe, it, expect } from "vitest";
import { generate } from "../codegen.ts";
import type { Program, BinaryOperator } from "../types.ts";

/**
 * Helper: build a minimal AST for `int <name>() { return <value>; }`
 */
function makeReturnProgram(name: string, value: number): Program {
  return {
    type: "Program",
    declarations: [
      {
        type: "FunctionDeclaration",
        name,
        returnType: "int",
        params: [],
        body: [
          {
            type: "ReturnStatement",
            expression: { type: "IntegerLiteral", value },
          },
        ],
      },
    ],
  };
}

/**
 * Helper: generate WASM and instantiate it
 */
async function instantiate(ast: Program): Promise<WebAssembly.Instance> {
  const wasm = generate(ast);
  const module = await WebAssembly.compile(wasm.buffer as ArrayBuffer);
  return WebAssembly.instantiate(module);
}

describe("codegen", () => {
  describe("WASM binary format", () => {
    it("produces a Uint8Array", () => {
      const wasm = generate(makeReturnProgram("main", 42));
      expect(wasm).toBeInstanceOf(Uint8Array);
    });

    it("starts with WASM magic number", () => {
      const wasm = generate(makeReturnProgram("main", 42));
      // WASM magic: \0asm
      expect(wasm[0]).toBe(0x00);
      expect(wasm[1]).toBe(0x61);
      expect(wasm[2]).toBe(0x73);
      expect(wasm[3]).toBe(0x6d);
    });

    it("has version 1", () => {
      const wasm = generate(makeReturnProgram("main", 42));
      expect(wasm[4]).toBe(0x01);
      expect(wasm[5]).toBe(0x00);
      expect(wasm[6]).toBe(0x00);
      expect(wasm[7]).toBe(0x00);
    });

    it("produces a valid WASM module that can be compiled", async () => {
      const wasm = generate(makeReturnProgram("main", 42));
      const module = await WebAssembly.compile(wasm.buffer as ArrayBuffer);
      expect(module).toBeInstanceOf(WebAssembly.Module);
    });
  });

  describe("exported functions", () => {
    it("exports the main function", async () => {
      const instance = await instantiate(makeReturnProgram("main", 42));
      expect(typeof instance.exports.main).toBe("function");
    });

    it("exports functions by their declared name", async () => {
      const instance = await instantiate(makeReturnProgram("answer", 42));
      expect(typeof instance.exports.answer).toBe("function");
    });
  });

  describe("return values", () => {
    it("return 42 produces 42", async () => {
      const instance = await instantiate(makeReturnProgram("main", 42));
      const main = instance.exports.main as () => number;
      expect(main()).toBe(42);
    });

    it("return 0 produces 0", async () => {
      const instance = await instantiate(makeReturnProgram("main", 0));
      const main = instance.exports.main as () => number;
      expect(main()).toBe(0);
    });

    it("return 1 produces 1", async () => {
      const instance = await instantiate(makeReturnProgram("main", 1));
      const main = instance.exports.main as () => number;
      expect(main()).toBe(1);
    });

    it("return 255 produces 255", async () => {
      const instance = await instantiate(makeReturnProgram("main", 255));
      const main = instance.exports.main as () => number;
      expect(main()).toBe(255);
    });

    it("return large number 100000", async () => {
      const instance = await instantiate(makeReturnProgram("main", 100000));
      const main = instance.exports.main as () => number;
      expect(main()).toBe(100000);
    });
  });

  describe("multiple functions", () => {
    it("exports multiple functions from one module", async () => {
      const ast: Program = {
        type: "Program",
        declarations: [
          {
            type: "FunctionDeclaration",
            name: "foo",
            returnType: "int",
            params: [],
            body: [
              {
                type: "ReturnStatement",
                expression: { type: "IntegerLiteral", value: 1 },
              },
            ],
          },
          {
            type: "FunctionDeclaration",
            name: "bar",
            returnType: "int",
            params: [],
            body: [
              {
                type: "ReturnStatement",
                expression: { type: "IntegerLiteral", value: 2 },
              },
            ],
          },
        ],
      };

      const instance = await instantiate(ast);
      const foo = instance.exports.foo as () => number;
      const bar = instance.exports.bar as () => number;
      expect(foo()).toBe(1);
      expect(bar()).toBe(2);
    });
  });

  describe("arithmetic expressions (milestone 2)", () => {
    /**
     * Helper: build AST for `int main() { return <expr>; }` with a binary op
     */
    function makeBinaryProgram(
      op: BinaryOperator,
      left: number,
      right: number,
    ): Program {
      return {
        type: "Program",
        declarations: [
          {
            type: "FunctionDeclaration",
            name: "main",
            returnType: "int",
            params: [],
            body: [
              {
                type: "ReturnStatement",
                expression: {
                  type: "BinaryExpression",
                  operator: op,
                  left: { type: "IntegerLiteral", value: left },
                  right: { type: "IntegerLiteral", value: right },
                },
              },
            ],
          },
        ],
      };
    }

    it("generates i32.add for +", async () => {
      const instance = await instantiate(makeBinaryProgram("+", 2, 3));
      const main = instance.exports.main as () => number;
      expect(main()).toBe(5);
    });

    it("generates i32.sub for -", async () => {
      const instance = await instantiate(makeBinaryProgram("-", 10, 4));
      const main = instance.exports.main as () => number;
      expect(main()).toBe(6);
    });

    it("generates i32.mul for *", async () => {
      const instance = await instantiate(makeBinaryProgram("*", 3, 7));
      const main = instance.exports.main as () => number;
      expect(main()).toBe(21);
    });

    it("generates i32.div_s for /", async () => {
      const instance = await instantiate(makeBinaryProgram("/", 10, 3));
      const main = instance.exports.main as () => number;
      expect(main()).toBe(3); // integer division
    });

    it("generates i32.rem_s for %", async () => {
      const instance = await instantiate(makeBinaryProgram("%", 10, 3));
      const main = instance.exports.main as () => number;
      expect(main()).toBe(1);
    });

    it("handles nested binary expressions", async () => {
      // (2 + 3) * 4 = 20
      const ast: Program = {
        type: "Program",
        declarations: [
          {
            type: "FunctionDeclaration",
            name: "main",
            returnType: "int",
            params: [],
            body: [
              {
                type: "ReturnStatement",
                expression: {
                  type: "BinaryExpression",
                  operator: "*",
                  left: {
                    type: "BinaryExpression",
                    operator: "+",
                    left: { type: "IntegerLiteral", value: 2 },
                    right: { type: "IntegerLiteral", value: 3 },
                  },
                  right: { type: "IntegerLiteral", value: 4 },
                },
              },
            ],
          },
        ],
      };
      const instance = await instantiate(ast);
      const main = instance.exports.main as () => number;
      expect(main()).toBe(20);
    });

    it("handles unary negation", async () => {
      const ast: Program = {
        type: "Program",
        declarations: [
          {
            type: "FunctionDeclaration",
            name: "main",
            returnType: "int",
            params: [],
            body: [
              {
                type: "ReturnStatement",
                expression: {
                  type: "UnaryExpression",
                  operator: "-",
                  operand: { type: "IntegerLiteral", value: 42 },
                },
              },
            ],
          },
        ],
      };
      const instance = await instantiate(ast);
      const main = instance.exports.main as () => number;
      // WASM i32 is 32-bit two's complement, -42 wraps to 4294967254 as unsigned
      // but JS reads it as signed via | 0
      expect(main() | 0).toBe(-42);
    });
  });

  describe("local variables (milestone 3)", () => {
    it("handles a single local variable", async () => {
      const ast: Program = {
        type: "Program",
        declarations: [
          {
            type: "FunctionDeclaration",
            name: "main",
            returnType: "int",
            params: [],
            body: [
              {
                type: "VariableDeclaration",
                name: "x",
                typeSpec: "int",
                initializer: { type: "IntegerLiteral", value: 42 },
              },
              {
                type: "ReturnStatement",
                expression: { type: "Identifier", name: "x" },
              },
            ],
          },
        ],
      };
      const instance = await instantiate(ast);
      const main = instance.exports.main as () => number;
      expect(main()).toBe(42);
    });

    it("handles two locals added together", async () => {
      const ast: Program = {
        type: "Program",
        declarations: [
          {
            type: "FunctionDeclaration",
            name: "main",
            returnType: "int",
            params: [],
            body: [
              {
                type: "VariableDeclaration",
                name: "x",
                typeSpec: "int",
                initializer: { type: "IntegerLiteral", value: 10 },
              },
              {
                type: "VariableDeclaration",
                name: "y",
                typeSpec: "int",
                initializer: { type: "IntegerLiteral", value: 20 },
              },
              {
                type: "ReturnStatement",
                expression: {
                  type: "BinaryExpression",
                  operator: "+",
                  left: { type: "Identifier", name: "x" },
                  right: { type: "Identifier", name: "y" },
                },
              },
            ],
          },
        ],
      };
      const instance = await instantiate(ast);
      const main = instance.exports.main as () => number;
      expect(main()).toBe(30);
    });

    it("handles variable with expression initializer", async () => {
      const ast: Program = {
        type: "Program",
        declarations: [
          {
            type: "FunctionDeclaration",
            name: "main",
            returnType: "int",
            params: [],
            body: [
              {
                type: "VariableDeclaration",
                name: "x",
                typeSpec: "int",
                initializer: {
                  type: "BinaryExpression",
                  operator: "+",
                  left: { type: "IntegerLiteral", value: 2 },
                  right: { type: "IntegerLiteral", value: 3 },
                },
              },
              {
                type: "ReturnStatement",
                expression: { type: "Identifier", name: "x" },
              },
            ],
          },
        ],
      };
      const instance = await instantiate(ast);
      const main = instance.exports.main as () => number;
      expect(main()).toBe(5);
    });

    it("handles variable reassignment", async () => {
      const ast: Program = {
        type: "Program",
        declarations: [
          {
            type: "FunctionDeclaration",
            name: "main",
            returnType: "int",
            params: [],
            body: [
              {
                type: "VariableDeclaration",
                name: "x",
                typeSpec: "int",
                initializer: { type: "IntegerLiteral", value: 1 },
              },
              {
                type: "ExpressionStatement",
                expression: {
                  type: "AssignmentExpression",
                  name: "x",
                  value: { type: "IntegerLiteral", value: 99 },
                },
              },
              {
                type: "ReturnStatement",
                expression: { type: "Identifier", name: "x" },
              },
            ],
          },
        ],
      };
      const instance = await instantiate(ast);
      const main = instance.exports.main as () => number;
      expect(main()).toBe(99);
    });
  });
});
