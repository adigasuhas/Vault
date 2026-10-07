import "dotenv/config";
import readline from "readline";
import { db } from "../src/lib/db";
import { deleteUserData } from "../src/lib/user-delete";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((resolve) => rl.question(q, resolve));

async function main() {
  const email = (await ask("Email: ")).toLowerCase().trim();
  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email "${email}".`);
    process.exit(1);
  }

  const confirm = await ask(`Type "y" to permanently delete ${email} and all their data: `);
  if (confirm.trim().toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }

  await deleteUserData(user.id);
  console.log(`Deleted ${email}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
