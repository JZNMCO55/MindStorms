import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Configured to be Tauri-ready: fixed port, no screen clearing, TAURI_ env passthrough.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
});
