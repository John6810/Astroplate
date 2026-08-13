import en, { type Dict } from "./en";
import fr from "./fr";
import ja from "./ja";

export type Locale = "fr" | "en" | "ja";

export const locales: Locale[] = ["fr", "en", "ja"];

export const dicts: Record<Locale, Dict> = { fr, en, ja };

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
