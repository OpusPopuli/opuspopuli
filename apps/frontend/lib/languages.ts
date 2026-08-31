/**
 * Controlled vocabulary for the `primaryLanguages` profile field.
 *
 * The list is California's language-access set (the languages state
 * agencies are required to translate under Dymally-Alatorre) plus the
 * next tier of household languages from the ACS, so the dropdown covers
 * the overwhelming majority of speakers without becoming a scroll of
 * every language on earth. `other` is the escape hatch: it still tells
 * relevance that this is a non-English-speaking household even when we
 * can't name the language.
 *
 * Values are stable keys, not display names — English/Spanish labels
 * live under `fields.primaryLanguages.options.*` in the profile locale
 * bundles. Free-text values written before this field became a
 * controlled vocab still render, because the option lookup falls back
 * to the raw stored string.
 */
export const LANGUAGE_OPTIONS = [
  "english",
  "spanish",
  "chinese_mandarin",
  "chinese_cantonese",
  "tagalog",
  "vietnamese",
  "korean",
  "armenian",
  "punjabi",
  "russian",
  "farsi",
  "arabic",
  "japanese",
  "hindi",
  "khmer",
  "hmong",
  "portuguese",
  "french",
  "german",
  "urdu",
  "thai",
  "lao",
  "mien",
  "ukrainian",
  "asl",
  "other",
] as const;

export type LanguageOption = (typeof LANGUAGE_OPTIONS)[number];
