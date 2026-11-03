import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Hash routing (see src/App.tsx), so base can stay relative and the build
// works from any folder — a GitHub Pages project site included.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: Number(process.env.PORT) || 5180,
    host: true, // reachable from a phone on the LAN; Vite prints the IP
  },
});
