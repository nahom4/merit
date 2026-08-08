/**
 * fast-xml-parser hands back a string for a plain element, a number where a value looks
 * numeric, and an object with a `#text` key for an element that carries attributes. Every
 * field read from a filing goes through here before anything tries to parse it.
 */
export const text = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim().length === 0 ? null : value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && value !== null && '#text' in value) {
    return text((value as { '#text': unknown })['#text']);
  }
  return null;
};

/** Returns NaN for an unusable value so the domain parse rejects it and it counts as a fault. */
export const toDollars = (value: unknown): number => {
  const raw = text(value);
  return raw === null ? Number.NaN : Number(raw);
};

export const toCents = (value: unknown): number | null => {
  const dollars = toDollars(value);
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : null;
};
