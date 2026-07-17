import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs"],
  platform: "node",
  target: "node18",
  minify: false,
  clean: true,
  banner: { js: "#!/usr/bin/env node" },
});
