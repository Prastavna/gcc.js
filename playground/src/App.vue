<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import CodeEditor from './components/CodeEditor.vue'
import OutputPanel from './components/OutputPanel.vue'
import type { OutputEntry } from './components/OutputPanel.vue'
import Toolbar from './components/Toolbar.vue'
import { compile } from 'gcc.js'

const DEFAULT_CODE = `int printf(int ptr);\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}`

const code = ref(DEFAULT_CODE)
const output = ref<OutputEntry[]>([])
const compiling = ref(false)
const lastWasm = ref<Uint8Array | null>(null)

function log(type: OutputEntry['type'], text: string) {
  output.value.push({ type, text, timestamp: Date.now() })
}

function clearOutput() {
  output.value = []
}

async function runCompile() {
  if (compiling.value) return
  compiling.value = true
  lastWasm.value = null
  clearOutput()

  log('info', `Compiling ${code.value.split('\n').length} lines of C...`)

  try {
    const t0 = performance.now()
    const result = compile(code.value)
    const elapsed = (performance.now() - t0).toFixed(2)

    if (!result.ok) {
      for (const err of result.errors) {
        log('error', `[${err.stage}] line ${err.line}:${err.col} - ${err.message}`)
      }
      log('error', `Compilation failed (${elapsed}ms)`)
      return
    }

    lastWasm.value = result.wasm
    log('success', `Compiled successfully (${elapsed}ms, ${result.wasm.byteLength} bytes)`)

    // Instantiate with printf bridge
    const module = await WebAssembly.compile(result.wasm.buffer as ArrayBuffer)
    let instance: WebAssembly.Instance
    try {
      instance = await WebAssembly.instantiate(module, {
        env: {
          printf: (ptr: number) => {
            const mem = new Uint8Array((instance.exports.memory as WebAssembly.Memory).buffer)
            let str = ''
            let i = ptr
            while (mem[i] !== 0 && i < mem.length) {
              str += String.fromCharCode(mem[i])
              i++
            }
            log('info', `printf: ${str}`)
            return str.length
          },
        },
      })
    } catch {
      // If import fails (no imports needed), try without
      instance = await WebAssembly.instantiate(module)
    }

    // Log all exports
    const exportNames = Object.keys(instance.exports)
    log('info', `Exports: ${exportNames.join(', ')}`)

    // Try calling each exported function
    for (const name of exportNames) {
      const fn = instance.exports[name]
      if (typeof fn === 'function') {
        try {
          const ret = (fn as () => number)()
          log('success', `${name}() = ${ret}`)
        } catch (e) {
          log('error', `${name}() threw: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    }
  } catch (e) {
    log('error', `Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    compiling.value = false
  }
}

function downloadWasm() {
  if (!lastWasm.value) return
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  const blob = new Blob([lastWasm.value.buffer as ArrayBuffer], { type: 'application/wasm' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `main-${ts}.wasm`
  a.click()
  URL.revokeObjectURL(a.href)
}

function onExample(exampleCode: string) {
  code.value = exampleCode
}

function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    runCompile()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="flex h-screen flex-col">
    <!-- Top toolbar -->
    <Toolbar :compiling="compiling" :downloadable="lastWasm !== null" @compile="runCompile" @example="onExample" @download="downloadWasm" />

    <!-- Main split pane -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Left: code editor -->
      <div class="flex w-1/2 flex-col border-r border-[var(--color-border)]">
        <div class="flex items-center border-b border-[var(--color-border)] bg-zinc-900/50 px-4 py-2">
          <span class="text-xs font-medium uppercase tracking-wider text-zinc-500">main.c</span>
        </div>
        <div class="flex-1 overflow-hidden">
          <CodeEditor v-model="code" />
        </div>
      </div>

      <!-- Right: output -->
      <div class="flex w-1/2 flex-col">
        <OutputPanel :entries="output" :compiling="compiling" @clear="clearOutput" />
      </div>
    </div>

    <!-- Bottom status bar -->
    <div class="flex items-center justify-between border-t border-[var(--color-border)] bg-zinc-900 px-4 py-1">
      <span class="text-[10px] text-zinc-600">gcc.js v0.0.0 | Milestone 26</span>
      <span class="text-[10px] text-zinc-600">{{ code.split('\n').length }} lines</span>
    </div>
  </div>
</template>
