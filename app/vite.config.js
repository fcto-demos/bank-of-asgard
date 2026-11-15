import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

// The /tokenflow page is the standalone animation in animations/token-flow.html (one copy,
// shared with the presentation server). It is served as-is, outside the React app, with
// the app's favicon and config.js added, so it reads the token audit trail from API_SERVICE_URL.
const TOKEN_FLOW_SOURCE = fileURLToPath(new URL("../animations/token-flow.html", import.meta.url));
const TOKEN_FLOW_FILE = "tokenflow.html";

const tokenFlowHtml = () =>
  fs.readFileSync(TOKEN_FLOW_SOURCE, "utf-8")
    .replace("</head>", '<link rel="icon" type="image/svg+xml" href="/favicon.svg">\n<script src="/config.js"></script>\n</head>');

/** @param {() => string} readPage */
const serveTokenFlow = (readPage) => (/** @type {import("vite").ViteDevServer | import("vite").PreviewServer} */ server) => {
  server.middlewares.use((req, res, next) => {
    const route = (req.url || "").split("?")[0];
    if (route !== "/tokenflow" && route !== "/tokenflow/") {
      return next();
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(readPage());
  });
};

/** @returns {import("vite").Plugin} */
const tokenFlowPage = () => {
  let outDir = "dist";
  return {
    name: "boa-token-flow-page",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    // Dev reads the source on every request, so edits show up on reload.
    configureServer: serveTokenFlow(tokenFlowHtml),
    // Preview (demo + prod) serves the copy built into dist/, like the rest of the app.
    configurePreviewServer: serveTokenFlow(() => fs.readFileSync(path.join(outDir, TOKEN_FLOW_FILE), "utf-8")),
    generateBundle() {
      this.emitFile({ type: "asset", fileName: TOKEN_FLOW_FILE, source: tokenFlowHtml() });
    },
  };
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [
      svgr(),
      react(),
      tokenFlowPage()
  ],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) return 'vendor-react';
          if (id.includes('node_modules/onfido-sdk-ui')) return 'vendor-onfido';
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
