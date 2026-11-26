/**
 * The same codebase runs as separate processes (plan §2: modular monolith with
 * separate worker processes). `all` runs everything in one process for development.
 */
export const APP_ROLES = ['api', 'market', 'outbox', 'notifications'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export function parseRoles(value: string | undefined): AppRole[] {
  const raw = (value ?? 'all').split(',').map((r) => r.trim().toLowerCase()).filter(Boolean);
  if (raw.length === 0 || raw.includes('all')) return [...APP_ROLES];
  const unknown = raw.filter((r) => !(APP_ROLES as readonly string[]).includes(r));
  if (unknown.length) throw new Error(`Unknown APP_ROLE value(s): ${unknown.join(', ')}`);
  return [...new Set(raw)] as AppRole[];
}
