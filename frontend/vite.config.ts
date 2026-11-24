import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // All backend routes live under /api; forwarding them avoids CORS in development.
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
