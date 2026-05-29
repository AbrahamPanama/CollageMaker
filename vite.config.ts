import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri-aware Vite config: strict port, no env-var probes that clash with Cargo,
// and explicit chunk splitting so the initial bundle stays small.
const host = process.env.TAURI_DEV_HOST;

const manualChunkPackages: Record<string, string[]> = {
  react: ['react', 'react-dom'],
  konva: ['konva', 'react-konva', 'use-image'],
  mediapipe: ['@mediapipe/tasks-vision'],
  faceapi: ['face-api.js'],
  smartcrop: ['smartcrop'],
};

function manualChunks(id: string) {
  if (!id.includes('node_modules')) return undefined;
  for (const [chunkName, packages] of Object.entries(manualChunkPackages)) {
    for (const pkg of packages) {
      if (id.includes(`/node_modules/${pkg}/`)) return chunkName;
    }
  }
  return undefined;
}

export default defineConfig(() => ({
  base: './',
  plugins: react(),
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 5174 }
      : undefined,
    watch: {
      // Avoid HMR loops when Tauri rebuilds the Rust side.
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
}));
