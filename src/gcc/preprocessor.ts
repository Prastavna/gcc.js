// ── C Preprocessor ──────────────────────────────────────────
// Runs before the lexer: processes #define, #ifdef/#ifndef/#endif,
// #if/#elif, #include, #undef, #error, #pragma, #line directives.
// Supports stringification (#) and token pasting (##) in macros.

export interface PreprocessorOptions {
  /** Virtual filesystem for #include: filename → source content */
  files?: Record<string, string>;
  /** Pre-defined macros (like -D on the command line) */
  defines?: Record<string, string>;
}

interface ObjectMacro {
  kind: "object";
  name: string;
  body: string;
}

interface FunctionMacro {
  kind: "function";
  name: string;
  params: string[];
  body: string;
}

type Macro = ObjectMacro | FunctionMacro;

const MAX_INCLUDE_DEPTH = 16;
const MAX_EXPANSION_DEPTH = 64;

/**
 * Preprocesses C source: expands macros, evaluates conditionals,
 * inlines #include files from the virtual filesystem.
 */
export function preprocess(source: string, options?: PreprocessorOptions): string {
  const macros = new Map<string, Macro>();

  // Seed pre-defined macros
  if (options?.defines) {
    for (const [name, body] of Object.entries(options.defines)) {
      macros.set(name, { kind: "object", name, body });
    }
  }

  return preprocessSource(source, macros, options?.files ?? {}, 0);
}

function preprocessSource(
  source: string,
  macros: Map<string, Macro>,
  files: Record<string, string>,
  includeDepth: number,
): string {
  if (includeDepth > MAX_INCLUDE_DEPTH) {
    throw new Error("Preprocessor error: maximum #include depth exceeded (circular include?)");
  }

  const lines = source.split("\n");
  const output: string[] = [];
  const condStack: { active: boolean; parentActive: boolean; elseSeen: boolean; satisfied: boolean }[] = [];

  function isActive(): boolean {
    return condStack.every((c) => c.active);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed.startsWith("#")) {
      const directive = parseDirective(trimmed);

      // Conditional directives must always be processed (even in inactive regions)
      // to track nesting properly
      if (directive.name === "ifdef" || directive.name === "ifndef") {
        const macroName = directive.args.trim();
        if (!macroName) throw new Error(`Preprocessor error: #${directive.name} requires a macro name (line ${i + 1})`);
        const defined = macros.has(macroName);
        const active = directive.name === "ifdef" ? defined : !defined;
        const parentActive = isActive();
        condStack.push({ active: parentActive && active, parentActive, elseSeen: false, satisfied: parentActive && active });
        output.push(""); // blank line preserves line numbers
        continue;
      }

      if (directive.name === "if") {
        const parentActive = isActive();
        let active = false;
        if (parentActive) {
          active = evaluateConstExpr(directive.args, macros) !== 0;
        }
        condStack.push({ active: parentActive && active, parentActive, elseSeen: false, satisfied: parentActive && active });
        output.push("");
        continue;
      }

      if (directive.name === "else") {
        if (condStack.length === 0) throw new Error(`Preprocessor error: #else without #if/#ifdef/#ifndef (line ${i + 1})`);
        const top = condStack[condStack.length - 1];
        if (top.elseSeen) throw new Error(`Preprocessor error: duplicate #else (line ${i + 1})`);
        top.elseSeen = true;
        top.active = top.parentActive && !top.satisfied;
        output.push("");
        continue;
      }

      if (directive.name === "elif") {
        if (condStack.length === 0) throw new Error(`Preprocessor error: #elif without #if/#ifdef/#ifndef (line ${i + 1})`);
        const top = condStack[condStack.length - 1];
        if (top.elseSeen) throw new Error(`Preprocessor error: #elif after #else (line ${i + 1})`);
        if (top.satisfied || !top.parentActive) {
          top.active = false;
        } else {
          const val = evaluateConstExpr(directive.args, macros) !== 0;
          top.active = val;
          if (val) top.satisfied = true;
        }
        output.push("");
        continue;
      }

      if (directive.name === "endif") {
        if (condStack.length === 0) throw new Error(`Preprocessor error: #endif without #if/#ifdef/#ifndef (line ${i + 1})`);
        condStack.pop();
        output.push("");
        continue;
      }

      // All other directives only processed when active
      if (!isActive()) {
        output.push("");
        continue;
      }

      if (directive.name === "define") {
        parseDefine(directive.args, macros, i + 1);
        output.push("");
        continue;
      }

      if (directive.name === "undef") {
        const macroName = directive.args.trim();
        if (!macroName) throw new Error(`Preprocessor error: #undef requires a macro name (line ${i + 1})`);
        macros.delete(macroName);
        output.push("");
        continue;
      }

      if (directive.name === "error") {
        throw new Error(`Preprocessor error: #error ${directive.args} (line ${i + 1})`);
      }

      if (directive.name === "pragma" || directive.name === "line") {
        output.push("");
        continue;
      }

      if (directive.name === "include") {
        const filename = parseIncludeFilename(directive.args, i + 1);
        if (!(filename in files)) {
          throw new Error(`Preprocessor error: file not found: "${filename}" (line ${i + 1})`);
        }
        const included = preprocessSource(files[filename], macros, files, includeDepth + 1);
        // Insert included content — this shifts line numbers for included code
        // but preserves them for lines after the #include
        output.push(included);
        continue;
      }

      // Unknown directive — ignore (could warn)
      output.push("");
      continue;
    }

    // Not a directive line
    if (!isActive()) {
      output.push("");
      continue;
    }

    // Expand macros in the line
    output.push(expandMacros(line, macros, new Set()));
  }

  if (condStack.length > 0) {
    throw new Error(`Preprocessor error: unterminated #ifdef/#ifndef (${condStack.length} unclosed)`);
  }

  return output.join("\n");
}

