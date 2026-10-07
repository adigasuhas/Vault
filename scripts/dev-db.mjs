// Zero-config local Postgres for development.
//
// Downloads (once) and runs a real, self-contained PostgreSQL binary via
// `pg_ctl start` (no system install, no root, and properly daemonized so it
// survives after this script exits) so `npm run dev` works immediately on a
// fresh clone. This is a development convenience only — in production
// (Vercel), set DATABASE_URL to a managed Postgres instance (Vercel Postgres,
// Neon, Supabase, etc.) and this script is never invoked.
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", ".vault-data", "pgdata");
const logFile = path.join(__dirname, "..", ".vault-data", "postgres.log");
const port = Number(process.env.VAULT_DEV_DB_PORT || 5432);
const user = "vault";
const password = "vault";
const database = "vault_db";

function isPortOpen(checkPort) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port: checkPort, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForConnection(retries = 20) {
  for (let i = 0; i < retries; i++) {
    if (await isPortOpen(port)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Postgres did not become reachable on port ${port} in time`);
}

async function getPgCtlPath() {
  const platform = os.platform();
  const arch = os.arch();
  const pkgMap = {
    "linux-x64": "@embedded-postgres/linux-x64",
    "linux-arm64": "@embedded-postgres/linux-arm64",
    "darwin-x64": "@embedded-postgres/darwin-x64",
    "darwin-arm64": "@embedded-postgres/darwin-arm64",
    "win32-x64": "@embedded-postgres/windows-x64",
  };
  const pkg = pkgMap[`${platform}-${arch}`];
  if (!pkg) throw new Error(`Unsupported platform "${platform}-${arch}" for embedded Postgres`);
  const mod = await import(pkg);
  return mod.pg_ctl;
}

async function main() {
  if (await isPortOpen(port)) {
    console.log(`[dev-db] Something is already listening on port ${port} — assuming Postgres is up, skipping embedded start.`);
    return;
  }

  const isFirstRun = !fs.existsSync(dataDir);

  if (isFirstRun) {
    console.log("[dev-db] Initializing local Postgres data directory (first run)...");
    const pg = new EmbeddedPostgres({ databaseDir: dataDir, user, password, port, persistent: true });
    await pg.initialise();
  }

  const pgCtl = await getPgCtlPath();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  // `pg_ctl start` double-forks and detaches on its own — unlike
  // EmbeddedPostgres.start() (which ties the server's lifetime to this
  // process), this survives after this script exits.
  execFileSync(pgCtl, ["-D", dataDir, "-o", `-p ${port}`, "-l", logFile, "start"], {
    stdio: "inherit",
  });

  if (isFirstRun) {
    await waitForConnection();
    const client = new pg.Client({ host: "127.0.0.1", port, user, password, database: "postgres" });
    await client.connect();
    await client.query(`CREATE DATABASE ${client.escapeIdentifier(database)}`);
    await client.end();
    console.log(`[dev-db] Created database "${database}".`);
  }

  console.log(`[dev-db] Local Postgres running on port ${port}.`);
}

main().catch((err) => {
  console.error("[dev-db] Failed to start local Postgres:", err);
  process.exit(1);
});
