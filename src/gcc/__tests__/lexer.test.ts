import { describe, it, expect } from "vitest";
import { tokenize } from "../lexer.ts";
import { TokenType } from "../types.ts";

describe("lexer", () => {
  describe("minimal: int main() { return 42; }", () => {
    it("tokenizes a simple main function", () => {
      const tokens = tokenize("int main() { return 42; }");

      // Strip EOF for easier assertion
      const withoutEof = tokens.filter((t) => t.type !== TokenType.EOF);

      expect(withoutEof.map((t) => t.type)).toEqual([
        TokenType.INT,
        TokenType.IDENTIFIER,
        TokenType.LPAREN,
        TokenType.RPAREN,
        TokenType.LBRACE,
        TokenType.RETURN,
        TokenType.NUMBER,
        TokenType.SEMICOLON,
        TokenType.RBRACE,
      ]);
    });

    it("produces EOF as the last token", () => {
      const tokens = tokenize("int main() { return 42; }");
      const last = tokens[tokens.length - 1];
      expect(last.type).toBe(TokenType.EOF);
    });

    it("captures correct values", () => {
      const tokens = tokenize("int main() { return 42; }");
      const values = tokens.map((t) => t.value);
      expect(values).toEqual([
        "int", "main", "(", ")", "{", "return", "42", ";", "}", "",
      ]);
    });
  });

  describe("whitespace handling", () => {
    it("handles extra whitespace and newlines", () => {
      const source = `
        int   main(  )
        {
          return   0 ;
        }
      `;
      const tokens = tokenize(source);
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);

      expect(types).toEqual([
        TokenType.INT,
        TokenType.IDENTIFIER,
        TokenType.LPAREN,
        TokenType.RPAREN,
        TokenType.LBRACE,
        TokenType.RETURN,
        TokenType.NUMBER,
        TokenType.SEMICOLON,
        TokenType.RBRACE,
      ]);
    });

    it("handles tabs", () => {
      const tokens = tokenize("\tint\tmain()\t{\treturn\t0;\t}");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types.length).toBe(9);
    });
  });

  describe("line and column tracking", () => {
    it("tracks line numbers across newlines", () => {
      const source = "int main() {\nreturn 42;\n}";
      const tokens = tokenize(source);
      const returnToken = tokens.find((t) => t.type === TokenType.RETURN)!;
      expect(returnToken.line).toBe(2);
      expect(returnToken.col).toBe(1);
    });

    it("tracks column numbers", () => {
      const tokens = tokenize("int main");
      expect(tokens[0].col).toBe(1); // "int" starts at col 1
      expect(tokens[1].col).toBe(5); // "main" starts at col 5
    });
  });

  describe("number literals", () => {
    it("tokenizes single digit", () => {
      const tokens = tokenize("return 0;");
      const num = tokens.find((t) => t.type === TokenType.NUMBER)!;
      expect(num.value).toBe("0");
    });

    it("tokenizes multi-digit numbers", () => {
      const tokens = tokenize("return 12345;");
      const num = tokens.find((t) => t.type === TokenType.NUMBER)!;
      expect(num.value).toBe("12345");
    });

    it("tokenizes negative-representable numbers (just the positive part)", () => {
      // The lexer should tokenize `-42` as MINUS + NUMBER(42)
      // For milestone 1, we only need unsigned integer literals
      const tokens = tokenize("return 42;");
      const num = tokens.find((t) => t.type === TokenType.NUMBER)!;
      expect(num.value).toBe("42");
    });
  });

  describe("keywords vs identifiers", () => {
    it("distinguishes int keyword from identifier", () => {
      const tokens = tokenize("int integer");
      expect(tokens[0].type).toBe(TokenType.INT);
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[1].value).toBe("integer");
    });

    it("distinguishes return keyword from identifier", () => {
      const tokens = tokenize("return returning");
      expect(tokens[0].type).toBe(TokenType.RETURN);
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[1].value).toBe("returning");
    });

    it("handles void keyword", () => {
      const tokens = tokenize("void");
      expect(tokens[0].type).toBe(TokenType.VOID);
    });
  });

  describe("edge cases", () => {
    it("returns only EOF for empty input", () => {
      const tokens = tokenize("");
      expect(tokens.length).toBe(1);
      expect(tokens[0].type).toBe(TokenType.EOF);
    });

    it("returns only EOF for whitespace-only input", () => {
      const tokens = tokenize("   \n\n\t  ");
      expect(tokens.length).toBe(1);
      expect(tokens[0].type).toBe(TokenType.EOF);
    });

    it("handles identifiers with underscores", () => {
      const tokens = tokenize("int _foo_bar");
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[1].value).toBe("_foo_bar");
    });

    it("handles identifiers starting with underscore", () => {
      const tokens = tokenize("_main");
      expect(tokens[0].type).toBe(TokenType.IDENTIFIER);
      expect(tokens[0].value).toBe("_main");
    });
  });

  describe("operators (milestone 2)", () => {
    it("tokenizes arithmetic operators", () => {
      const tokens = tokenize("2 + 3 * 4");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.NUMBER,
        TokenType.PLUS,
        TokenType.NUMBER,
        TokenType.STAR,
        TokenType.NUMBER,
      ]);
    });

    it("tokenizes all five arithmetic operators", () => {
      const tokens = tokenize("+ - * / %");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.PLUS,
        TokenType.MINUS,
        TokenType.STAR,
        TokenType.SLASH,
        TokenType.PERCENT,
      ]);
    });

    it("tokenizes operators without spaces", () => {
      const tokens = tokenize("2+3*4");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.NUMBER,
        TokenType.PLUS,
        TokenType.NUMBER,
        TokenType.STAR,
        TokenType.NUMBER,
      ]);
    });

    it("tokenizes parenthesized expression", () => {
      const tokens = tokenize("(2 + 3) * 4");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.LPAREN,
        TokenType.NUMBER,
        TokenType.PLUS,
        TokenType.NUMBER,
        TokenType.RPAREN,
        TokenType.STAR,
        TokenType.NUMBER,
      ]);
    });

    it("tokenizes unary minus as MINUS + NUMBER", () => {
      const tokens = tokenize("-42");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([TokenType.MINUS, TokenType.NUMBER]);
    });
  });

  describe("error handling", () => {
    it("throws on unexpected characters", () => {
      expect(() => tokenize("int main() { return @; }")).toThrow();
    });
  });
});
