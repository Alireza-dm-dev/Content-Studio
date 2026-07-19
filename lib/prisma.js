import { PrismaClient } from "./generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

// Prefer DATABASE_URL from the environment (set by Next.js from .env at
// runtime). This avoids fragile import.meta.url resolution in bundled code
// (Turbopack/webpack). Falls back to computing the path relative to this file
// for standalone scripts that don't load .env.
const dbUrl = process.env.DATABASE_URL ?? (() => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return "file:" + path.join(__dirname, "../dev.db");
})();

const globalForPrisma = globalThis;

function createPrismaClient() {
  const adapter = new PrismaBetterSqlite3({ url: dbUrl });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
