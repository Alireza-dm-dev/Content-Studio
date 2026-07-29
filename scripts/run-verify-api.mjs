#!/usr/bin/env node
// Wrapper that registers hooks for server-only mock and @/lib path alias
// before loading the API verifier.
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const libDir = path.resolve(__dirname, "../lib");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        url: new URL("./empty-module.mjs", import.meta.url).href,
        shortCircuit: true,
      };
    }
    if (specifier.startsWith("@/lib/")) {
      const resolved = path.join(libDir, specifier.slice(6)) + ".js";
      return {
        url: pathToFileURL(resolved).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
await import("./verify-brand-chat-api.js");
