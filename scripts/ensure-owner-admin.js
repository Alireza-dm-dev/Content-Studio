import { PrismaClient } from "../lib/generated/prisma/client.ts";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl =
  process.env.DATABASE_URL ??
  "file:" + path.join(__dirname, "../dev.db");

const adapter = new PrismaBetterSqlite3({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(raw) {
  if (!raw || typeof raw !== "string") return false;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return false;
  if (!EMAIL_REGEX.test(trimmed)) return false;
  const atIndex = trimmed.indexOf("@");
  if (atIndex === -1) return false;
  const domain = trimmed.slice(atIndex + 1);
  if (!domain.includes(".")) return false;
  return true;
}

async function main() {
  const emailRaw = process.env.OWNER_ADMIN_EMAIL;
  const passwordRaw = process.env.OWNER_ADMIN_PASSWORD;
  const nameRaw = process.env.OWNER_ADMIN_NAME;

  // Validate email
  if (!emailRaw) {
    console.error("OWNER_ADMIN_EMAIL is required.");
    process.exit(1);
  }
  const email = emailRaw.trim().toLowerCase();
  if (!validateEmail(emailRaw)) {
    console.error("Invalid OWNER_ADMIN_EMAIL format: " + email);
    process.exit(1);
  }

  // Validate password
  if (!passwordRaw) {
    console.error("OWNER_ADMIN_PASSWORD is required.");
    process.exit(1);
  }
  const password = passwordRaw.trim();
  if (!password) {
    console.error("OWNER_ADMIN_PASSWORD is required.");
    process.exit(1);
  }

  const name = (nameRaw && nameRaw.trim()) || "Content Studio Owner";

  // Look up existing user
  let existing;
  try {
    existing = await prisma.user.findUnique({ where: { email } });
  } catch (err) {
    console.error("Database connection failed: " + err.message);
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!existing) {
    // Create new owner admin
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      await prisma.user.create({
        data: {
          email,
          name,
          role: "admin",
          isActive: true,
          passwordHash,
        },
      });
      console.log("Owner admin created. (" + email + ")");
    } catch (err) {
      console.error("Failed to create owner admin: " + err.message);
      await prisma.$disconnect();
      process.exit(1);
    }
  } else {
    // Update existing user
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      const passwordMatch = await bcrypt.compare(
        password,
        existing.passwordHash
      );

      const updateData = {};
      let needsUpdate = false;

      if (existing.role !== "admin") {
        updateData.role = "admin";
        needsUpdate = true;
      }
      if (!existing.isActive) {
        updateData.isActive = true;
        needsUpdate = true;
      }
      if (!passwordMatch) {
        updateData.passwordHash = passwordHash;
        needsUpdate = true;
      }

      if (needsUpdate) {
        await prisma.user.update({
          where: { id: existing.id },
          data: updateData,
        });
      }

      const wasFullAdmin =
        existing.role === "admin" && existing.isActive;

      if (wasFullAdmin && passwordMatch) {
        console.log("Owner admin already configured. (" + email + ")");
      } else {
        const parts = [];
        if (!wasFullAdmin) {
          parts.push("Existing user promoted to owner admin");
        }
        if (!passwordMatch) {
          parts.push("Owner admin password updated");
        }
        console.log(parts.join(". ") + ". (" + email + ")");
      }
    } catch (err) {
      console.error("Failed to update owner admin: " + err.message);
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Unexpected error: " + err.message);
  process.exit(1);
});
