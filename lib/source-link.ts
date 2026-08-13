export function safeSourceHref(value?: string) {
  if (!value) return null;

  if (value.startsWith("/source-corpus/") && !value.startsWith("/source-corpus//")) {
    return value;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
