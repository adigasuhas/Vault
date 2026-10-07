#!/usr/bin/env node
// VAULT setup: configures the app for local development or a deployment target.
//
//   npm run setup                        interactive
//   npm run setup -- --target vercel     skip the menu
//   npm run setup -- --target local --yes  accept defaults, no prompts
//   npm run check-env [-- --env-file .env.production]  validate a config
//
// Targets: local, docker, vercel, netlify, render, railway, fly, vps, github.
// Uses only Node built-ins so it runs before `npm install`. It never commits,
// pushes or deploys on its own; anything that talks to a platform CLI asks first.

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";
const args = parseArgs(process.argv.slice(2));
const interactive = process.stdin.isTTY && !args.yes;

// ---------- output helpers ----------
const tty = process.stdout.isTTY;
const c = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = c(1), dim = c(2), green = c(32), yellow = c(33), red = c(31), cyan = c(36);
const say = (s = "") => console.log(s);
const step = (s) => say(`\n${bold(cyan("▸ " + s))}`);
const ok = (s) => say(`  ${green("✓")} ${s}`);
const warn = (s) => say(`  ${yellow("!")} ${s}`);
const fail = (s) => say(`  ${red("✗")} ${s}`);
const cmd = (s) => say(`    ${dim("$")} ${s}`);

// ---------- prompts ----------
let rl;
function prompter() {
  rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}
async function ask(question, def = "") {
  if (!interactive) return def;
  const a = (await prompter().question(`  ${question}${def ? dim(` [${def}]`) : ""}: `)).trim();
  return a || def;
}
async function confirm(question, def = true) {
  if (!interactive) return def;
  const a = (await prompter().question(`  ${question} ${dim(def ? "[Y/n]" : "[y/N]")}: `)).trim().toLowerCase();
  return a ? a.startsWith("y") : def;
}
async function choose(question, options) {
  if (!interactive) return options[0].value;
  say(`\n${bold(question)}`);
  options.forEach((o, i) => say(`  ${cyan(String(i + 1).padStart(2))}. ${o.label}${o.hint ? dim("  " + o.hint) : ""}`));
  for (;;) {
    const a = (await prompter().question(`  Choose 1-${options.length}: `)).trim();
    const byIndex = options[Number(a) - 1];
    const byValue = options.find((o) => o.value === a.toLowerCase());
    if (byIndex || byValue) return (byIndex ?? byValue).value;
  }
}

// ---------- env files ----------
function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

/** Writes KEY="value" lines, updating keys in place and appending new ones, so
 * comments and unrelated keys in an existing file survive. */
