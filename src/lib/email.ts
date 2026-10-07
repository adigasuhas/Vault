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
