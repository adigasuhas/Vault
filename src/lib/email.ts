/**
 * Transactional email.
 *
 * No provider is wired yet (no SMTP / API key in the environment). Until one is
 * configured, this logs the message so password-reset works end-to-end in
 * development. Swap the body of `send` for Resend / SES / Postmark before
 * shipping to external users.
 */
async function send(to: string, subject: string, text: string) {
  if (process.env.EMAIL_PROVIDER) {
    // TODO(phase-2): real provider integration.
  }
  console.info(`\n[email → ${to}] ${subject}\n${text}\n`);
}

export async function sendPasswordResetEmail(to: string, resetUrl: string) {
  await send(
    to,
    "Reset your VAULT password",
    `Someone asked to reset the password for this VAULT account.\n\n` +
      `Reset it here (link valid for 1 hour):\n${resetUrl}\n\n` +
      `If this wasn't you, ignore this email. Your password won't change.`
  );
}

export async function sendReminderDigest(to: string, name: string | null, lines: string[], appUrl: string) {
  await send(
    to,
    `VAULT: ${lines.length} thing${lines.length === 1 ? "" : "s"} for today`,
    `Hi${name ? ` ${name.split(" ")[0]}` : ""},\n\n` + lines.map((l) => `• ${l}`).join("\n") + `\n\nOpen VAULT: ${appUrl}/dashboard\n\nChange what you hear about in Settings → Reminders.`
  );
}

export async function sendPriceAlertEmail(
  to: string,
  name: string | null,
  a: { kind: "TARGET" | "STOP_LOSS"; ticker: string; scopeLabel: string | null; threshold: number; price: number; currency: string; priceAt: Date }
) {
  const target = a.kind === "TARGET";
  const who = a.scopeLabel ? ` (${a.scopeLabel})` : "";
  await send(
    to,
    target ? `VAULT: ${a.ticker} reached your target` : `VAULT: ${a.ticker} hit your stop-loss`,
    `Hi${name ? ` ${name.split(" ")[0]}` : ""},\n\n` +
      (target
        ? `${a.ticker}${who} reached your target price of ${a.threshold} ${a.currency}.`
        : `${a.ticker}${who} fell to your stop-loss of ${a.threshold} ${a.currency}. You may want to review this position.`) +
      `\nLatest price: ${a.price} ${a.currency}, quoted ${a.priceAt.toISOString().slice(0, 16).replace("T", " ")} UTC.\n\n` +
      `This is a notification only. VAULT never buys or sells for you.\n\nTurn these emails off in Settings → Reminders.`
  );
}
