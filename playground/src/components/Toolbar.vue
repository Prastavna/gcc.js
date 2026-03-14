<script setup lang="ts">
defineProps<{
  compiling: boolean
}>()

const emit = defineEmits<{
  compile: []
  example: [code: string]
}>()

const examples: { label: string; code: string }[] = [
  {
    label: 'Return 42',
    code: `int main() {\n    return 42;\n}`,
  },
  {
    label: 'Return 0',
    code: `int main() {\n    return 0;\n}`,
  },
  {
    label: 'Two functions',
    code: `int get_answer() {\n    return 42;\n}\n\nint get_zero() {\n    return 0;\n}`,
  },
  {
    label: 'Large number',
    code: `int main() {\n    return 100000;\n}`,
  },
  {
    label: 'Arithmetic',
    code: `int main() {\n    return 2 + 3 * 4;\n}`,
  },
  {
    label: 'Precedence',
    code: `int main() {\n    return (2 + 3) * 4;\n}`,
  },
  {
    label: 'Unary minus',
    code: `int main() {\n    return -(-10) + 5;\n}`,
  },
  {
    label: 'Variables',
    code: `int main() {\n    int x = 10;\n    int y = 20;\n    return x + y;\n}`,
  },
  {
    label: 'Reassignment',
    code: `int main() {\n    int x = 1;\n    x = x + 1;\n    x = x * 3;\n    return x;\n}`,
  },
]

const showDropdown = ref(false)

function selectExample(code: string) {
  emit('example', code)
  showDropdown.value = false
}

import { ref } from 'vue'
</script>

<template>
  <div class="flex items-center justify-between border-b border-[var(--color-border)] bg-zinc-900 px-4 py-2">
    <!-- Left: title -->
    <div class="flex items-center gap-3">
      <h1 class="text-sm font-bold tracking-tight text-zinc-100">gcc.js</h1>
      <span class="text-xs text-zinc-600">playground</span>
    </div>

    <!-- Right: actions -->
    <div class="flex items-center gap-2">
      <!-- Examples dropdown -->
      <div class="relative">
        <button
          class="rounded border border-[var(--color-border)] bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors cursor-pointer"
          @click="showDropdown = !showDropdown"
        >
          Examples
        </button>
        <div
          v-if="showDropdown"
          class="absolute right-0 top-full z-10 mt-1 min-w-[160px] rounded border border-[var(--color-border)] bg-zinc-800 py-1 shadow-xl"
        >
          <button
            v-for="ex in examples"
            :key="ex.label"
            class="block w-full px-3 py-1.5 text-left text-xs text-zinc-300 hover:bg-zinc-700 cursor-pointer"
            @click="selectExample(ex.code)"
          >
            {{ ex.label }}
          </button>
        </div>
      </div>

      <!-- Compile button -->
      <button
        :disabled="compiling"
        class="rounded bg-[var(--color-accent)] px-4 py-1.5 text-xs font-medium text-zinc-950 hover:bg-[var(--color-accent-hover)] disabled:opacity-50 transition-colors cursor-pointer"
        @click="emit('compile')"
      >
        {{ compiling ? 'Compiling...' : 'Compile' }}
        <kbd class="ml-1.5 text-[10px] opacity-60">Ctrl+Enter</kbd>
      </button>
    </div>
  </div>
</template>