// ── Directive Parsing ───────────────────────────────────────

interface Directive {
  name: string;
  args: string;
}

function parseDirective(line: string): Directive {
  // line starts with # (after trimming)
  const match = line.match(/^#\s*(\w+)\s*(.*)?$/);
  if (!match) return { name: "", args: "" };
  return { name: match[1], args: (match[2] ?? "").trimEnd() };
}

function parseDefine(args: string, macros: Map<string, Macro>, lineNum: number): void {
  // Function-like: NAME(params) body
  // Object-like: NAME body
  const funcMatch = args.match(/^(\w+)\(([^)]*)\)\s*(.*)?$/);
  if (funcMatch) {
    const name = funcMatch[1];
    const params = funcMatch[2]
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const body = (funcMatch[3] ?? "").trim();
    macros.set(name, { kind: "function", name, params, body });
    return;
  }

  const objMatch = args.match(/^(\w+)(?:\s+(.*))?$/);
  if (objMatch) {
    const name = objMatch[1];
    const body = (objMatch[2] ?? "").trim();
    macros.set(name, { kind: "object", name, body });
    return;
  }

  throw new Error(`Preprocessor error: invalid #define syntax (line ${lineNum})`);
}

function parseIncludeFilename(args: string, lineNum: number): string {
  // Support "filename" and <filename>
  const dqMatch = args.match(/^"([^"]+)"$/);
  if (dqMatch) return dqMatch[1];
  const abMatch = args.match(/^<([^>]+)>$/);
  if (abMatch) return abMatch[1];
  throw new Error(`Preprocessor error: invalid #include syntax (line ${lineNum})`);
}

// ── Macro Expansion ─────────────────────────────────────────

