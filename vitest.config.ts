// Unit tests (Vitest). Separate from vite.config.ts (the Studio build) so the
// test run does not load the Studio plugins. Tests live next to the code.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "agent/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**", ".agentphoto-tmp/**"],
    environment: "node",
  },
});
