import "dotenv/config";
import readline from "readline";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/crypto";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

async function main() {
  const email = (await ask("Email: ")).toLowerCase().trim();
  const name = await ask("Name: ");
  const password = await ask("Password: ");

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`A user with email "${email}" already exists.`);
    process.exit(1);
  }

  const user = await db.user.create({
    data: {
      email,
      name,
      passwordHash: hashPassword(password),
      avatarUrl: `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(email)}`,
      isOnboarded: true,
    },
  });

  console.log(`Created user ${user.email} (${user.id}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
