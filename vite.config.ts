import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:3001',
    changeOrigin: false,
  },
}

export default defineConfig({
  plugins: [react()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
})
