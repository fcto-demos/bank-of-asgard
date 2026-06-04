import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
      svgr(),
      react()
  ],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/onfido-sdk-ui')) return 'vendor-onfido';
          if (id.includes('node_modules/@mui/x-data-grid')) return 'vendor-mui-datagrid';
          if (id.includes('node_modules/@mui/icons-material')) return 'vendor-mui-icons';
          if (id.includes('node_modules/@mui') || id.includes('node_modules/@emotion')) return 'vendor-mui';
          if (id.includes('node_modules/@asgardeo')) return 'vendor-asgardeo';
        },
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: '0.0.0.0',  // listen on all interfaces — DO LB accesses via VM's IP
    allowedHosts: ['boa.apis.coach', 'localhost'],
  }
});
