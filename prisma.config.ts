import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Used by the Prisma CLI (migrations). Poolers such as PgBouncer or Neon's
  // "-pooler" host can break migrations, so DIRECT_URL, when set, lets them
  // use a direct connection. The app itself always connects via DATABASE_URL.
  datasource: {
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
  },
});
