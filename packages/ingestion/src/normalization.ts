export type AddressFingerprint = {
  normalized: string;
  building: string;
  unit: string | null;
};

const TOKEN_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:av|avda|avenue)\b/g, 'avenida'],
  [/\b(?:st|street)\b/g, 'calle'],
  [/\b(?:depto|dpto|dto|departamento|apartment|apt|unidad|unit)\b/g, 'unit'],
  [/\b(?:nro|numero|number|no)\b/g, '']
];

export function normalizeAddress(address: string): string {
  let normalized = address
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en');
  for (const [pattern, replacement] of TOKEN_REPLACEMENTS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized
    .replace(/(?<=\d)[.,](?=\d{3}\b)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function fingerprintAddress(address: string): AddressFingerprint {
  const normalized = normalizeAddress(address);
  const unitMatch = /(?:^| )unit ([a-z0-9-]+)(?: |$)/.exec(normalized);
  const unit = unitMatch?.[1] ?? null;
  const building = normalized.replace(/(?:^| )unit [a-z0-9-]+(?: |$)/, ' ').trim().replace(/\s+/g, ' ');
  return { normalized, building, unit };
}
