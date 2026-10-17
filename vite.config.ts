import { defineConfig } from "vite";
import { wasp } from "wasp/client/vite";

// GitHub Codespaces support
// -------------------------
// In a codespace the browser can only reach forwarded ports through
// https://<codespace>-<port>.app.github.dev URLs, so the default
// API URL (http://localhost:3001) doesn't work. Instead the client calls
// <codespace>-3000.../server and Vite proxies that to the Wasp server on 3001.
// Everything goes through one port, which can stay private.
// Outside Codespaces (CODESPACES unset) none of this applies.
const codespace = process.env.CODESPACES ? process.env.CODESPACE_NAME : undefined;

if (codespace) {
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev";
  // Vite reads REACT_APP_* from process.env after this file is loaded.
  process.env.REACT_APP_API_URL = `https://${codespace}-3000.${domain}/server`;
}

export default defineConfig({
  plugins: [wasp()],
  server: codespace
    ? {
        // Listen on IPv6 + IPv4: the Codespaces port forwarder connects to
        // localhost over IPv6 (::1) and returns 502 if only 0.0.0.0 is bound.
        host: "::",
        allowedHosts: true,
        proxy: {
          "/server": {
            target: "http://localhost:3001",
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/server/, ""),
            // Same-origin from the browser's point of view, so drop Origin
            // and the server's CORS check doesn't need the codespace URL.
            configure: (proxy) => {
              proxy.on("proxyReq", (req) => req.removeHeader("origin"));
            },
          },
        },
      }
    : undefined,
});
