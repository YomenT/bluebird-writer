import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Fixed port so the Tauri shell knows where to find the dev server.
// 5175 keeps clear of the other suite apps (3000/3001/3002/5173/5174).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5175,
    strictPort: true,
    // The backend's CORS whitelist covers the packaged app's Tauri origins but
    // not :5175, so in dev the sync API is reached through this proxy instead
    // (src/lib/sync.js switches its base URL on import.meta.env.DEV).
    proxy: {
      '/bb-api': {
        target: 'https://bluebirddocumentationadmin.pythonanywhere.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bb-api/, ''),
      },
    },
  },
})
