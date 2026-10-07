// Runs before `prisma migrate deploy && next build` on hosted builds (Netlify,
// Vercel). Fails fast with one readable message listing every missing variable,
// instead of a cryptic Prisma error now and a JWT_SECRET error on the next try.
// Local builds read .env; hosted builds have no .env and use the host's vars.
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

const problems = [];

if (!process.env.DATABASE_URL) {
  problems.push("DATABASE_URL: the Postgres connection string (use a pooled URL on serverless hosts).");
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  problems.push("JWT_SECRET: at least 32 random characters (openssl rand -base64 48).");
}

if (problems.length > 0) {
  console.error("\nBuild stopped: required environment variables are missing.\n");
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    "\nSet them in your host's settings, then redeploy:" +
      "\n  Netlify: Site configuration → Environment variables" +
      "\n  Vercel:  Project → Settings → Environment Variables" +
      "\nSee docs/DEPLOYMENT.md for the full list.\n"
  );
  process.exit(1);
}

console.log("Build environment OK.");