function writeEnv(file, values, header) {
  const quote = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : header ? header.split("\n") : [];
  const seen = new Set();
  const updated = lines.map((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (m && m[1] in values) {
      seen.add(m[1]);
      return `${m[1]}=${quote(values[m[1]])}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) updated.push(`${k}=${quote(v)}`);
  while (updated.length && updated[updated.length - 1] === "") updated.pop();
  fs.writeFileSync(file, updated.join("\n") + "\n", { mode: 0o600 });
}

const secret = {
  jwt: () => randomBytes(48).toString("base64"),
  hex: (n = 32) => randomBytes(n).toString("hex"),
  password: () => randomBytes(18).toString("base64url"),
};
const mask = (v) => (!v ? dim("(empty)") : v.length <= 8 ? "••••" : `${v.slice(0, 4)}…${v.slice(-2)} ${dim(`(${v.length} chars)`)}`);

// ---------- shell ----------
function has(bin) {
  const r = spawnSync(IS_WIN ? "where" : "which", [bin], { stdio: "ignore" });
  return r.status === 0;
}
function run(bin, argv, opts = {}) {
  cmd([bin, ...argv].join(" "));
  const r = spawnSync(bin, argv, { cwd: ROOT, stdio: opts.input !== undefined ? ["pipe", "inherit", "inherit"] : "inherit", input: opts.input, env: { ...process.env, ...opts.env }, shell: IS_WIN });
  return r.status === 0;
}

// ---------- validation (also `--check`) ----------
const TRUST_VALUES = ["none", "vercel", "netlify", "cloudflare", "1", "2", "3"];

function validate(env, { production }) {
  const problems = [];
  const notes = [];
  const db = env.DATABASE_URL ?? "";
  if (!db) problems.push("DATABASE_URL is empty.");
  else if (db.startsWith("${{")) notes.push("DATABASE_URL is a platform reference; it resolves on the host.");
  else if (!/^postgres(ql)?:\/\//.test(db)) problems.push("DATABASE_URL must start with postgresql://");
  else if (production && /@(127\.0\.0\.1|localhost)[:/]/.test(db) && !env.__docker) notes.push("DATABASE_URL points at localhost. Fine on a VPS with local Postgres; wrong on a hosted platform.");
  if (production && db && !db.startsWith("${{") && !/sslmode=|@db:|@(127\.0\.0\.1|localhost)[:/]/.test(db)) notes.push("Managed Postgres usually needs `?sslmode=require` on DATABASE_URL.");

  const jwt = env.JWT_SECRET ?? "";
  if (jwt.length < 32) problems.push("JWT_SECRET must be at least 32 characters (the app refuses to start otherwise).");
  if (jwt === "vault-ultra-secure-default-jwt-secret-key-replace-in-prod-2026") problems.push("JWT_SECRET is the old public fallback; generate a new one.");

  if (!env.CRON_SECRET) notes.push("CRON_SECRET is empty: scheduled payments, FX refresh and price updates won't run automatically.");
  else if (env.CRON_SECRET.length < 16) problems.push("CRON_SECRET is too short (use 32+ random characters).");

  if (env.DEV_PASSWORD && env.DEV_PASSWORD.length < 12) problems.push("DEV_PASSWORD is set but shorter than 12 characters.");
  if (env.TRUST_PROXY && !TRUST_VALUES.includes(env.TRUST_PROXY.toLowerCase())) problems.push(`TRUST_PROXY must be one of: ${TRUST_VALUES.join(", ")}.`);
  if (production) {
    const url = env.NEXT_PUBLIC_APP_URL ?? "";
    if (!url) notes.push("NEXT_PUBLIC_APP_URL is empty (used for links in reminder emails).");
    else if (!/^https:\/\//.test(url) && !/localhost|127\.0\.0\.1/.test(url)) problems.push("NEXT_PUBLIC_APP_URL should be https:// in production (session cookies are Secure-only).");
    if (!env.TRUST_PROXY) notes.push("TRUST_PROXY is unset: rate limits use one shared bucket. Set it for your host.");
  }
  return { problems, notes };
}

function report({ problems, notes }) {
  for (const p of problems) fail(p);
  for (const n of notes) warn(n);
  if (!problems.length) ok(notes.length ? "Configuration is valid (see notes above)." : "Configuration is valid.");
  return problems.length === 0;
}

async function testDatabase(url) {
  let pg;
  try {
    pg = (await import(path.join(ROOT, "node_modules/pg/lib/index.js"))).default;
  } catch {
    warn("Skipping the connection test (run `npm install` first).");
    return null;
  }
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const r = await client.query("select current_setting('server_version') as v");
    ok(`Connected to Postgres ${r.rows[0].v}.`);
    return true;
  } catch (e) {
    fail(`Couldn't connect to the database: ${e.message}`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

// ---------- shared questions ----------
async function commonValues(existing, { production, trustProxy, appUrl }) {
  const v = {};
  v.JWT_SECRET = existing.JWT_SECRET && existing.JWT_SECRET.length >= 32 ? existing.JWT_SECRET : secret.jwt();
  v.CRON_SECRET = existing.CRON_SECRET || secret.hex();
  if (existing.JWT_SECRET && existing.JWT_SECRET === v.JWT_SECRET) ok("Keeping the existing JWT_SECRET.");
  else ok("Generated JWT_SECRET.");
  ok(existing.CRON_SECRET ? "Keeping the existing CRON_SECRET." : "Generated CRON_SECRET.");

  const signup = await confirm("Allow anyone to create an account? (No = private install; you add users with `npm run create-user`)", (existing.ALLOW_SIGNUP ?? "true") !== "false");
  v.ALLOW_SIGNUP = signup ? "true" : "false";

  const prior = existing.NEXT_PUBLIC_APP_URL ?? "";
  const placeholder = /your-app|your-site|<|example\.com/.test(prior) || (production && /localhost/.test(prior));
  v.NEXT_PUBLIC_APP_URL = await ask("Public URL of the app", prior && !placeholder ? prior : appUrl);

  const wantDev = await confirm("Enable the built-in developer/admin login?", !!existing.DEV_PASSWORD && !production);
  if (wantDev) {
    v.DEV_USERNAME = await ask("Developer email", existing.DEV_USERNAME || "developer@vault.io");
    v.DEV_PASSWORD = existing.DEV_PASSWORD && existing.DEV_PASSWORD.length >= 12 ? existing.DEV_PASSWORD : secret.password();
    ok(`Developer password: ${existing.DEV_PASSWORD === v.DEV_PASSWORD ? "kept" : "generated"} (stored in the env file).`);
  } else {
    v.DEV_USERNAME = "";
    v.DEV_PASSWORD = "";
  }
  v.TRUST_PROXY = trustProxy;
  return v;
}

async function askDatabaseUrl(existing, hint) {
  say(dim(`  ${hint}`));
  for (;;) {
    const url = await ask("DATABASE_URL (postgresql://…)", existing.DATABASE_URL && !/127\.0\.0\.1|localhost/.test(existing.DATABASE_URL) ? existing.DATABASE_URL : "");
    if (!interactive) return url;
    if (/^postgres(ql)?:\/\//.test(url)) return url;
    fail("That doesn't look like a Postgres URL.");
  }
}

function ensureEnvExampleTracked() {
  const gi = path.join(ROOT, ".gitignore");
  if (!fs.existsSync(gi)) return;
  const s = fs.readFileSync(gi, "utf8");
  if (/^\.env\*$/m.test(s) && !/^!\.env\.example$/m.test(s)) {
    fs.writeFileSync(gi, s.replace(/^\.env\*$/m, ".env*\n!.env.example"));
    ok("Updated .gitignore so .env.example is committed (real env files stay ignored).");
  }
}

const ENV_HEADER = (target) => `# VAULT environment for: ${target}. Generated by \`npm run setup\`.
# Contains secrets: never commit this file (it's gitignored).
`;

// ---------- targets ----------
const targets = {
  async local() {
    step("Local development");
    const file = path.join(ROOT, ".env");
    const existing = readEnv(file);
    const embedded = await confirm("Use the built-in zero-config Postgres? (No = use your own DATABASE_URL)", !existing.DATABASE_URL || /127\.0\.0\.1:5432\/vault_db/.test(existing.DATABASE_URL));
    const DATABASE_URL = embedded ? "postgresql://vault:vault@127.0.0.1:5432/vault_db?schema=public" : await askDatabaseUrl(existing, "Your local or remote Postgres.");
    const values = { DATABASE_URL, ...(await commonValues(existing, { production: false, trustProxy: "none", appUrl: "http://localhost:3000" })) };
    writeEnv(file, values, ENV_HEADER("local development"));
    ok(`Wrote ${path.relative(ROOT, file)}.`);
    report(validate(values, { production: false }));

    if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
      if (await confirm("Install dependencies now (npm install)?")) run("npm", ["install"]);
    }
    if (fs.existsSync(path.join(ROOT, "node_modules"))) {
      if (embedded && (await confirm("Start the local database and apply migrations now?"))) {
        if (run("node", ["scripts/dev-db.mjs"])) run("npx", ["prisma", "migrate", "deploy"]);
      } else if (!embedded && (await testDatabase(DATABASE_URL)) && (await confirm("Apply migrations to this database now?"))) {
        run("npx", ["prisma", "migrate", "deploy"]);
      }
    }
    say(`\n${bold("Next")}`);
    cmd("npm run dev            # http://localhost:3000 (also starts the local database)");
    cmd("npm run create-user    # optional: add a user from the terminal");
    if (values.DEV_PASSWORD) say(dim(`    Developer login: ${values.DEV_USERNAME} (password in .env as DEV_PASSWORD)`));
  },

  async docker() {
    step("Docker (app + Postgres with docker compose)");
    const file = path.join(ROOT, ".env.docker");
    const existing = readEnv(file);
    const behindProxy = await confirm("Will a reverse proxy (Caddy, nginx, Traefik) sit in front of the container?", false);
    const values = {
      POSTGRES_USER: existing.POSTGRES_USER || "vault",
      POSTGRES_PASSWORD: existing.POSTGRES_PASSWORD || secret.password(),
      POSTGRES_DB: existing.POSTGRES_DB || "vault_db",
      APP_PORT: await ask("Host port for the app", existing.APP_PORT || "3000"),
      ...(await commonValues(existing, { production: true, trustProxy: behindProxy ? "1" : "none", appUrl: "http://localhost:3000" })),
    };
    writeEnv(file, values, ENV_HEADER("docker compose"));
    ok(`Wrote ${path.relative(ROOT, file)}.`);
    report(validate({ ...values, __docker: true, DATABASE_URL: `postgresql://${values.POSTGRES_USER}:x@db:5432/${values.POSTGRES_DB}` }, { production: true }));
    if (!behindProxy) warn("Without HTTPS, sign-in works on http://localhost only (session cookies are Secure). Use a reverse proxy with TLS for other hosts.");
    const compose = ["compose", "--env-file", ".env.docker", "up", "-d", "--build"];
    if (has("docker") && (await confirm("Build and start it now?", true))) run("docker", compose);
    else {
      say(`\n${bold("Next")}`);
      cmd(`docker ${compose.join(" ")}`);
    }
    cmd("docker compose --env-file .env.docker logs -f app");
    say(dim("    The app migrates the database on every start; the `cron` service runs the scheduled jobs."));
  },

  async vercel() {
    step("Vercel");
    const file = path.join(ROOT, ".env.production");
    const existing = readEnv(file);
    const DATABASE_URL = await askDatabaseUrl(existing, "Use a managed Postgres with a POOLED connection string: Neon, Supabase (pooler), Prisma Postgres or Vercel Marketplace Postgres.");
    const values = { DATABASE_URL, DATABASE_POOL_MAX: existing.DATABASE_POOL_MAX || "5", ...(await commonValues(existing, { production: true, trustProxy: "vercel", appUrl: "https://your-app.vercel.app" })) };
    writeEnv(file, values, ENV_HEADER("Vercel (reference copy; the real values live in the Vercel project)"));
    ok(`Wrote ${path.relative(ROOT, file)} (gitignored).`);
    report(validate(values, { production: true }));
    if (DATABASE_URL && (await confirm("Test the database connection from here?", true))) await testDatabase(DATABASE_URL);

    say(dim("\n  Build: `vercel-build` runs `prisma migrate deploy && next build`, so every production deploy migrates first."));
    say(dim("  Cron: vercel.json schedules the jobs; Vercel sends CRON_SECRET automatically."));
    if (has("vercel") && (await confirm("Push these variables to your Vercel project now (vercel CLI)?", false))) {
      run("vercel", ["link"]);
      for (const [k, v] of Object.entries(values)) {
        if (v === "") continue;
        spawnSync("vercel", ["env", "rm", k, "production", "-y"], { cwd: ROOT, stdio: "ignore", shell: IS_WIN });
        run("vercel", ["env", "add", k, "production"], { input: v });
      }
      if (await confirm("Deploy to production now?", false)) run("vercel", ["deploy", "--prod"]);
    } else {
      say(`\n${bold("Next")}`);
      say("  1. Push the repo to GitHub and import it at https://vercel.com/new");
      say(`  2. Settings → Environment Variables: add each key from ${bold(".env.production")}`);
      say("     (or install the CLI: npm i -g vercel, then re-run `npm run setup -- --target vercel`)");
      say("  3. Deploy. Check https://<your-app>/api/health returns {\"status\":\"ok\"}.");
    }
  },

  async netlify() {
    step("Netlify");
    const file = path.join(ROOT, ".env.production");
    const existing = readEnv(file);
    const DATABASE_URL = await askDatabaseUrl(existing, "Use a managed Postgres with a pooled connection string (Neon has a Netlify integration).");
    const values = { DATABASE_URL, DATABASE_POOL_MAX: existing.DATABASE_POOL_MAX || "5", ...(await commonValues(existing, { production: true, trustProxy: "netlify", appUrl: "https://your-site.netlify.app" })) };
    writeEnv(file, values, ENV_HEADER("Netlify (reference copy)"));
    ok(`Wrote ${path.relative(ROOT, file)} (gitignored).`);
    report(validate(values, { production: true }));
    if (DATABASE_URL && (await confirm("Test the database connection from here?", true))) await testDatabase(DATABASE_URL);
    say(dim("\n  netlify.toml builds with `npm run build:deploy` (migrations, then next build)."));
    if (has("netlify") && (await confirm("Push these variables with the Netlify CLI now?", false))) {
      run("netlify", ["link"]);
      for (const [k, v] of Object.entries(values)) if (v !== "") run("netlify", ["env:set", k, v, "--secret"]);
    } else {
      say(`\n${bold("Next")}`);
      say("  1. Push to GitHub, then Netlify → Add new site → Import from Git.");
      say(`  2. Site configuration → Environment variables: add each key from ${bold(".env.production")}.`);
    }
    schedulerHint(values);
  },

  async render() {
    step("Render");
    say("  render.yaml is a Blueprint: it creates the Postgres database and the web");
    say("  service, generates JWT_SECRET and CRON_SECRET, and wires DATABASE_URL.");
    say(`\n${bold("Next")}`);
    say("  1. Push to GitHub.");
    say("  2. Render dashboard → New → Blueprint → select the repo → Apply.");
    say("  3. Fill NEXT_PUBLIC_APP_URL (https://<service>.onrender.com) and, optionally, DEV_USERNAME/DEV_PASSWORD.");
    say("  4. Copy CRON_SECRET from the service's Environment tab for the scheduler below.");
    say(dim("  Free instances sleep when idle and the free database expires after 30 days; use paid plans for real data."));
    schedulerHint({ CRON_SECRET: "<CRON_SECRET from Render>", NEXT_PUBLIC_APP_URL: "https://<service>.onrender.com" });
  },

  async railway() {
    step("Railway");
    const file = path.join(ROOT, ".env.production");
    const existing = readEnv(file);
    const values = await commonValues(existing, { production: true, trustProxy: "1", appUrl: "https://<service>.up.railway.app" });
    writeEnv(file, { DATABASE_URL: "${{Postgres.DATABASE_URL}}", ...values }, ENV_HEADER("Railway (reference copy)"));
    ok(`Wrote ${path.relative(ROOT, file)} (gitignored).`);
    say(dim("\n  railway.json: migrations run as the pre-deploy step, /api/health is the health check."));
    if (has("railway") && (await confirm("Set this up with the Railway CLI now?", false))) {
      run("railway", ["init"]);
      run("railway", ["add", "--database", "postgres"]);
      run("railway", ["add", "--service", "vault"]);
      const sets = Object.entries({ DATABASE_URL: "${{Postgres.DATABASE_URL}}", ...values }).filter(([, v]) => v !== "").flatMap(([k, v]) => ["--set", `${k}=${v}`]);
      run("railway", ["variables", "--service", "vault", ...sets]);
      if (await confirm("Deploy now (railway up)?", false)) run("railway", ["up", "--service", "vault"]);
    } else {
      say(`\n${bold("Next")}`);
      say("  1. Push to GitHub. Railway → New Project → Deploy from GitHub repo.");
      say("  2. In the project: + New → Database → PostgreSQL.");
      say("  3. In the app service → Variables: DATABASE_URL = ${{Postgres.DATABASE_URL}}, plus each key from .env.production.");
      say("  4. Settings → Networking → Generate Domain.");
    }
    schedulerHint(values);
  },

  async fly() {
    step("Fly.io");
    const file = path.join(ROOT, ".env.production");
    const existing = readEnv(file);
    const app = (await ask("Fly app name (globally unique)", readFlyApp() || `vault-${secret.hex(3)}`)).toLowerCase();
    const region = await ask("Primary region (bom=Mumbai, sin, fra, iad, lhr…)", "bom");
    writeFlyConfig(app, region);
    ok(`fly.toml → app "${app}", region ${region}.`);
    const DATABASE_URL = await askDatabaseUrl(existing, "Use Fly Managed Postgres (`fly mpg create`) or any external Postgres (Neon, Supabase). Leave empty to attach later.");
    const values = { ...(DATABASE_URL ? { DATABASE_URL } : {}), ...(await commonValues(existing, { production: true, trustProxy: "1", appUrl: `https://${app}.fly.dev` })) };
    writeEnv(file, values, ENV_HEADER("Fly.io (reference copy)"));
    ok(`Wrote ${path.relative(ROOT, file)} (gitignored).`);
    const secrets = Object.entries(values).filter(([k, v]) => v !== "" && k !== "TRUST_PROXY").map(([k, v]) => `${k}=${v}`).join("\n");
    if (has("fly") && (await confirm("Create the app and set its secrets with flyctl now?", false))) {
      run("fly", ["apps", "create", app]);
      run("fly", ["secrets", "import", "--app", app, "--stage"], { input: secrets });
      if (await confirm("Deploy now (fly deploy)?", false)) run("fly", ["deploy", "--app", app]);
    } else {
      say(`\n${bold("Next")}`);
      cmd(`fly apps create ${app}`);
      cmd(`fly secrets set --app ${app} $(grep -v '^#' .env.production | grep -v '^TRUST_PROXY' | xargs)`);
      cmd("fly deploy");
    }
    schedulerHint(values);
  },

  async vps() {
    step("Linux server (VPS) with systemd + Caddy");
    const file = path.join(ROOT, ".env.production");
    const existing = readEnv(file);
    const domain = await ask("Domain that will point at the server", "vault.example.com");
    const local = await confirm("Run Postgres on the same server?", true);
    const keepLocal = existing.DATABASE_URL && /127\.0\.0\.1|localhost/.test(existing.DATABASE_URL);
    const DATABASE_URL = local
      ? keepLocal ? existing.DATABASE_URL : `postgresql://vault:${secret.password()}@127.0.0.1:5432/vault_db?schema=public`
      : await askDatabaseUrl(existing, "Your managed Postgres URL.");
    const values = { DATABASE_URL, ...(await commonValues(existing, { production: true, trustProxy: "1", appUrl: `https://${domain}` })) };
    writeEnv(file, values, ENV_HEADER(`VPS at ${domain}`));
    ok(`Wrote ${path.relative(ROOT, file)} (gitignored). Copy it to /opt/vault/.env.production on the server.`);
    report(validate(values, { production: true }));
    const dbPass = /:\/\/vault:([^@]+)@/.exec(DATABASE_URL)?.[1] ?? "<password>";
    say(`\n${bold("On the server (Ubuntu/Debian)")}`);
    cmd("curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt-get install -y nodejs git");
    if (local) {
      cmd("sudo apt-get install -y postgresql");
      cmd(`sudo -u postgres psql -c "CREATE USER vault WITH PASSWORD '${dbPass}';" -c "CREATE DATABASE vault_db OWNER vault;"`);
    }
    cmd("sudo useradd --system --create-home --shell /usr/sbin/nologin vault");
    cmd("sudo git clone <your-repo-url> /opt/vault && sudo chown -R vault:vault /opt/vault");
    cmd("scp .env.production <server>:/opt/vault/.env.production   # from this machine");
    cmd("cd /opt/vault && sudo -u vault npm ci && sudo -u vault npm run build");
    cmd("sudo cp deploy/vps/vault.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now vault");
    cmd("sudo apt-get install -y caddy");
    cmd(`sudo sed 's/vault.example.com/${domain}/' deploy/vps/Caddyfile | sudo tee /etc/caddy/Caddyfile && sudo systemctl reload caddy`);
    cmd(`sudo sed 's/CHANGE_ME/<CRON_SECRET>/' deploy/vps/vault-cron | sudo tee /etc/cron.d/vault && sudo chmod 600 /etc/cron.d/vault`);
    say(dim("    Updates: git pull && npm ci && npm run build && sudo systemctl restart vault (migrations run on start)."));
  },

  async github() {
    step("GitHub repository");
    say(dim("  GitHub hosts the code, CI and the job scheduler. It can't run this app itself"));
    say(dim("  (GitHub Pages serves static files only; VAULT needs a Node server and Postgres)."));
    ensureEnvExampleTracked();
    if (!fs.existsSync(path.join(ROOT, ".git"))) {
      if (await confirm("This folder isn't a git repository. Run `git init -b main`?", true)) run("git", ["init", "-b", "main"]);
    }
    const leaks = checkForSecretsInTree();
    if (leaks.length) {
      warn("These files are NOT ignored by git and may hold secrets or private data:");
      for (const f of leaks) say(`      ${f}`);
      say(dim("    Add them to .gitignore (or delete them) before your first commit."));
    } else ok("No env files or private data would be committed.");

    say(`\n${bold("Publish")}`);
    cmd("git add -A && git status        # review what will be committed");
    cmd('git commit -m "Initial commit"');
    if (has("gh")) cmd("gh repo create <name> --private --source . --push");
    else cmd("git remote add origin git@github.com:<you>/<repo>.git && git push -u origin main");
    say(dim("    CI (.github/workflows/ci.yml) runs migrations, typecheck, lint, tests and a build on every push."));

    say(`\n${bold("Scheduled jobs (for non-Vercel hosts)")}`);
    const url = await ask("Deployed app URL for the scheduler (empty to skip)", "");
    if (url) {
      const prod = readEnv(path.join(ROOT, ".env.production"));
      const cron = await ask("CRON_SECRET of the deployed app", prod.CRON_SECRET || "");
      if (has("gh") && cron && (await confirm("Store VAULT_URL and CRON_SECRET as repository secrets with gh?", true))) {
        run("gh", ["secret", "set", "VAULT_URL"], { input: url.replace(/\/$/, "") });
        run("gh", ["secret", "set", "CRON_SECRET"], { input: cron });
      } else schedulerHint({ NEXT_PUBLIC_APP_URL: url, CRON_SECRET: cron || "<CRON_SECRET>" });
    }
  },
};

function schedulerHint(values) {
  say(`\n${bold("Scheduled jobs")} ${dim("(this host has no built-in cron for Next.js)")}`);
  say("  .github/workflows/scheduled-jobs.yml calls the job endpoints. Add two repository secrets:");
  say(`    VAULT_URL   = ${values.NEXT_PUBLIC_APP_URL || "https://<your-app>"}`);
  say(`    CRON_SECRET = ${values.CRON_SECRET?.startsWith("<") ? values.CRON_SECRET : "(the CRON_SECRET in .env.production)"}`);
  if (has("gh")) say(dim("    or run: npm run setup -- --target github"));
}

function readFlyApp() {
  const f = path.join(ROOT, "fly.toml");
  const m = fs.existsSync(f) ? /^app = "([^"]+)"/m.exec(fs.readFileSync(f, "utf8")) : null;
  return m && m[1] !== "vault-app" ? m[1] : "";
}
function writeFlyConfig(app, region) {
  const f = path.join(ROOT, "fly.toml");
  const s = fs.readFileSync(f, "utf8").replace(/^app = ".*"$/m, `app = "${app}"`).replace(/^primary_region = ".*"$/m, `primary_region = "${region}"`);
  fs.writeFileSync(f, s);
}

/** Files that exist, aren't gitignored, and look private. */
function checkForSecretsInTree() {
  const candidates = [".env", ".env.local", ".env.production", ".env.docker", "docs/DEVELOPER.md", ".vault-data", "pre-acquisition-review", "VAULT_PRODUCTION_READINESS_REPORT.md", "VAULT_PRODUCTION_READINESS_REPORT.html"];
  const present = candidates.filter((f) => fs.existsSync(path.join(ROOT, f)));
  if (!present.length) return [];
  if (!has("git") || !fs.existsSync(path.join(ROOT, ".git"))) return present;
  const r = spawnSync("git", ["check-ignore", "--no-index", ...present], { cwd: ROOT, encoding: "utf8" });
  const ignored = new Set((r.stdout || "").split(/\r?\n/).filter(Boolean));
  return present.filter((f) => !ignored.has(f));
}

// ---------- main ----------
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes" || a === "-y") out.yes = true;
    else if (a === "--check") out.check = true;
    else if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--target" || a === "-t") out.target = argv[++i];
    else if (a.startsWith("--target=")) out.target = a.slice(9);
    else if (a === "--env-file") out.envFile = argv[++i];
  }
  return out;
}

