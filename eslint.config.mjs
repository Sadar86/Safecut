import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored FFmpeg.wasm bundles copied by scripts/setup-ffmpeg.mjs
    "public/ffmpeg/**",
    // MediaPipe runtime + face model copied by scripts/setup-models.mjs
    "public/models/**",
  ]),
]);

export default eslintConfig;
