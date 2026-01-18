/// <reference types="vitest" />
import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
    base: './',
    plugins: [
        react(),
        electron({
            main: {
                entry: 'electron/main.ts',
                vite: {
                    build: {
                        rollupOptions: {
                            external: ['electron', 'socket.io', 'express', 'multicast-dns', 'axios', 'selfsigned']
                        }
                    }
                }
            },
            preload: {
                input: path.join(__dirname, 'electron/preload.ts'),
            },
            // PWA support or other things can be added here
            renderer: process.env.NODE_ENV === 'test'
                ? undefined
                : {},
        }),
    ],
    test: {
        environment: 'node',
        globals: true,
        exclude: ['e2e/**', 'node_modules/**']
    }
})
