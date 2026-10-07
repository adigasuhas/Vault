import type { User } from "@prisma/client";

/** The user fields the developer console may see. An allow-list, so a column
 * added later (or a credential-adjacent one like the security question)
 * isn't exposed by default. */
export function toAdminUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    baseCurrency: u.baseCurrency,
    isOnboarded: u.isOnboarded,
    lastLogin: u.lastLogin,
    createdAt: u.createdAt,
    hasSecurityQuestion: !!u.securityAnswerHash,
  };
}
