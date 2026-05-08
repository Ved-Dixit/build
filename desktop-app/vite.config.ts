import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/postcss'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // important for electron build
  css: {
    postcss: {
      plugins: [
        tailwindcss(),
      ],
    },
  },
})
