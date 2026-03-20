import { TokenType } from "./types.ts";
import type { Token } from "./types.ts";

const KEYWORDS: Record<string, TokenType> = {
  int: TokenType.INT,
  void: TokenType.VOID,
  char: TokenType.CHAR,
  long: TokenType.LONG,
  sizeof: TokenType.SIZEOF,
  struct: TokenType.STRUCT,
  return: TokenType.RETURN,
  if: TokenType.IF,
  else: TokenType.ELSE,
  while: TokenType.WHILE,
  for: TokenType.FOR,
};

const SIMPLE_TOKENS: Record<string, TokenType> = {
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
  "&": TokenType.AMPERSAND,
  "[": TokenType.LBRACKET,
  "]": TokenType.RBRACKET,
  ".": TokenType.DOT,
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

  function peekChar(): string | undefined {
    return source[pos + 1];
  }

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

    // String literals
    if (ch === '"') {
      const startCol = col;
      pos++; col++; // skip opening quote
      let value = "";
      while (pos < source.length && source[pos] !== '"') {
        if (source[pos] === '\\' && pos + 1 < source.length) {
          pos++; col++;
          const esc = source[pos];
          switch (esc) {
            case 'n': value += '\n'; break;
            case 't': value += '\t'; break;
            case 'r': value += '\r'; break;
            case '\\': value += '\\'; break;
            case '"': value += '"'; break;
            case '0': value += '\0'; break;
            default: value += esc; break;
          }
        } else {
          value += source[pos];
        }
        pos++; col++;
      }
      if (pos >= source.length) throw new Error(`Unterminated string at line ${line}, col ${startCol}`);
      pos++; col++; // skip closing quote
      tokens.push({ type: TokenType.STRING, value, line, col: startCol });
      continue;
    }

    // Character literals
    if (ch === "'") {
      const startCol = col;
      pos++; col++; // skip opening quote
      let charCode: number;
      if (pos >= source.length) throw new Error(`Unterminated character literal at line ${line}, col ${startCol}`);
      if (source[pos] === '\\') {
        pos++; col++;
        if (pos >= source.length) throw new Error(`Unterminated character literal at line ${line}, col ${startCol}`);
        const esc = source[pos];
        switch (esc) {
          case 'n': charCode = 10; break;
          case 't': charCode = 9; break;
          case 'r': charCode = 13; break;
          case '\\': charCode = 92; break;
          case '\'': charCode = 39; break;
          case '0': charCode = 0; break;
          default: charCode = esc.charCodeAt(0); break;
        }
      } else {
        charCode = source[pos].charCodeAt(0);
      }
      pos++; col++;
      if (pos >= source.length || source[pos] !== "'") throw new Error(`Unterminated character literal at line ${line}, col ${startCol}`);
      pos++; col++; // skip closing quote
      tokens.push({ type: TokenType.CHAR_LITERAL, value: String(charCode), line, col: startCol });
      continue;
    }

    // Skip single-line comments
    if (ch === "/" && peekChar() === "/") {
      pos += 2; col += 2;
      while (pos < source.length && source[pos] !== "\n") { pos++; col++; }
      continue;
    }

    // Skip multi-line comments
    if (ch === "/" && peekChar() === "*") {
      pos += 2; col += 2;
      while (pos < source.length - 1 && !(source[pos] === "*" && source[pos + 1] === "/")) {
        if (source[pos] === "\n") { line++; col = 1; } else { col++; }
        pos++;
      }
      if (pos < source.length - 1) { pos += 2; col += 2; } // skip */
      continue;
    }

    // Two-character operators (must check before single-char)
    if (ch === "=" && peekChar() === "=") {
      tokens.push({ type: TokenType.EQ, value: "==", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "!" && peekChar() === "=") {
      tokens.push({ type: TokenType.NEQ, value: "!=", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "!") {
      tokens.push({ type: TokenType.BANG, value: "!", line, col });
      pos++; col++; continue;
    }
    if (ch === "&" && peekChar() === "&") {
      tokens.push({ type: TokenType.AND_AND, value: "&&", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "|" && peekChar() === "|") {
      tokens.push({ type: TokenType.PIPE_PIPE, value: "||", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "+" && peekChar() === "+") {
      tokens.push({ type: TokenType.PLUS_PLUS, value: "++", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "-" && peekChar() === ">") {
      tokens.push({ type: TokenType.ARROW, value: "->", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "-" && peekChar() === "-") {
      tokens.push({ type: TokenType.MINUS_MINUS, value: "--", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "+" && peekChar() === "=") {
      tokens.push({ type: TokenType.PLUS_EQUALS, value: "+=", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "-" && peekChar() === "=") {
      tokens.push({ type: TokenType.MINUS_EQUALS, value: "-=", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "*" && peekChar() === "=") {
      tokens.push({ type: TokenType.STAR_EQUALS, value: "*=", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "/" && peekChar() === "=") {
      tokens.push({ type: TokenType.SLASH_EQUALS, value: "/=", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "%" && peekChar() === "=") {
      tokens.push({ type: TokenType.PERCENT_EQUALS, value: "%=", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "<" && peekChar() === "=") {
      tokens.push({ type: TokenType.LTE, value: "<=", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === ">" && peekChar() === "=") {
      tokens.push({ type: TokenType.GTE, value: ">=", line, col });
      pos += 2; col += 2; continue;
    }
    if (ch === "<") {
      tokens.push({ type: TokenType.LT, value: "<", line, col });
      pos++; col++; continue;
    }
    if (ch === ">") {
      tokens.push({ type: TokenType.GT, value: ">", line, col });
      pos++; col++; continue;
    }

    // Ternary operators
    if (ch === "?") {
      tokens.push({ type: TokenType.QUESTION, value: "?", line, col });
      pos++; col++; continue;
    }
    if (ch === ":") {
      tokens.push({ type: TokenType.COLON, value: ":", line, col });
      pos++; col++; continue;
    }

    // Single-character tokens (= is now here, after == check)
    if (ch === "=") {
      tokens.push({ type: TokenType.EQUALS, value: "=", line, col });
      pos++; col++; continue;
    }

    const simpleType = SIMPLE_TOKENS[ch];
    if (simpleType !== undefined) {
      tokens.push({ type: simpleType, value: ch, line, col });
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
