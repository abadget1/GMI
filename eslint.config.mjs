import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "backend/.venv/**",
    "backend/**/__pycache__/**",
    // Unmodified legacy shell variants retained from the starter template.
    // The GMI route uses its own shell in (DashboardLayout)/page.tsx.
    "src/app/(DashboardLayout)/layout/**",
    "next-env.d.ts",
  ]),
]);
