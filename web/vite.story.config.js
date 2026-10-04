import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
// Separate preview build. This does not alter the production application's entry.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: '../.preview-qa/dist',
    emptyOutDir: false,
    rollupOptions: { input: fileURLToPath(new URL('./prototypes/deposit-story.html', import.meta.url)) },
  },
})
