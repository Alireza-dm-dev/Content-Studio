// Test bootstrap. Loaded with `node --import ./tests/setup.mjs`.
// Registers a module-resolution hook so that:
//   - `@/lib/<name>`  resolves to `<project>/lib/<name>.js`
//   - `next/server`   resolves to `<project>/node_modules/next/server.js`
//     (Next's package has no "exports" map, so plain Node would not resolve
//     the extensionless subpath on its own).
import { registerHooks } from "node:module";

const ROOT = new URL("../", import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/lib/")) {
      return {
        url: new URL(`lib/${specifier.slice(6)}.js`, ROOT).href,
        shortCircuit: true,
      };
    }
    if (specifier === "next/server") {
      return {
        url: new URL("node_modules/next/server.js", ROOT).href,
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});
