#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { compile } from "./gcc/index.ts";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`@prastavna/gcc.js - C to WebAssembly compiler

Usage: @prastavna/gcc.js <input.c> [options]

Options:
  -o <file>     Output file (default: <input>.wasm)
  -D <name>=<value>  Define a preprocessor macro
  --help, -h    Show this help message
  --version, -v Show version

Examples:
  @prastavna/gcc.js code.c              Compile code.c to code.wasm
  @prastavna/gcc.js code.c -o out.wasm  Compile code.c to out.wasm
  @prastavna/gcc.js code.c -D DEBUG=1   Compile with DEBUG macro defined`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  console.log(pkg.version);
  process.exit(0);
}

let inputFile: string | null = null;
let outputFile: string | null = null;
const defines: Record<string, string> = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "-o") {
    outputFile = args[++i];
    if (!outputFile) {
      console.error("Error: -o requires a filename");
      process.exit(1);
    }
  } else if (arg === "-D") {
    const def = args[++i];
    if (!def) {
      console.error("Error: -D requires a macro definition");
      process.exit(1);
    }
    const eq = def.indexOf("=");
    if (eq === -1) {
      defines[def] = "1";
    } else {
      defines[def.slice(0, eq)] = def.slice(eq + 1);
    }
  } else if (arg.startsWith("-D")) {
    const def = arg.slice(2);
    const eq = def.indexOf("=");
    if (eq === -1) {
      defines[def] = "1";
    } else {
      defines[def.slice(0, eq)] = def.slice(eq + 1);
    }
  } else if (arg.startsWith("-")) {
    console.error(`Error: Unknown option '${arg}'`);
    process.exit(1);
  } else {
    if (inputFile) {
      console.error("Error: Multiple input files are not supported");
      process.exit(1);
    }
    inputFile = arg;
  }
}

if (!inputFile) {
  console.error("Error: No input file specified");
  process.exit(1);
}

const inputPath = resolve(inputFile);

let source: string;
try {
  source = readFileSync(inputPath, "utf-8");
} catch {
  console.error(`Error: Cannot read file '${inputFile}'`);
  process.exit(1);
}

if (!outputFile) {
  outputFile = basename(inputFile!).replace(/\.c$/, "") + ".wasm";
}

const options = Object.keys(defines).length > 0 ? { defines } : undefined;
const result = compile(source!, options);

if (!result.ok) {
  for (const error of result.errors) {
    console.error(`${inputFile}:${error.line}:${error.col}: ${error.stage} error: ${error.message}`);
  }
  process.exit(1);
}

writeFileSync(outputFile, result.wasm);
console.log(`Compiled ${inputFile} → ${outputFile} (${result.wasm.byteLength} bytes)`);
