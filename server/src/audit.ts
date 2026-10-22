import type { FastifyRequest } from 'fastify';

/**
 * Records that somebody did something: one log line with who (the logged-in user), what (`event`, a stable
 * "area.action" name such as `password.changed`) and a readable message. Call it from every action that changes
 * something or that matters for security (login, email, passwords, groups, ...), after the action has succeeded or
 * failed. Extra `details` are kept as fields of the JSON log line.
 *
 * Never put secrets in `message` or `details`: no passwords, codes, tokens or session ids, and no typed login
 * names (people paste passwords there). Mask email addresses with `maskEmail`.
 */
export function audit(
  request: Pick<FastifyRequest, 'log' | 'user'>,
  event: string,
  message: string,
  details: Record<string, unknown> = {},
): void {
  request.log.info({ event, user: request.user?.username, userId: request.user?.id, ...details }, message);
}

/** `ann.smith@gmail.com` -> `a***@gmail.com`: enough to recognise an address, not to copy it from the logs. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
}
