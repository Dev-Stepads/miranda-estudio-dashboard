/**
 * Helpers for multi-language string fields used by Nuvemshop (and some
 * other Latin American APIs). A product name arrives as:
 *
 *   { "pt": "Camiseta Preta", "es": "Camiseta Negra", "en": "Black T-shirt" }
 *
 * The dashboard only targets Portuguese (Miranda Estúdio is a pt-only store),
 * so we default to extracting the `pt` key with a fallback chain for safety.
 */

export interface I18nString {
  pt?: string | null;
  es?: string | null;
  en?: string | null;
}

export type LocalizedField = I18nString | string | null | undefined;

/**
 * Extract a string from a localized field.
 *
 * - If the field is a plain string, return it as-is.
 * - If it's an object, return the preferred language with fallback to pt → es → en.
 * - If null/undefined/empty, return an empty string.
 */
export function extractLocalized(
  field: LocalizedField,
  preferredLang: 'pt' | 'es' | 'en' = 'pt',
): string {
  if (field == null) return '';
  if (typeof field === 'string') return field;

  const preferred = field[preferredLang];
  if (typeof preferred === 'string' && preferred.length > 0) return preferred;

  // Fallback chain: pt → es → en. Null values are skipped.
  const pt = field.pt;
  if (typeof pt === 'string' && pt.length > 0) return pt;
  const es = field.es;
  if (typeof es === 'string' && es.length > 0) return es;
  const en = field.en;
  if (typeof en === 'string' && en.length > 0) return en;

  return '';
}
