import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

let ssl = []
try { ssl = [(await import('@vitejs/plugin-basic-ssl')).default()] } catch {}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_TARGET || env.VITE_API_URL || 'http://127.0.0.1:3000'

  return {
    plugins: [react(), ...ssl],
    server: {
      host: true,
      watch: { ignored: ['**/data/**'] },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: apiTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})