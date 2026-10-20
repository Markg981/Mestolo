/**
 * Canonical unit keys and their aliases in the supported languages.
 * Units are NEVER converted automatically: we only recognise them so they can
 * be displayed/translated consistently and compared when merging shopping lists.
 */
export const UNIT_ALIASES: Record<string, string[]> = {
  mg: ['mg', 'milligrammi', 'milligrammo', 'milligram', 'milligrams', 'miligramos', 'milligrammes', 'milligramm', 'miligramas'],
  g: ['g', 'gr', 'grs', 'grammi', 'grammo', 'gram', 'grams', 'gramme', 'grammes', 'gramos', 'gramo', 'gramm', 'gramas', 'grama'],
  kg: ['kg', 'chili', 'chilo', 'chilogrammi', 'chilogrammo', 'kilo', 'kilos', 'kilogram', 'kilograms', 'kilogramos', 'kilogrammes', 'kilogramm', 'quilos', 'quilo', 'quilogramas'],
  ml: ['ml', 'millilitri', 'millilitro', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'mililitros', 'mililitro'],
  cl: ['cl', 'centilitri', 'centilitro', 'centiliter', 'centilitre', 'centilitres', 'centilitros'],
  dl: ['dl', 'decilitri', 'decilitro', 'deciliter', 'décilitre', 'decilitros'],
  l: ['l', 'lt', 'litri', 'litro', 'liter', 'liters', 'litre', 'litres', 'litros'],
  tsp: ['tsp', 'teaspoon', 'teaspoons', 'cucchiaino', 'cucchiaini', 'cdt', 'cucchiaino da tè', 'cucchiaino da te', 'cucharadita', 'cucharaditas', 'cuillère à café', 'cuillères à café', 'càc', 'c. à c.', 'tl', 'teelöffel', 'colher de chá', 'colheres de chá'],
  tbsp: ['tbsp', 'tbs', 'tablespoon', 'tablespoons', 'cucchiaio', 'cucchiai', 'cucchiaio da tavola', 'cucharada', 'cucharadas', 'cuillère à soupe', 'cuillères à soupe', 'càs', 'c. à s.', 'el', 'esslöffel', 'colher de sopa', 'colheres de sopa'],
  cup: ['cup', 'cups', 'tazza', 'tazze', 'taza', 'tazas', 'tasse', 'tassen', 'xícara', 'xícaras', 'chávena', 'chávenas'],
  fl_oz: ['fl oz', 'fl. oz.', 'fluid ounce', 'fluid ounces'],
  oz: ['oz', 'ounce', 'ounces', 'oncia', 'once', 'onza', 'onzas', 'unze', 'unzen', 'onça', 'onças'],
  lb: ['lb', 'lbs', 'pound', 'pounds', 'libbra', 'libbre', 'libra', 'libras', 'livre', 'livres', 'pfund'],
  pinch: ['pinch', 'pinches', 'pizzico', 'pizzichi', 'pizzichino', 'pellizco', 'pizca', 'pincée', 'pincées', 'prise', 'prisen', 'pitada', 'pitadas'],
  clove: ['clove', 'cloves', 'spicchio', 'spicchi', 'diente', 'dientes', 'gousse', 'gousses', 'zehe', 'zehen', 'dente', 'dentes'],
  slice: ['slice', 'slices', 'fetta', 'fette', 'rebanada', 'rebanadas', 'loncha', 'lonchas', 'tranche', 'tranches', 'scheibe', 'scheiben', 'fatia', 'fatias'],
  can: ['can', 'cans', 'tin', 'tins', 'lattina', 'lattine', 'barattolo', 'barattoli', 'lata', 'latas', 'boîte', 'boîtes', 'dose', 'dosen'],
  pack: ['pack', 'packs', 'package', 'packet', 'confezione', 'confezioni', 'bustina', 'bustine', 'busta', 'paquete', 'paquetes', 'sobre', 'sachet', 'sachets', 'paquet', 'packung', 'päckchen', 'pacote', 'pacotes', 'saqueta'],
  bunch: ['bunch', 'bunches', 'mazzetto', 'mazzetti', 'mazzo', 'ciuffo', 'ciuffi', 'manojo', 'ramillete', 'botte', 'bouquet', 'bund', 'maço', 'molho'],
  sprig: ['sprig', 'sprigs', 'rametto', 'rametti', 'ramo', 'rami', 'ramita', 'ramitas', 'brin', 'brins', 'zweig', 'zweige', 'raminho', 'raminhos'],
  leaf: ['leaf', 'leaves', 'foglia', 'foglie', 'foglioline', 'hoja', 'hojas', 'feuille', 'feuilles', 'blatt', 'blätter', 'folha', 'folhas'],
  drop: ['drop', 'drops', 'goccia', 'gocce', 'gota', 'gotas', 'goutte', 'gouttes', 'tropfen'],
  glass: ['glass', 'glasses', 'bicchiere', 'bicchieri', 'vaso', 'vasos', 'verre', 'verres', 'glas', 'gläser', 'copo', 'copos'],
  handful: ['handful', 'handfuls', 'manciata', 'manciate', 'puñado', 'puñados', 'poignée', 'poignées', 'handvoll', 'punhado', 'punhados'],
  piece: ['pc', 'pcs', 'piece', 'pieces', 'pezzo', 'pezzi', 'pz', 'pieza', 'piezas', 'pièce', 'pièces', 'stück', 'stk', 'pedaço', 'pedaços', 'unidade', 'unidades', 'unidad', 'unidades'],
};

