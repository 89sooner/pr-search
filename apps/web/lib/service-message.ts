/** Localize service diagnostics only; never apply this to PR bodies, commit messages, or audit evidence. */
export function serviceMessage(message: unknown, fallback: string, code?: unknown): string {
  if (typeof message === 'string' && message.trim() !== '' && !/\p{Script=Hangul}/u.test(message)) return message;
  return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_:-]*$/.test(code) ? `${fallback} (${code})` : fallback;
}

const CORRELATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A service failure for a plain-text error slot (CR-129). A server error (5xx) carries the response's correlation ID
 * so the user can report it and an operator can find the matching server log line. Client errors (4xx) do not: the
 * message already says what to change.
 */
export function serviceFailureMessage(
  body: { readonly error?: { readonly message?: unknown; readonly code?: unknown }; readonly correlation_id?: unknown } | null | undefined,
  fallback: string,
  status: number,
): string {
  const message = serviceMessage(body?.error?.message, fallback, body?.error?.code);
  const id = body?.correlation_id;
  return status >= 500 && typeof id === 'string' && CORRELATION_ID.test(id) ? `${message} Reference ID: ${id}` : message;
}
