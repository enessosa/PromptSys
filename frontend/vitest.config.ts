import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Primer ships CSS imports inside its JS; let Vite process them instead of Node.
    server: { deps: { inline: [/@primer\/react/, /@xyflow\/react/] } },
  },
})