async function main() {
  say(bold("\nVAULT setup"));
  if (args.help) {
    say("  npm run setup [-- --target <local|docker|vercel|netlify|render|railway|fly|vps|github>] [--yes]");
    say("  npm run check-env [-- --env-file .env.production]");
    return;
  }

  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 19) || (major === 22 && minor < 12) || major === 21 || major === 23) {
    fail(`Node ${process.versions.node} is too old for Prisma 7. Use Node 20.19+, 22.12+ or 24+.`);
    process.exitCode = 1;
    return;
  }
  ok(`Node ${process.versions.node}`);

  if (args.check) {
    const file = path.resolve(ROOT, args.envFile || ".env");
    step(`Checking ${path.relative(ROOT, file)}`);
    if (!fs.existsSync(file)) {
      fail("File not found. Run `npm run setup` first.");
      process.exitCode = 1;
      return;
    }
    const env = readEnv(file);
    const production = /production|docker/.test(path.basename(file));
    // docker compose assembles DATABASE_URL from the POSTGRES_* values.
    if (!env.DATABASE_URL && env.POSTGRES_PASSWORD) Object.assign(env, { __docker: true, DATABASE_URL: `postgresql://${env.POSTGRES_USER || "vault"}:${env.POSTGRES_PASSWORD}@db:5432/${env.POSTGRES_DB || "vault_db"}` });
    const valid = report(validate(env, { production }));
    for (const k of ["DATABASE_URL", "JWT_SECRET", "CRON_SECRET", "DEV_PASSWORD"]) if (k in env) say(`    ${k.padEnd(13)} ${k === "DATABASE_URL" ? env[k].replace(/:[^:@/]+@/, ":••••@") : mask(env[k])}`);
    if (env.DATABASE_URL && !env.DATABASE_URL.includes("${{") && !env.__docker) await testDatabase(env.DATABASE_URL);
    process.exitCode = valid ? 0 : 1;
    return;
  }

  const target =
    args.target ||
    (await choose("Where do you want to run VAULT?", [
      { value: "local", label: "This computer (development)", hint: "zero-config Postgres, npm run dev" },
      { value: "docker", label: "Docker / docker compose", hint: "app + Postgres + cron, any server" },
      { value: "vercel", label: "Vercel", hint: "serverless, built-in cron; needs managed Postgres" },
      { value: "netlify", label: "Netlify", hint: "needs managed Postgres" },
      { value: "render", label: "Render", hint: "Blueprint creates app + Postgres" },
      { value: "railway", label: "Railway", hint: "app + Postgres in one project" },
      { value: "fly", label: "Fly.io", hint: "Docker image, global regions" },
      { value: "vps", label: "Your own Linux server (VPS)", hint: "systemd + Caddy HTTPS" },
      { value: "github", label: "GitHub (publish the repo, CI, scheduled jobs)" },
    ]));
  if (!targets[target]) {
    fail(`Unknown target "${target}".`);
    process.exitCode = 1;
    return;
  }
  ensureEnvExampleTracked();
  await targets[target]();
  say(`\n${green("Done.")} ${dim("Full guide: docs/DEPLOYMENT.md")}\n`);
}

main()
  .catch((e) => {
    fail(e?.stack || String(e));
    process.exitCode = 1;
  })
  .finally(() => rl?.close());