export const UNIT_KEYS = Object.keys(UNIT_ALIASES);

/** Units that represent the same physical dimension (used only for display hints, never for conversion). */
export const UNIT_DIMENSION: Record<string, 'mass' | 'volume' | 'count' | 'other'> = {
  mg: 'mass', g: 'mass', kg: 'mass', oz: 'mass', lb: 'mass',
  ml: 'volume', cl: 'volume', dl: 'volume', l: 'volume', tsp: 'volume', tbsp: 'volume', cup: 'volume', fl_oz: 'volume', glass: 'volume', drop: 'volume',
  piece: 'count', clove: 'count', slice: 'count', can: 'count', pack: 'count', leaf: 'count', sprig: 'count', bunch: 'count',
  pinch: 'other', handful: 'other',
};

const aliasIndex = new Map<string, string>();
for (const [key, aliases] of Object.entries(UNIT_ALIASES)) {
  aliasIndex.set(key.toLowerCase(), key);
  for (const a of aliases) aliasIndex.set(a.toLowerCase(), key);
}

/** Longest alias in words, used by the parser to try multi-word units first. */
export const MAX_UNIT_WORDS = Math.max(
  ...[...aliasIndex.keys()].map((a) => a.split(/\s+/).length),
);

export function normalizeUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!cleaned) return null;
  return aliasIndex.get(cleaned) ?? aliasIndex.get(raw.trim().toLowerCase()) ?? null;
}

export function isKnownUnit(unit: string | null | undefined): boolean {
  return !!unit && UNIT_KEYS.includes(unit);
}

/** Phrases meaning "to taste" in the supported languages. */
export const TO_TASTE_PATTERNS: RegExp[] = [
  /\bq\.?\s?b\.?(?=\s|$|[,;)])/i, // quanto basta
  /\bquanto basta\b/i,
  /\ba piacere\b/i,
  /\bto taste\b/i,
  /\bas needed\b/i,
  /\bal gusto\b/i,
  /\ba gusto\b/i,
  /\bc\.?\s?s\.?(?=\s|$|[,;)])/, // cantidad suficiente
  /\bcantidad suficiente\b/i,
  /\bau goût\b/i,
  /\bselon votre goût\b/i,
  /\bnach geschmack\b/i,
  /\bnach belieben\b/i,
  /\ba gosto\b/i,
  /\bq\.?\s?s\.?(?=\s|$|[,;)])/i, // quanto baste (pt) / quantité suffisante
];
