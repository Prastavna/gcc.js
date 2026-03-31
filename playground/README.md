# @prastavna/gcc.js Playground

Interactive browser-based playground for the @prastavna/gcc.js C-to-WebAssembly compiler.

Write C code on the left, hit Compile, see WASM output on the right.

## Quick start

```bash
cd playground
bun install
bun run dev
```

Opens at `http://localhost:5173`.

## How it works

1. You write C code in the editor panel
2. Click **Compile** (or press **Ctrl+Enter**)
3. The playground calls `compile()` from `@prastavna/gcc.js` (imported via Vite alias from `../src/gcc`)
4. The resulting WASM binary is instantiated via `WebAssembly.compile()` + `WebAssembly.instantiate()`
5. All exported functions are called and their return values are displayed in the output panel

Everything runs client-side. No server involved.

## Layout

```
┌─────────────────────────────────────────────────┐
│  Toolbar: [@prastavna/gcc.js playground]  [Examples] [Compile] │
├────────────────────┬────────────────────────────┤
│                    │                            │
│   Code Editor      │   Output Panel             │
│   (main.c)         │   (compile logs, results)  │
│                    │                            │
├────────────────────┴────────────────────────────┤
│  Status bar: version, line count                │
└─────────────────────────────────────────────────┘
```

## Components

| File | Purpose |
|------|---------|
| `src/App.vue` | Root layout, compile logic, keyboard shortcut |
| `src/components/CodeEditor.vue` | Textarea with synced line number gutter |
| `src/components/OutputPanel.vue` | Colored log output (info/success/error/warn) |
| `src/components/Toolbar.vue` | Title, examples dropdown, compile button |

## Preloaded examples

- **Return 42** — `int main() { return 42; }`
- **Return 0** — `int main() { return 0; }`
- **Two functions** — two exported functions with different return values
- **Large number** — `int main() { return 100000; }`

## Tech stack

- Vue 3 (Composition API, `<script setup>`)
- Tailwind CSS v4
- Vite
- TypeScript

## Vite config

The `@prastavna/gcc.js` alias in `vite.config.ts` points to `../src/gcc`, so the playground always uses the local compiler source directly. No build step or npm link needed.

```ts
resolve: {
  alias: {
    '@prastavna/gcc.js': resolve(__dirname, '../src/gcc'),
  },
},
```
