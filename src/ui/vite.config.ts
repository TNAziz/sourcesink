import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import { assistantVitePlugin } from "@sourcesink/assistant/node";

export default defineConfig({
  plugins: [react(), assistantVitePlugin()],
  server: {
    port: 5173,
  },
});