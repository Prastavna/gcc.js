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

  describe("assignment operator (milestone 3)", () => {
    it("tokenizes = as EQUALS", () => {
      const tokens = tokenize("int x = 10;");
      const eq = tokens.find((t) => t.type === TokenType.EQUALS);
      expect(eq).toBeDefined();
      expect(eq!.value).toBe("=");
    });

    it("tokenizes variable declaration", () => {
      const tokens = tokenize("int x = 10;");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.INT,
        TokenType.IDENTIFIER,
        TokenType.EQUALS,
        TokenType.NUMBER,
        TokenType.SEMICOLON,
      ]);
    });

    it("tokenizes variable reassignment", () => {
      const tokens = tokenize("x = 5;");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.IDENTIFIER,
        TokenType.EQUALS,
        TokenType.NUMBER,
        TokenType.SEMICOLON,
      ]);
    });
  });

  describe("comparison and control flow tokens (milestone 5)", () => {
    it("tokenizes == and !=", () => {
      const tokens = tokenize("a == b != c");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.IDENTIFIER, TokenType.EQ, TokenType.IDENTIFIER,
        TokenType.NEQ, TokenType.IDENTIFIER,
      ]);
    });

    it("tokenizes < > <= >=", () => {
      const tokens = tokenize("a < b > c <= d >= e");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.IDENTIFIER, TokenType.LT, TokenType.IDENTIFIER,
        TokenType.GT, TokenType.IDENTIFIER, TokenType.LTE, TokenType.IDENTIFIER,
        TokenType.GTE, TokenType.IDENTIFIER,
      ]);
    });

    it("tokenizes = vs ==", () => {
      const tokens = tokenize("x = y == z");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.IDENTIFIER, TokenType.EQUALS, TokenType.IDENTIFIER,
        TokenType.EQ, TokenType.IDENTIFIER,
      ]);
    });

    it("tokenizes if/else/while/for keywords", () => {
      const tokens = tokenize("if else while for");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([TokenType.IF, TokenType.ELSE, TokenType.WHILE, TokenType.FOR]);
    });
  });

  describe("pointer tokens (milestone 6)", () => {
    it("tokenizes & as AMPERSAND", () => {
      const tokens = tokenize("&x");
      expect(tokens[0].type).toBe(TokenType.AMPERSAND);
      expect(tokens[0].value).toBe("&");
    });

    it("tokenizes pointer declaration int *p", () => {
      const tokens = tokenize("int *p = &x;");
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.INT, TokenType.STAR, TokenType.IDENTIFIER,
        TokenType.EQUALS, TokenType.AMPERSAND, TokenType.IDENTIFIER,
        TokenType.SEMICOLON,
      ]);
    });
  });

  describe("string literals (milestone 7)", () => {
    it("tokenizes a string literal", () => {
      const tokens = tokenize('"hello"');
      expect(tokens[0].type).toBe(TokenType.STRING);
      expect(tokens[0].value).toBe("hello");
    });

    it("tokenizes string with escape sequences", () => {
      const tokens = tokenize('"hello\\n"');
      expect(tokens[0].type).toBe(TokenType.STRING);
      expect(tokens[0].value).toBe("hello\n");
    });

    it("tokenizes printf call with string arg", () => {
      const tokens = tokenize('printf("Hello, World!\\n");');
      const types = tokens.filter((t) => t.type !== TokenType.EOF).map((t) => t.type);
      expect(types).toEqual([
        TokenType.IDENTIFIER, TokenType.LPAREN, TokenType.STRING,
        TokenType.RPAREN, TokenType.SEMICOLON,
      ]);
    });

    it("tokenizes empty string", () => {
      const tokens = tokenize('""');
      expect(tokens[0].type).toBe(TokenType.STRING);
      expect(tokens[0].value).toBe("");
    });
  });

  describe("logical operators (milestone 8)", () => {
    it("tokenizes && and ||", () => {
      const tokens = tokenize("a && b || c");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.IDENTIFIER, TokenType.AND_AND,
        TokenType.IDENTIFIER, TokenType.PIPE_PIPE,
        TokenType.IDENTIFIER,
      ]);
    });

    it("tokenizes !", () => {
      const tokens = tokenize("!x");
      expect(tokens[0].type).toBe(TokenType.BANG);
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER);
    });

    it("distinguishes ! from !=", () => {
      const tokens = tokenize("!x != y");
      expect(tokens[0].type).toBe(TokenType.BANG);
      expect(tokens[2].type).toBe(TokenType.NEQ);
    });

    it("distinguishes & from &&", () => {
      const tokens = tokenize("&x && y");
      expect(tokens[0].type).toBe(TokenType.AMPERSAND);
      expect(tokens[2].type).toBe(TokenType.AND_AND);
    });
  });

  describe("ternary operator (milestone 8)", () => {
    it("tokenizes ? and :", () => {
      const tokens = tokenize("a ? b : c");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.IDENTIFIER, TokenType.QUESTION,
        TokenType.IDENTIFIER, TokenType.COLON,
        TokenType.IDENTIFIER,
      ]);
    });
  });

  describe("increment/decrement (milestone 8)", () => {
    it("tokenizes ++ and --", () => {
      const tokens = tokenize("x++ + --y");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.IDENTIFIER, TokenType.PLUS_PLUS,
        TokenType.PLUS,
        TokenType.MINUS_MINUS, TokenType.IDENTIFIER,
      ]);
    });

    it("distinguishes ++ from + +", () => {
      const t1 = tokenize("x++");
      expect(t1[1].type).toBe(TokenType.PLUS_PLUS);

      const t2 = tokenize("x + +y");
      expect(t2[1].type).toBe(TokenType.PLUS);
      expect(t2[2].type).toBe(TokenType.PLUS);
    });
  });

  describe("compound assignment (milestone 8)", () => {
    it("tokenizes +=, -=, *=, /=, %=", () => {
      const tokens = tokenize("a += b -= c *= d /= e %= f");
      const ops = tokens.filter(t =>
        t.type === TokenType.PLUS_EQUALS || t.type === TokenType.MINUS_EQUALS ||
        t.type === TokenType.STAR_EQUALS || t.type === TokenType.SLASH_EQUALS ||
        t.type === TokenType.PERCENT_EQUALS
      );
      expect(ops.map(t => t.value)).toEqual(["+=", "-=", "*=", "/=", "%="]);
    });

    it("distinguishes += from + =", () => {
      const t1 = tokenize("x += 1");
      expect(t1[1].type).toBe(TokenType.PLUS_EQUALS);
    });
  });

  describe("comments (milestone 8)", () => {
    it("skips single-line comments", () => {
      const tokens = tokenize("int x = 5; // this is a comment\nreturn x;");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.INT, TokenType.IDENTIFIER, TokenType.EQUALS, TokenType.NUMBER, TokenType.SEMICOLON,
        TokenType.RETURN, TokenType.IDENTIFIER, TokenType.SEMICOLON,
      ]);
    });

    it("skips multi-line comments", () => {
      const tokens = tokenize("int x = /* a comment */ 5;");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.INT, TokenType.IDENTIFIER, TokenType.EQUALS, TokenType.NUMBER, TokenType.SEMICOLON,
      ]);
    });

    it("handles multi-line comment spanning lines", () => {
      const tokens = tokenize("int x = 1;\n/* line 1\nline 2\n*/\nint y = 2;");
      const idents = tokens.filter(t => t.type === TokenType.IDENTIFIER);
      expect(idents.map(t => t.value)).toEqual(["x", "y"]);
    });
  });

  describe("bracket tokens (milestone 9 - arrays)", () => {
    it("tokenizes [ and ]", () => {
      const tokens = tokenize("arr[0]");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.IDENTIFIER, TokenType.LBRACKET, TokenType.NUMBER, TokenType.RBRACKET,
      ]);
    });

    it("tokenizes array declaration", () => {
      const tokens = tokenize("int arr[5];");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.INT, TokenType.IDENTIFIER, TokenType.LBRACKET, TokenType.NUMBER,
        TokenType.RBRACKET, TokenType.SEMICOLON,
      ]);
    });
  });

  describe("error handling", () => {
    it("throws on unexpected characters", () => {
      expect(() => tokenize("int main() { return @; }")).toThrow();
    });
  });

  describe("char, long, sizeof keywords and char literals", () => {
    it("tokenizes char c = 'A';", () => {
      const tokens = tokenize("char c = 'A';");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.CHAR, TokenType.IDENTIFIER, TokenType.EQUALS, TokenType.CHAR_LITERAL, TokenType.SEMICOLON,
      ]);
    });

    it("tokenizes long x = 100;", () => {
      const tokens = tokenize("long x = 100;");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.LONG, TokenType.IDENTIFIER, TokenType.EQUALS, TokenType.NUMBER, TokenType.SEMICOLON,
      ]);
    });

    it("tokenizes sizeof(int)", () => {
      const tokens = tokenize("sizeof(int)");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.SIZEOF, TokenType.LPAREN, TokenType.INT, TokenType.RPAREN,
      ]);
    });

    it("char literal 'A' has value 65", () => {
      const tokens = tokenize("'A'");
      expect(tokens[0].type).toBe(TokenType.CHAR_LITERAL);
      expect(tokens[0].value).toBe("65");
    });

    it("escape '\\n' has value 10", () => {
      const tokens = tokenize("'\\n'");
      expect(tokens[0].type).toBe(TokenType.CHAR_LITERAL);
      expect(tokens[0].value).toBe("10");
    });

    it("escape '\\0' has value 0", () => {
      const tokens = tokenize("'\\0'");
      expect(tokens[0].type).toBe(TokenType.CHAR_LITERAL);
      expect(tokens[0].value).toBe("0");
    });

    it("escape '\\\\' has value 92", () => {
      const tokens = tokenize("'\\\\'");
      expect(tokens[0].type).toBe(TokenType.CHAR_LITERAL);
      expect(tokens[0].value).toBe("92");
    });
  });

  describe("struct tokens (milestone 10)", () => {
    it("tokenizes struct keyword", () => {
      const tokens = tokenize("struct");
      expect(tokens[0].type).toBe(TokenType.STRUCT);
    });

    it("tokenizes . as DOT", () => {
      const tokens = tokenize("p.x");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([TokenType.IDENTIFIER, TokenType.DOT, TokenType.IDENTIFIER]);
    });

    it("tokenizes -> as ARROW", () => {
      const tokens = tokenize("p->x");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([TokenType.IDENTIFIER, TokenType.ARROW, TokenType.IDENTIFIER]);
    });

    it("distinguishes -> from -- and -", () => {
      const tokens = tokenize("p->x p-- p-1");
      const ops = tokens.filter(t => ([TokenType.ARROW, TokenType.MINUS_MINUS, TokenType.MINUS] as string[]).includes(t.type));
      expect(ops.map(t => t.type)).toEqual([TokenType.ARROW, TokenType.MINUS_MINUS, TokenType.MINUS]);
    });

    it("tokenizes struct definition", () => {
      const tokens = tokenize("struct Point { int x; int y; };");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.STRUCT, TokenType.IDENTIFIER, TokenType.LBRACE,
        TokenType.INT, TokenType.IDENTIFIER, TokenType.SEMICOLON,
        TokenType.INT, TokenType.IDENTIFIER, TokenType.SEMICOLON,
        TokenType.RBRACE, TokenType.SEMICOLON,
      ]);
    });
  });

  describe("milestone 18: do, goto keywords", () => {
    it("tokenizes do keyword", () => {
      const tokens = tokenize("do");
      expect(tokens[0].type).toBe(TokenType.DO);
    });

    it("tokenizes goto keyword", () => {
      const tokens = tokenize("goto");
      expect(tokens[0].type).toBe(TokenType.GOTO);
    });

    it("tokenizes do-while statement", () => {
      const tokens = tokenize("do { x = 1; } while (x < 5);");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.DO, TokenType.LBRACE, TokenType.IDENTIFIER, TokenType.EQUALS,
        TokenType.NUMBER, TokenType.SEMICOLON, TokenType.RBRACE, TokenType.WHILE,
        TokenType.LPAREN, TokenType.IDENTIFIER, TokenType.LT, TokenType.NUMBER,
        TokenType.RPAREN, TokenType.SEMICOLON,
      ]);
    });

    it("tokenizes goto statement", () => {
      const tokens = tokenize("goto done;");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([TokenType.GOTO, TokenType.IDENTIFIER, TokenType.SEMICOLON]);
    });

    it("tokenizes label", () => {
      const tokens = tokenize("done: return 0;");
      const types = tokens.filter(t => t.type !== TokenType.EOF).map(t => t.type);
      expect(types).toEqual([
        TokenType.IDENTIFIER, TokenType.COLON, TokenType.RETURN,
        TokenType.NUMBER, TokenType.SEMICOLON,
      ]);
    });
  });
});
