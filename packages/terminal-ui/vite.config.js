import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        // Proxy /api requests to the Express server so the browser never
        // needs to know the Gemini API key.
        proxy: {
            '/api': 'http://localhost:3001',
        },
    },
});
