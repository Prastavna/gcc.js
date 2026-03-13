import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), vue()],
  resolve: {
    alias: {
      'gcc.js': resolve(__dirname, '../src/gcc'),
    },
  },
  server: {
    fs: {
      // Allow serving files from the parent src/gcc directory
      allow: ['..'],
    },
  },
})
