import { TokenType } from "./types.ts";
import type { Token } from "./types.ts";

const KEYWORDS: Record<string, TokenType> = {
  int: TokenType.INT,
  void: TokenType.VOID,
  return: TokenType.RETURN,
};

const SINGLE_CHAR_TOKENS: Record<string, TokenType> = {
  "(": TokenType.LPAREN,
  ")": TokenType.RPAREN,
  "{": TokenType.LBRACE,
  "}": TokenType.RBRACE,
  ";": TokenType.SEMICOLON,
  ",": TokenType.COMMA,
  "+": TokenType.PLUS,
  "-": TokenType.MINUS,
  "*": TokenType.STAR,
  "/": TokenType.SLASH,
  "%": TokenType.PERCENT,
};

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isAlphaNumeric(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

/**
 * Tokenizes C source code into an array of tokens.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  let line = 1;
  let col = 1;

  while (pos < source.length) {
    const ch = source[pos];

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      if (ch === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      pos++;
      continue;
    }

    // Single-character tokens
    const singleType = SINGLE_CHAR_TOKENS[ch];
    if (singleType !== undefined) {
      tokens.push({ type: singleType, value: ch, line, col });
      pos++;
      col++;
      continue;
    }

    // Number literals
    if (isDigit(ch)) {
      const startCol = col;
      let value = "";
      while (pos < source.length && isDigit(source[pos])) {
        value += source[pos];
        pos++;
        col++;
      }
      tokens.push({ type: TokenType.NUMBER, value, line, col: startCol });
      continue;
    }

    // Identifiers and keywords
    if (isAlpha(ch)) {
      const startCol = col;
      let value = "";
      while (pos < source.length && isAlphaNumeric(source[pos])) {
        value += source[pos];
        pos++;
        col++;
      }
      const type = KEYWORDS[value] ?? TokenType.IDENTIFIER;
      tokens.push({ type, value, line, col: startCol });
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at line ${line}, col ${col}`);
  }

  tokens.push({ type: TokenType.EOF, value: "", line, col });
  return tokens;
}
