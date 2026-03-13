<script setup lang="ts">
export interface OutputEntry {
  type: 'info' | 'success' | 'error' | 'warn'
  text: string
  timestamp?: number
}

defineProps<{
  entries: OutputEntry[]
  compiling: boolean
}>()

const emit = defineEmits<{
  clear: []
}>()

function colorClass(type: OutputEntry['type']): string {
  switch (type) {
    case 'success': return 'text-green-400'
    case 'error': return 'text-red-400'
    case 'warn': return 'text-yellow-400'
    default: return 'text-zinc-400'
  }
}

function prefix(type: OutputEntry['type']): string {
  switch (type) {
    case 'success': return '>'
    case 'error': return '!'
    case 'warn': return '~'
    default: return '#'
  }
}
</script>

<template>
  <div class="flex h-full flex-col font-mono text-sm">
    <!-- Output header -->
    <div class="flex items-center justify-between border-b border-[var(--color-border)] bg-zinc-900/50 px-4 py-2">
      <span class="text-xs font-medium uppercase tracking-wider text-zinc-500">Output</span>
      <div class="flex items-center gap-2">
        <span v-if="compiling" class="text-xs text-yellow-400 animate-pulse">compiling...</span>
        <button
          class="text-xs text-zinc-600 hover:text-zinc-400 transition-colors cursor-pointer"
          @click="emit('clear')"
        >
          clear
        </button>
      </div>
    </div>

    <!-- Output body -->
    <div class="flex-1 overflow-auto bg-[var(--color-editor)] p-4">
      <div v-if="entries.length === 0" class="text-zinc-600 italic">
        Press Compile or Ctrl+Enter to run...
      </div>
      <div v-for="(entry, i) in entries" :key="i" class="leading-relaxed">
        <span class="text-zinc-600 select-none">{{ prefix(entry.type) }} </span>
        <span :class="colorClass(entry.type)" class="whitespace-pre-wrap">{{ entry.text }}</span>
      </div>
    </div>
  </div>
</template>