function expandMacros(text: string, macros: Map<string, Macro>, expanding: Set<string>, depth = 0): string {
  if (depth > MAX_EXPANSION_DEPTH) return text;
  if (macros.size === 0) return text;

  let result = "";
  let i = 0;

  while (i < text.length) {
    // Skip string literals
    if (text[i] === '"') {
      const end = findStringEnd(text, i);
      result += text.slice(i, end);
      i = end;
      continue;
    }

    // Skip char literals
    if (text[i] === "'") {
      const end = findCharEnd(text, i);
      result += text.slice(i, end);
      i = end;
      continue;
    }

    // Try to match an identifier
    if (isIdentStart(text[i])) {
      const start = i;
      while (i < text.length && isIdentChar(text[i])) i++;
      const ident = text.slice(start, i);

      const macro = macros.get(ident);
      if (!macro || expanding.has(ident)) {
        result += ident;
        continue;
      }

      if (macro.kind === "object") {
        const newExpanding = new Set(expanding);
        newExpanding.add(ident);
        const expanded = expandMacros(macro.body, macros, newExpanding, depth + 1);
        result += expanded;
        continue;
      }

      // Function-like macro: must be followed by (
      // Skip whitespace between name and (
      let j = i;
      while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;

      if (j < text.length && text[j] === "(") {
        const argsResult = parseMacroArgs(text, j);
        i = argsResult.end;
        const args = argsResult.args;

        if (args.length !== macro.params.length) {
          throw new Error(
            `Preprocessor error: macro ${ident} expects ${macro.params.length} arguments, got ${args.length}`,
          );
        }

        // Stringification: replace #param with "arg"
        let body = macro.body;
        for (let p = 0; p < macro.params.length; p++) {
          body = applyStringify(body, macro.params[p], args[p]);
        }

        // Substitute params in body
        for (let p = 0; p < macro.params.length; p++) {
          body = replaceIdentifier(body, macro.params[p], args[p]);
        }

        // Token pasting: remove ## and join adjacent tokens
        body = body.replace(/\s*##\s*/g, "");

        const newExpanding = new Set(expanding);
        newExpanding.add(ident);
        const expanded = expandMacros(body, macros, newExpanding, depth + 1);
        result += expanded;
        continue;
      } else {
        // Function-like macro name not followed by ( — leave as-is
        result += ident;
        continue;
      }
    }

    result += text[i];
    i++;
  }

  return result;
}

function parseMacroArgs(text: string, start: number): { args: string[]; end: number } {
  // start points to '('
  let i = start + 1;
  const args: string[] = [];
  let current = "";
  let depth = 1;

  while (i < text.length && depth > 0) {
    if (text[i] === "(") {
      depth++;
      current += text[i];
    } else if (text[i] === ")") {
      depth--;
      if (depth === 0) break;
      current += text[i];
    } else if (text[i] === "," && depth === 1) {
      args.push(current.trim());
      current = "";
    } else if (text[i] === '"') {
      const end = findStringEnd(text, i);
      current += text.slice(i, end);
      i = end;
      continue;
    } else if (text[i] === "'") {
      const end = findCharEnd(text, i);
      current += text.slice(i, end);
      i = end;
      continue;
    } else {
      current += text[i];
    }
    i++;
  }

  if (depth !== 0) {
    throw new Error("Preprocessor error: unterminated macro argument list");
  }

  // Push last argument (or handle empty arg list)
  const trimmed = current.trim();
  if (trimmed.length > 0 || args.length > 0) {
    args.push(trimmed);
  }

  return { args, end: i + 1 }; // skip past closing )
}

function replaceIdentifier(text: string, name: string, replacement: string): string {
  let result = "";
  let i = 0;

  while (i < text.length) {
    if (text[i] === '"') {
      const end = findStringEnd(text, i);
      result += text.slice(i, end);
      i = end;
      continue;
    }
    if (text[i] === "'") {
      const end = findCharEnd(text, i);
      result += text.slice(i, end);
      i = end;
      continue;
    }
    if (isIdentStart(text[i])) {
      const start = i;
      while (i < text.length && isIdentChar(text[i])) i++;
      const ident = text.slice(start, i);
      result += ident === name ? replacement : ident;
      continue;
    }
    result += text[i];
    i++;
  }

  return result;
}

// ── Stringification ─────────────────────────────────────────

function applyStringify(body: string, paramName: string, argValue: string): string {
  // Replace #paramName with "argValue" (stringify operator)
  // Must skip ## (token pasting) — only match # not followed by #
  let result = "";
  let i = 0;
  while (i < body.length) {
    if (body[i] === "#") {
      // Skip ## (token pasting operator)
      if (i + 1 < body.length && body[i + 1] === "#") {
        result += "##";
        i += 2;
        continue;
      }
      // Also skip if preceded by another # (we already consumed it, but check for safety)
      // Check if followed by paramName (with optional whitespace)
      let j = i + 1;
      while (j < body.length && (body[j] === " " || body[j] === "\t")) j++;
      if (j < body.length && isIdentStart(body[j])) {
        const start = j;
        while (j < body.length && isIdentChar(body[j])) j++;
        const ident = body.slice(start, j);
        if (ident === paramName) {
          const escaped = argValue.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          result += `"${escaped}"`;
          i = j;
          continue;
        }
      }
    }
    result += body[i];
    i++;
  }
  return result;
}

// ── Constant Expression Evaluator ───────────────────────────

type CppToken = { kind: "num"; val: number } | { kind: "op"; val: string } | { kind: "paren"; val: string };

function tokenizeConstExpr(expr: string): CppToken[] {
  const tokens: CppToken[] = [];
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === " " || expr[i] === "\t") { i++; continue; }
    if (expr[i] >= "0" && expr[i] <= "9") {
      let start = i;
      while (i < expr.length && expr[i] >= "0" && expr[i] <= "9") i++;
      // Skip suffixes like L, U, LL
      while (i < expr.length && (expr[i] === "l" || expr[i] === "L" || expr[i] === "u" || expr[i] === "U")) i++;
      tokens.push({ kind: "num", val: parseInt(expr.slice(start, i), 10) });
      continue;
    }
    if (expr[i] === "(" || expr[i] === ")") {
      tokens.push({ kind: "paren", val: expr[i] });
      i++;
      continue;
    }
    // Two-char operators
    const two = expr.slice(i, i + 2);
    if (two === "==" || two === "!=" || two === "<=" || two === ">=" || two === "&&" || two === "||" || two === "<<" || two === ">>") {
      tokens.push({ kind: "op", val: two });
      i += 2;
      continue;
    }
    // Single-char operators
    if ("+-*/%<>&|^~!".includes(expr[i])) {
      tokens.push({ kind: "op", val: expr[i] });
      i++;
      continue;
    }
    // Skip any other character (shouldn't happen after preprocessing)
    i++;
  }
  return tokens;
}

