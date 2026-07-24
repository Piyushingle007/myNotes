import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: './',
  define: {
    // Feature flags — set to false to exclude from production bundle (tree-shaking)
    '__FEATURE_CANVAS__': JSON.stringify(false),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/scratch/**', '**/src-tauri/**']
    }
  },
  optimizeDeps: {
    entries: ['index.html'],
    exclude: ['scratch']
  }
})
