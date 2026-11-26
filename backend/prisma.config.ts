import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // The Prisma CLI (migrate) uses a direct connection when one is given: Neon's "-pooler"
    // endpoint (PgBouncer) is fine for the app, but migrations should bypass the pooler.
    // The running app always uses DATABASE_URL (see PrismaService).
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});
