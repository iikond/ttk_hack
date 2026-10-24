import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

let ssl = []
try { ssl = [(await import('@vitejs/plugin-basic-ssl')).default()] } catch {}

export default defineConfig({
  plugins: [react(), ...ssl],
  server: {
    host: true,
    watch: { ignored: ['**/data/**'] },
    proxy: {
      '/api': {
        target: 'http://192.168.1.111:5173', // Укажи актуальный адрес и порт твоего бэкенда
        changeOrigin: true,
        secure: false,
      },
    },
  },
})