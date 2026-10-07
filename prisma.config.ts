import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Migrations need a direct (unpooled) connection: they hold a session-level
  // advisory lock that transaction poolers don't support. The app itself uses
  // DATABASE_URL, which on serverless hosts should be the pooled endpoint.
  datasource: {
    url: process.env["DIRECT_DATABASE_URL"] || process.env["DATABASE_URL"],
  },
});
