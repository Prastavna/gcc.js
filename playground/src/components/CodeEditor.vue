<script setup lang="ts">
const model = defineModel<string>({ required: true })

const lines = computed(() => {
  const count = (model.value?.split('\n') || ['']).length
  return Array.from({ length: count }, (_, i) => i + 1)
})

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const scrollTop = ref(0)

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLTextAreaElement).scrollTop
}

import { computed, ref } from 'vue'
</script>

<template>
  <div class="relative flex h-full overflow-hidden font-mono text-sm">
    <!-- Line numbers gutter -->
    <div
      class="flex-shrink-0 select-none bg-[var(--color-gutter)] border-r border-[var(--color-border)] text-zinc-600 text-right py-3 px-2 leading-[1.6] overflow-hidden"
      :style="{ transform: `translateY(-${scrollTop}px)` }"
    >
      <div v-for="n in lines" :key="n" class="h-[1.6em]">{{ n }}</div>
    </div>

    <!-- Textarea -->
    <textarea
      ref="textareaRef"
      v-model="model"
      spellcheck="false"
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      class="flex-1 bg-[var(--color-editor)] text-zinc-100 py-3 px-4 leading-[1.6] resize-none outline-none overflow-auto"
      @scroll="onScroll"
    />
  </div>
</template>
