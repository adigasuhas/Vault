<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/vault-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/vault-logo-light.svg">
  <img alt="VAULT" src="docs/assets/vault-logo-light.svg" width="400">
</picture>

**Personal finance and wealth tracking, built on a ledger that always adds up.**

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![React](https://img.shields.io/badge/React-19-149eca?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-14%2B-336791?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2d3748?logo=prisma)

[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/adigasuhas)

</div>

---

## What it does

VAULT is a self-hosted, multi-user app for keeping track of where your money is, where it goes and what it is worth.

- **Accounts:** bank accounts, credit cards, wallets and forex cards, each in its own currency. Balances come from an append-only ledger, so every number can be traced back to the entries behind it. Mistakes are reversed, never silently deleted.
- **Expenses:** daily spending by category, receipts, and one-time purchases that can be grouped into projects and kept out of your monthly budget.
- **Budgets:** monthly plans per category with recurring lines, adjustments and live utilization.
- **Income and payments:** scheduled salary, rent, subscriptions and bills that post automatically when due, with per-occurrence skips and overrides.
- **Loans:** EMI schedules accurate to the paisa, payment tracking, and outstanding balances that count against your net worth.
- **Investments:** stocks (with live prices), mutual funds (daily NAVs), fixed deposits and other assets, with purchase lots and gains.
- **Multi-currency:** primary, secondary and budget currencies, automatic or manual exchange rates, and the original currency always shown next to a conversion.
- **Analytics and reports:** net worth history, cash flow, budget adherence, a funding runway, and statements and summaries as CSV, Excel or PDF.
- **Reminders:** an in-app bell for income about to arrive, bills coming up and budget categories close to their limit.
- **Security:** scrypt password hashing, signed session cookies, rate-limited sign-in, secret-question account recovery and strict security headers.

Prices, NAVs and exchange rates come from free public sources (Yahoo Finance, AMFI and Frankfurter), so no API keys are needed.

## Quick start

### Requirements

- [Node.js](https://nodejs.org/) 20.19+, 22.12+ or 24+
- [Git](https://git-scm.com/)
- Nothing else. For local development, VAULT starts its own PostgreSQL automatically.

### 1. Clone the repository

```bash
git clone https://github.com/adigasuhas/Vault.git
cd Vault
```

### 2. Install and set up

```bash
npm install
npm run setup -- --target local
```

The setup script writes a `.env` file with freshly generated secrets, starts the built-in database and applies the database migrations. Run `npm run check-env` at any time to confirm the configuration and the database connection.

<details>
<summary>Prefer to set it up by hand?</summary>

```bash
cp .env.example .env
# Fill in JWT_SECRET (32+ characters) and CRON_SECRET:
#   openssl rand -base64 48
#   openssl rand -hex 32
npm run db:deploy
```

To use your own PostgreSQL instead of the built-in one, set `DATABASE_URL` in `.env`.

</details>

### 3. Run it

```bash
npm run dev
```

Open <http://localhost:3000> and create an account with **Sign up**. You can also create users from the terminal with `npm run create-user`.

To try VAULT with sample data, say yes to the developer login during setup, run `npm run db:seed`, and sign in with `DEV_USERNAME` and `DEV_PASSWORD` from `.env`.

### Production build on your machine

```bash
npm run build
npm start
```

## Useful scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in development mode (with the built-in database) |
| `npm run setup` | Interactive setup for local use or any hosting target |
| `npm run check-env` | Validate `.env` and test the database connection |
| `npm test` | Run the test suite |
| `npm run db:deploy` | Apply pending database migrations |
| `npm run db:studio` | Browse the database in Prisma Studio |
| `npm run create-user` / `reset-password` / `delete-user` | Manage users from the terminal |

## Deploying

`npm run setup` also prepares deployments to **Docker**, **Vercel**, **Netlify**, **Render**, **Railway**, **Fly.io** and **your own Linux server**. It generates secrets, writes the right environment file and shows the next steps:

```bash
npm run setup                     # choose a target from the menu
npm run setup -- --target docker  # or name it directly
```

Step-by-step instructions for every host are in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Documentation

- [User guide](docs/USER_GUIDE.md): how to use every part of the app
- [Deployment guide](docs/DEPLOYMENT.md): hosting, environment variables, scheduled jobs and troubleshooting
- [`.env.example`](.env.example): every setting, with comments

## Tech stack

Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Prisma 7 with PostgreSQL, Recharts, `@react-pdf/renderer` and Vitest.

## Support

VAULT is free. The coffee wasn't. It was built on a questionable amount of coffee and a frankly irresponsible number of AI tokens. If it saves you an afternoon, you can buy the next cup. If not, use it anyway. That was the point.

<a href="https://buymeacoffee.com/adigasuhas"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=adigasuhas&button_colour=FFDD00&font_colour=000000&font_family=Inter&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="44"></a>

Optional, and nothing unlocks. Not a coffee person? A star on GitHub helps too.

## License

Proprietary. Copyright (c) 2026 Suhas Adiga. All rights reserved. See [LICENSE](LICENSE).
