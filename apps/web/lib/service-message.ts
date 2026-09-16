/** Localize service diagnostics only; never apply this to PR bodies, commit messages, or audit evidence. */
export function serviceMessage(message: unknown, fallback: string, code?: unknown): string {
  if (typeof message === 'string' && message.trim() !== '' && !/\p{Script=Hangul}/u.test(message)) return message;
  return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_:-]*$/.test(code) ? `${fallback} (${code})` : fallback;
}
