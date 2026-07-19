import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = "file:" + path.join(__dirname, "../dev.db");
const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, name: true } });
  console.log("Users:", JSON.stringify(users, null, 2));

  const sessions = await prisma.session.findMany({ select: { id: true, userId: true, expiresAt: true } });
  console.log("Sessions:", JSON.stringify(sessions, null, 2));

  await prisma.$disconnect();
}

main().catch(console.error);
