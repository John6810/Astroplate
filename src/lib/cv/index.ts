import en, { type Dict } from "./en";
import fr from "./fr";
import ja from "./ja";

export type Locale = "fr" | "en" | "ja";

export const locales: Locale[] = ["fr", "en", "ja"];

// ── Build-time computed numbers ──────────────────────────────────────────────
// Durations are computed when the site BUILDS, not hardcoded in the dicts —
// a hardcoded "13 months" had silently become 24 by the time it was read.
// The site redeploys on every push and at least weekly (Dependabot
// auto-merge), so these figures can never drift by more than a few days.
// Dict values reference them via {it_years} / {post_duration} placeholders.
const MS_PER_MONTH = (365.25 / 12) * 24 * 60 * 60 * 1000;
const monthsSince = (iso: string) =>
  Math.floor((Date.now() - new Date(iso).getTime()) / MS_PER_MONTH);

const IT_START = "2007-09-01"; // ETNIC — first IT role
const POST_START = "2024-08-01"; // POST Luxembourg — current role

export const IT_YEARS = Math.floor(monthsSince(IT_START) / 12);
const POST_MONTHS = monthsSince(POST_START);

const formatDuration: Record<Locale, (months: number) => string> = {
  fr: (m) => {
    const y = Math.floor(m / 12);
    const r = m % 12;
    if (m < 12) return `${m} mois`;
    const years = `${y} ${y > 1 ? "ans" : "an"}`;
    return r === 0 ? years : `${years} et ${r} mois`;
  },
  en: (m) => {
    const y = Math.floor(m / 12);
    const r = m % 12;
    if (m < 12) return `${m} months`;
    const years = `${y} ${y > 1 ? "years" : "year"}`;
    return r === 0 ? years : `${years} and ${r} month${r > 1 ? "s" : ""}`;
  },
  ja: (m) => {
    const y = Math.floor(m / 12);
    const r = m % 12;
    if (m < 12) return `${m}ヶ月間`;
    return r === 0 ? `${y}年間` : `${y}年${r}ヶ月間`;
  },
};

function resolveDict(dict: Dict, locale: Locale): Dict {
  const replacements: Record<string, string> = {
    "{it_years}": String(IT_YEARS),
    "{post_duration}": formatDuration[locale](POST_MONTHS),
  };
  return Object.fromEntries(
    Object.entries(dict).map(([key, value]) => [
      key,
      Object.entries(replacements).reduce(
        (s, [token, r]) => s.split(token).join(r),
        value,
      ),
    ]),
  ) as Dict;
}

export const dicts: Record<Locale, Dict> = {
  fr: resolveDict(fr, "fr"),
  en: resolveDict(en, "en"),
  ja: resolveDict(ja, "ja"),
};

// Display metadata for the language switcher + <html lang> + routing.
export const localeMeta: Record<
  Locale,
  { label: string; flag: string; htmlLang: string; path: string }
> = {
  fr: { label: "FR", flag: "/icons/flag-fr.svg", htmlLang: "fr", path: "/" },
  en: { label: "EN", flag: "/icons/flag-gb.svg", htmlLang: "en", path: "/en" },
  ja: { label: "JP", flag: "/icons/flag-jp.svg", htmlLang: "ja", path: "/ja" },
};

// hreflang alternates for the localized homepages. Every locale variant lists
// the full set (Google requires the links to be reciprocal); x-default points
// at the FR root, the site's primary language.
export const homeAlternates = [
  ...locales.map((l) => ({
    hreflang: localeMeta[l].htmlLang,
    href: localeMeta[l].path,
  })),
  { hreflang: "x-default", href: "/" },
];
