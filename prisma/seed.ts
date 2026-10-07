import "dotenv/config";
import { db } from "../src/lib/db";
import { ensureDevDemoData } from "../src/lib/defaults";

async function main() {
  const devEmail = (process.env.DEV_USERNAME || "developer@vault.io").toLowerCase();

  let user = await db.user.findUnique({ where: { email: devEmail } });
  if (!user) {
    user = await db.user.create({
      data: {
        email: devEmail,
        name: "Developer",
        role: "DEVELOPER",
        isOnboarded: true,
      },
    });
    console.log(`Created Developer Mode user: ${user.email}`);
  } else {
    console.log(`Developer Mode user already exists: ${user.email}`);
  }

  await ensureDevDemoData(user.id, user.baseCurrency);
  console.log("Seeded default categories and a demo savings account.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
