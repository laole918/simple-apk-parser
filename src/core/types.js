function normalizeLocale(value) {
  if (typeof value !== "string") return "";

  const locale = value.trim();
  return locale || "";
}

export function normalizeParseOptions(options, runtime = {}) {
  const locale = normalizeLocale(options?.locale) || normalizeLocale(runtime?.getDefaultLocale?.());

  return {
    loadResources: options?.loadResources !== false,
    locale,
  };
}
