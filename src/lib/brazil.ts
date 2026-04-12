/**
 * Brazilian state (UF) utilities.
 *
 * Used to normalize Nuvemshop's `default_address.province` field which
 * sometimes returns full state names ("Bahia", "São Paulo") instead of
 * 2-letter UF codes ("BA", "SP"). The DB `customers.state` column is
 * `char(2)`, so we MUST normalize before insert.
 *
 * Also useful for Conta Azul's DDD-to-state fallback (T12).
 */

const STATE_NAME_TO_UF: Record<string, string> = {
  // Full names (with accents)
  'acre': 'AC',
  'alagoas': 'AL',
  'amapá': 'AP',
  'amazonas': 'AM',
  'bahia': 'BA',
  'ceará': 'CE',
  'distrito federal': 'DF',
  'espírito santo': 'ES',
  'goiás': 'GO',
  'maranhão': 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  'pará': 'PA',
  'paraíba': 'PB',
  'paraná': 'PR',
  'pernambuco': 'PE',
  'piauí': 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  'rondônia': 'RO',
  'roraima': 'RR',
  'santa catarina': 'SC',
  'são paulo': 'SP',
  'sergipe': 'SE',
  'tocantins': 'TO',

  // Without accents (common in API responses)
  'amapa': 'AP',
  'ceara': 'CE',
  'espirito santo': 'ES',
  'goias': 'GO',
  'maranhao': 'MA',
  'para': 'PA',
  'paraiba': 'PB',
  'parana': 'PR',
  'piaui': 'PI',
  'rondonia': 'RO',
  'sao paulo': 'SP',
};

/** Set of valid 2-letter UF codes for quick validation. */
const VALID_UF = new Set([
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN',
  'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]);

/**
 * Normalize a province/state value to a 2-letter UF code.
 *
 * Accepts:
 * - Already a 2-letter code ("BA", "SP") → returns as-is (uppercased)
 * - Full state name ("Bahia", "São Paulo") → maps to UF
 * - Name without accents ("Sao Paulo") → maps to UF
 * - Anything else (international, empty, null) → returns null
 */
export function normalizeState(province: string | null | undefined): string | null {
  if (province === null || province === undefined || province === '') return null;

  const trimmed = province.trim();
  if (trimmed === '') return null;

  // Already a 2-letter UF code?
  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && VALID_UF.has(upper)) return upper;

  // Try full name lookup (case-insensitive)
  const lower = trimmed.toLowerCase();
  const mapped = STATE_NAME_TO_UF[lower];
  if (mapped !== undefined) return mapped;

  // Not a recognized Brazilian state — likely international
  return null;
}
