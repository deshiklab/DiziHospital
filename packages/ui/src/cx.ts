/** Tiny class-name joiner — avoids a dependency for two lines of logic. */
export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');