function evaluateConstExpr(expr: string, macros: Map<string, Macro>): number {
  // 1. Handle defined(NAME) and defined NAME before macro expansion
  let processed = expr.replace(/\bdefined\s*\(\s*(\w+)\s*\)/g, (_, name) => macros.has(name) ? "1" : "0");
  processed = processed.replace(/\bdefined\s+(\w+)/g, (_, name) => macros.has(name) ? "1" : "0");

  // 2. Expand macros
  processed = expandMacros(processed, macros, new Set());

  // 3. Replace remaining identifiers with 0 (C spec)
  processed = processed.replace(/\b[a-zA-Z_]\w*\b/g, "0");

  // 4. Tokenize and parse
  const tokens = tokenizeConstExpr(processed);
  let pos = 0;

  function peek(): CppToken | undefined { return tokens[pos]; }
  function advance(): CppToken { return tokens[pos++]; }

  function parseOr(): number {
    let left = parseAnd();
    while (peek()?.kind === "op" && peek()!.val === "||") { advance(); left = (left || parseAnd()) ? 1 : 0; }
    return left;
  }

  function parseAnd(): number {
    let left = parseBitOr();
    while (peek()?.kind === "op" && peek()!.val === "&&") { advance(); left = (left && parseBitOr()) ? 1 : 0; }
    return left;
  }

  function parseBitOr(): number {
    let left = parseBitXor();
    while (peek()?.kind === "op" && peek()!.val === "|") { advance(); left = left | parseBitXor(); }
    return left;
  }

  function parseBitXor(): number {
    let left = parseBitAnd();
    while (peek()?.kind === "op" && peek()!.val === "^") { advance(); left = left ^ parseBitAnd(); }
    return left;
  }

  function parseBitAnd(): number {
    let left = parseEquality();
    while (peek()?.kind === "op" && peek()!.val === "&") { advance(); left = left & parseEquality(); }
    return left;
  }

  function parseEquality(): number {
    let left = parseRelational();
    while (peek()?.kind === "op" && (peek()!.val === "==" || peek()!.val === "!=")) {
      const op = advance().val;
      const right = parseRelational();
      left = op === "==" ? (left === right ? 1 : 0) : (left !== right ? 1 : 0);
    }
    return left;
  }

  function parseRelational(): number {
    let left = parseShift();
    while (peek()?.kind === "op" && (peek()!.val === "<" || peek()!.val === ">" || peek()!.val === "<=" || peek()!.val === ">=")) {
      const op = advance().val;
      const right = parseShift();
      if (op === "<") left = left < right ? 1 : 0;
      else if (op === ">") left = left > right ? 1 : 0;
      else if (op === "<=") left = left <= right ? 1 : 0;
      else left = left >= right ? 1 : 0;
    }
    return left;
  }

  function parseShift(): number {
    let left = parseAdditive();
    while (peek()?.kind === "op" && (peek()!.val === "<<" || peek()!.val === ">>")) {
      const op = advance().val;
      const right = parseAdditive();
      left = op === "<<" ? left << right : left >> right;
    }
    return left;
  }

  function parseAdditive(): number {
    let left = parseMultiplicative();
    while (peek()?.kind === "op" && (peek()!.val === "+" || peek()!.val === "-")) {
      const op = advance().val;
      const right = parseMultiplicative();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseMultiplicative(): number {
    let left = parseUnary();
    while (peek()?.kind === "op" && (peek()!.val === "*" || peek()!.val === "/" || peek()!.val === "%")) {
      const op = advance().val;
      const right = parseUnary();
      if (op === "*") left = left * right;
      else if (op === "/") left = right !== 0 ? Math.trunc(left / right) : 0;
      else left = right !== 0 ? left % right : 0;
    }
    return left;
  }

  function parseUnary(): number {
    const t = peek();
    if (t?.kind === "op") {
      if (t.val === "!") { advance(); return parseUnary() ? 0 : 1; }
      if (t.val === "-") { advance(); return -parseUnary(); }
      if (t.val === "+") { advance(); return parseUnary(); }
      if (t.val === "~") { advance(); return ~parseUnary(); }
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const t = peek();
    if (!t) return 0;
    if (t.kind === "num") { advance(); return t.val; }
    if (t.kind === "paren" && t.val === "(") {
      advance();
      const val = parseOr();
      if (peek()?.kind === "paren" && peek()!.val === ")") advance();
      return val;
    }
    advance(); // skip unknown
    return 0;
  }

  return parseOr();
}

// ── Character Helpers ───────────────────────────────────────

function isIdentStart(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isIdentChar(ch: string): boolean {
  return isIdentStart(ch) || (ch >= "0" && ch <= "9");
}

function findStringEnd(text: string, start: number): number {
  // start points to opening "
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2; // skip escaped char
      continue;
    }
    if (text[i] === '"') return i + 1;
    i++;
  }
  return i; // unterminated string — let the lexer report the error
}

function findCharEnd(text: string, start: number): number {
  // start points to opening '
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text[i] === "'") return i + 1;
    i++;
  }
  return i;
}
