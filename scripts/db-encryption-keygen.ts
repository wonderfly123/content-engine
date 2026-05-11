/**
 * Print a fresh 32-byte hex key suitable for TOKEN_ENCRYPTION_KEY.
 *
 * Usage:
 *   tsx scripts/db-encryption-keygen.ts
 *
 * Copy the output and set it as an environment variable
 * (Vercel project settings, .env.local, etc.).
 */
import { randomBytes } from "node:crypto";

const key = randomBytes(32).toString("hex");
process.stdout.write(`${key}\n`);
