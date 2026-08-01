#!/usr/bin/env node
// Wrapper that registers the server-only mock before loading the verifier.
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        url: new URL("./empty-module.mjs", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
await import("./verify-brand-chat-context.js");
