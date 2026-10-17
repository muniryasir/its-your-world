import { defineConfig } from "vite";
import { wasp } from "wasp/client/vite";

// In GitHub Codespaces the browser can only reach forwarded ports through
// *.app.github.dev URLs. To keep everything on one port (3000), API calls go
// to <codespace-url>/server and Vite proxies them to the Wasp server on 3001.
// Locally (no CODESPACES env var) nothing changes.
const inCodespaces = Boolean(process.env.CODESPACES);

export default defineConfig({
  plugins: [wasp()],
  server: inCodespaces
    ? {
        allowedHosts: true,
        proxy: {
          "/server": {
            target: "http://localhost:3001",
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/server/, ""),
          },
        },
      }
    : undefined,
});
