import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, forward API calls to r-present-admin-backend.
    // In production, nginx does this.
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
