import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
      svgr(),
      react()
  ],
  preview: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',  // listen on all interfaces — DO LB accesses via VM's IP
    allowedHosts: ['boa.apis.coach', 'localhost'],
  }
});
