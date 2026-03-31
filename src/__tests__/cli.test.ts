import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "../../dist/cli.js");
const TMP = tmpdir();

function run(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf-8",
      timeout: 10000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; status: number };
    return { stdout: e.stdout || "", stderr: e.stderr || "", exitCode: e.status ?? 1 };
  }
}

describe("CLI", () => {
  const testC = join(TMP, "gcc_js_test.c");
  const testWasm = join(TMP, "gcc_js_test.wasm");
  const testOut = join(TMP, "gcc_js_custom.wasm");

  beforeAll(() => {
    writeFileSync(testC, "int main() { return 42; }");
  });

  afterAll(() => {
    for (const f of [testC, testWasm, testOut]) {
      if (existsSync(f)) unlinkSync(f);
    }
  });

  it("shows help with --help", () => {
    const { stdout, exitCode } = run("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: gcc.js");
  });

  it("shows help with -h", () => {
    const { stdout, exitCode } = run("-h");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: gcc.js");
  });

  it("shows version with --version", () => {
    const { stdout, exitCode } = run("--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("compiles a C file to default .wasm output", () => {
    const { stdout, exitCode } = run(testC, "-o", testWasm);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Compiled");
    expect(existsSync(testWasm)).toBe(true);
    const wasm = readFileSync(testWasm);
    // WASM magic number
    expect(wasm[0]).toBe(0x00);
    expect(wasm[1]).toBe(0x61);
    expect(wasm[2]).toBe(0x73);
    expect(wasm[3]).toBe(0x6d);
  });

  it("compiles with custom output via -o", () => {
    const { stdout, exitCode } = run(testC, "-o", testOut);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(testOut);
    expect(existsSync(testOut)).toBe(true);
  });

  it("compiles with -D macro", () => {
    const macroC = join(TMP, "gcc_js_macro.c");
    const macroWasm = join(TMP, "gcc_js_macro.wasm");
    writeFileSync(macroC, `
      #ifdef DEBUG
      int main() { return 1; }
      #else
      int main() { return 0; }
      #endif
    `);
    const { exitCode } = run(macroC, "-DDEBUG", "-o", macroWasm);
    expect(exitCode).toBe(0);
    expect(existsSync(macroWasm)).toBe(true);
    unlinkSync(macroC);
    unlinkSync(macroWasm);
  });

  it("errors on missing input file", () => {
    const { stderr, exitCode } = run("nonexistent.c");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Cannot read file");
  });

  it("errors on no arguments", () => {
    const { stdout, exitCode } = run();
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: gcc.js");
  });

  it("errors on unknown option", () => {
    const { stderr, exitCode } = run("--unknown");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown option");
  });

  it("errors on invalid C code", () => {
    const badC = join(TMP, "gcc_js_bad.c");
    writeFileSync(badC, "int main( { }");
    const { stderr, exitCode } = run(badC, "-o", join(TMP, "gcc_js_bad.wasm"));
    expect(exitCode).toBe(1);
    expect(stderr).toContain("error");
    unlinkSync(badC);
  });
});
