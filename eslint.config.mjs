import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      // The end-to-end suite builds here so it never clobbers a running dev
      // server; it is generated output and must not be linted.
      ".next-e2e/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // Test harnesses assert against untyped input by design: HTTP responses from
    // our own API and raw ABI JSON entries. Declaring interfaces for those would
    // mean the test trusts a hand-written type instead of checking the real
    // payload, which is the opposite of what these scripts are for. Application
    // code keeps the rule.
    files: ["scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
