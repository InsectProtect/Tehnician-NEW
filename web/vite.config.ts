import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
  // имена функций не сокращаем: ошибка на телефоне будет понятной («dealLabel is not a function», а не «s is not a function»)
  esbuild: { minifyIdentifiers: false, keepNames: true },
  server: {
    // локальная разработка: API на :3000 (npm run dev в папке server)
    proxy: { '/api': 'http://localhost:3000', '/r': 'http://localhost:3000' },
  },
});
