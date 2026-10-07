import "dotenv/config";
import readline from "readline";
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/crypto";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

async function main() {
  const email = (await ask("Email: ")).toLowerCase().trim();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email "${email}".`);
    process.exit(1);
  }

  const password = await ask("New password: ");
  await db.user.update({ where: { email }, data: { passwordHash: hashPassword(password) } });
  console.log(`Password updated for ${email}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
