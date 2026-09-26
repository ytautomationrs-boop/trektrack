import { env } from "./env.js";

const BUILT_IN_ADMIN_EMAILS = ["reecewheeler13@gmail.com"];

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function configuredAdminEmails() {
  return [
    ...BUILT_IN_ADMIN_EMAILS,
    ...(env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim())
      .filter(Boolean),
  ].map(normalizeEmail);
}

export function isBootstrapAdminEmail(email: string) {
  return configuredAdminEmails().includes(normalizeEmail(email));
}

export function effectiveIsAdmin(user: { email: string; isAdmin: boolean }) {
  return user.isAdmin;
}

export async function ensureEffectiveAdmin(user: { id: string; email: string; isAdmin: boolean }) {
  return effectiveIsAdmin(user);
}
