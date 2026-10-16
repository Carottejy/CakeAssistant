// Analyse des lignes d'ingrédients (français + anglais) et calcul des quantités.
// Module sans dépendance : utilisé par l'application et par les tests (node).

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅕': 0.2 };

const NUMBER_WORDS = {
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  neuf: 9, dix: 10, onze: 11, douze: 12, demi: 0.5, 'demie': 0.5,
  one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5,
};

// id → { dim: 'mass'|'volume'|'count', toBase: facteur vers g ou ml, label: [singulier, pluriel] }
export const UNITS = {
  mg: { dim: 'mass', toBase: 0.001, label: ['mg', 'mg'] },
  g: { dim: 'mass', toBase: 1, label: ['g', 'g'] },
  kg: { dim: 'mass', toBase: 1000, label: ['kg', 'kg'] },
  oz: { dim: 'mass', toBase: 28.35, label: ['oz', 'oz'] },
  lb: { dim: 'mass', toBase: 453.6, label: ['lb', 'lb'] },
  ml: { dim: 'volume', toBase: 1, label: ['ml', 'ml'] },
  cl: { dim: 'volume', toBase: 10, label: ['cl', 'cl'] },
  dl: { dim: 'volume', toBase: 100, label: ['dl', 'dl'] },
  l: { dim: 'volume', toBase: 1000, label: ['l', 'l'] },
  cs: { dim: 'volume', toBase: 15, label: ['c. à s.', 'c. à s.'] },
  cc: { dim: 'volume', toBase: 5, label: ['c. à c.', 'c. à c.'] },
  cup: { dim: 'volume', toBase: 240, label: ['tasse', 'tasses'] },
  floz: { dim: 'volume', toBase: 29.57, label: ['fl oz', 'fl oz'] },
  verre: { dim: 'volume', toBase: 200, label: ['verre', 'verres'] },
  pincee: { dim: 'count', label: ['pincée', 'pincées'] },
  sachet: { dim: 'count', label: ['sachet', 'sachets'] },
  feuille: { dim: 'count', label: ['feuille', 'feuilles'] },
  gousse: { dim: 'count', label: ['gousse', 'gousses'] },
  brin: { dim: 'count', label: ['brin', 'brins'] },
  tranche: { dim: 'count', label: ['tranche', 'tranches'] },
  pot: { dim: 'count', label: ['pot', 'pots'] },
  noix: { dim: 'count', label: ['noix', 'noix'] },
  boule: { dim: 'count', label: ['boule', 'boules'] },
};

// Motifs d'unités testés juste après la quantité. Ordre : du plus spécifique au plus général.
// (?![\p{L}]) remplace \b pour fonctionner avec les lettres accentuées.
const END = '(?![\\p{L}])\\.?';
const UNIT_PATTERNS = [
  ['cs', `(?:cuill[eè]res?|cuil\\.?|c\\.?)\\s*(?:à|a)\\s*s(?:oupe)?${END}|c\\.?\\s*s\\.(?=\\s)|c[àa]s${END}|cs${END}|tbsp${END}|tablespoons?${END}`],
  ['cc', `(?:cuill[eè]res?|cuil\\.?|c\\.?)\\s*(?:à|a)\\s*c(?:af[ée])?${END}|c\\.?\\s*c\\.(?=\\s)|c[àa]c${END}|cc${END}|tsp${END}|teaspoons?${END}`],
  ['kg', `(?:kilogrammes?|kilos?|kg)${END}`],
  ['mg', `(?:milligrammes?|mg)${END}`],
  ['g', `(?:grammes?|grs?|g)${END}`],
  ['ml', `(?:millilitres?|ml)${END}`],
  ['cl', `(?:centilitres?|cl)${END}`],
  ['dl', `(?:d[ée]cilitres?|dl)${END}`],
  ['l', `(?:litres?|l)${END}`],
  ['floz', `fl\\.?\\s*oz${END}`],
  ['oz', `(?:ounces?|oz)${END}`],
  ['lb', `(?:pounds?|lbs?)${END}`],
  ['cup', `(?:cups?|tasses?)${END}`],
  ['verre', `verres?${END}`],
  ['pincee', `(?:pinc[ée]es?|pinch(?:es)?)${END}`],
  ['sachet', `sachets?${END}`],
  ['feuille', `feuilles?${END}`],
  ['gousse', `gousses?${END}`],
  ['brin', `brins?${END}`],
  ['tranche', `tranches?${END}`],
  ['pot', `pots?${END}`],
  ['noix', `noix(?=\\s+de\\s)`],
  ['boule', `boules?${END}`],
].map(([id, src]) => [id, new RegExp('^(?:' + src + ')', 'iu')]);

const NUM = String.raw`(?:\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?|[½¼¾⅓⅔⅛⅕])`;
const QTY_RE = new RegExp(String.raw`^(?:env(?:iron)?\.?\s*|~\s*|≈\s*)?(\d+\s+\d+\s*\/\s*\d+|\d+\s*[½¼¾⅓⅔⅛⅕]|${NUM})(?:\s*(?:-|–|à|to)\s*(${NUM}))?\s*`, 'iu');

export function parseNumber(s) {
  if (s == null) return null;
  s = String(s).trim();
  let total = 0;
  for (const [ch, v] of Object.entries(FRACTIONS)) {
    if (s.includes(ch)) { total += v; s = s.replace(ch, '').trim(); }
  }
  if (!s) return total || null;
  // « 1 1/2 »
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return total + Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return total + Number(frac[1]) / Number(frac[2]);
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? total + n : null;
}

function matchUnit(text) {
  for (const [id, re] of UNIT_PATTERNS) {
    const m = text.match(re);
    if (m) return { unit: id, rest: text.slice(m[0].length) };
  }
  return null;
}

function cleanName(s) {
  return s
    .replace(/^\s*(?:de\s+|d['’]\s*|of\s+)/i, '')
    .replace(/^[\s:,\-–]+|[\s:,;\-–]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Analyse une ligne : « 250 g de farine » → { qty: 250, unit: 'g', name: 'farine', raw } */
export function parseIngredient(raw) {
  const original = String(raw ?? '').replace(/\s+/g, ' ').trim();
  let text = original.replace(/^[•\-*–·▪]\s*/, '');
  const out = { raw: original, qty: null, unit: null, name: text };
  if (!text) return out;

  // Mots-nombres en tête : « une pincée de sel », « deux œufs », « un demi citron »
  const wordMatch = text.match(/^(une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|demie?|half|one|two|three|four|five)(?:\s+demie?)?\s+/i);
  let qtyFound = false;
  if (wordMatch) {
    let v = NUMBER_WORDS[wordMatch[1].toLowerCase()];
    if (/\sdemie?\s*$/i.test(wordMatch[0]) && v === 1) v = 0.5;
    out.qty = v;
    text = text.slice(wordMatch[0].length);
    qtyFound = true;
  } else {
    const m = text.match(QTY_RE);
    if (m && m[0].trim()) {
      const a = parseNumber(m[1]);
      const b = m[2] ? parseNumber(m[2]) : null;
      out.qty = b != null && a != null ? (a + b) / 2 : a;
      if (b != null) out.range = [a, b];
      text = text.slice(m[0].length);
      qtyFound = true;
    }
  }

  if (qtyFound) {
    const u = matchUnit(text);
    if (u) { out.unit = u.unit; text = u.rest; }
    out.name = cleanName(text) || original;
    return out;
  }

  // Quantité placée après le nom : « Farine : 250 g », « Sucre (100 g) », « beurre 50g »
  const later = original.match(new RegExp(String.raw`[(:\s](${NUM})\s*([\p{L}.]+(?:\s*(?:à|a)\s*[\p{L}.]+)?)?\)?\s*$`, 'iu'));
  if (later) {
    const q = parseNumber(later[1]);
    const u = later[2] ? matchUnit(later[2]) : null;
    if (q != null && (u || !later[2])) {
      out.qty = q;
      out.unit = u ? u.unit : null;
      out.name = cleanName(original.slice(0, later.index).replace(/[(:]\s*$/, '')) || original;
      return out;
    }
  }
  out.name = cleanName(text) || original;
  return out;
}

/** Renvoie l'ingrédient avec qty/unit/name, en analysant la ligne brute si besoin. */
export function normalizeIngredient(ing) {
  if (typeof ing === 'string') return parseIngredient(ing);
  if (ing && typeof ing.name === 'string' && 'qty' in ing) return ing;
  return { ...(ing || {}), ...parseIngredient(ing?.raw ?? '') };
}

// --- Fusion pour la liste de courses -------------------------------------

const STOP = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'en', 'a', 'au', 'aux', 'pour', 'et', 'of', 'the',
  // qualificatifs sans effet sur les courses
  'mou', 'molle', 'pommade', 'fondu', 'fondue', 'ramolli', 'froid', 'froide', 'tiede', 'tamise', 'tamisee', 'temperature', 'ambiante', 'frais', 'fraiche', 'gros', 'grosse', 'moyen', 'moyenne', 'calibre', 'bio']);

export function ingredientKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ')
    .split(/[,;]/)[0]
    .replace(/[’']/g, ' ')
    .split(/[^a-z0-9%]+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/(?:s|x)$/, '') : w))
    .join(' ')
    .trim();
}

function isEgg(key) { return /\boeuf\b|\begg\b/.test(key) && !/jaune|blanc|yolk|white/.test(key); }
function isYolk(key) { return /^jaune\b|jaune oeuf|yolk/.test(key); }
function isWhite(key) { return /^blanc\b|blanc oeuf|egg white/.test(key); }

// --- Mise en forme -------------------------------------------------------

const fmtNum = (n, maxDec) => n.toLocaleString('fr-FR', { maximumFractionDigits: maxDec, minimumFractionDigits: 0 });

export function formatQty(qty, unit) {
  if (qty == null) return '';
  const u = unit ? UNITS[unit] : null;
  if (!u) {
    // Nombre de pièces : arrondi au demi
    const r = Math.round(qty * 2) / 2;
    return fmtNum(r === 0 ? Math.round(qty * 100) / 100 : r, 2);
  }
  if (unit === 'g' || unit === 'ml') {
    if (qty >= 100) return `${fmtNum(Math.round(qty), 0)} ${u.label[0]}`;
    if (qty >= 10) return `${fmtNum(Math.round(qty), 0)} ${u.label[0]}`;
    return `${fmtNum(qty, 1)} ${u.label[0]}`;
  }
  const plural = qty > 1 ? 1 : 0;
  if (u.dim === 'count') return `${fmtNum(Math.round(qty * 4) / 4, 2)} ${u.label[plural]}`;
  const dec = qty < 10 ? 2 : 1;
  return `${fmtNum(qty, dec)} ${u.label[plural]}`;
}

/** Indication utile pour les quantités non entières (œufs, gélatine…). */
export function hintFor(qty, unit, name) {
  if (qty == null) return '';
  const key = ingredientKey(name);
  const notWhole = Math.abs(qty - Math.round(qty)) > 0.05;
  if (!unit) {
    if (isYolk(key)) return `≈ ${Math.round(qty * 18)} g de jaunes`;
    if (isWhite(key)) return `≈ ${Math.round(qty * 30)} g de blancs`;
    if (isEgg(key)) return `≈ ${Math.round(qty * 50)} g d'œufs battus`;
  }
  if (unit === 'feuille' && /gelatine/.test(key)) return `≈ ${fmtNum(qty * 2, 1)} g de gélatine`;
  if (unit === 'sachet' && /levure/.test(key)) return `≈ ${fmtNum(qty * 11, 0)} g`;
  if (unit === 'sachet' && /sucre vanill/.test(key)) return `≈ ${fmtNum(qty * 7.5, 0)} g`;
  if (unit === 'cs' && notWhole) return `≈ ${fmtNum(qty * 15, 0)} ml`;
  if (unit === 'cc' && notWhole) return `≈ ${fmtNum(qty * 5, 0)} ml`;
  return '';
}

export function scaleIngredient(ing, factor) {
  const n = normalizeIngredient(ing);
  const qty = n.qty == null ? null : n.qty * factor;
  return { ...n, qty, display: n.qty == null ? 'selon besoin' : formatQty(qty, n.unit), hint: hintFor(qty, n.unit, n.name) };
}

/**
 * Additionne les ingrédients de plusieurs recettes (déjà multipliés).
 * items : [{ ingredients: [...], factor }]
 */
export function shoppingList(items) {
  const map = new Map();
  for (const { ingredients, factor, label } of items) {
    for (const ing of ingredients || []) {
      const n = normalizeIngredient(ing);
      const key = ingredientKey(n.name) || n.name.toLowerCase();
      const u = n.unit ? UNITS[n.unit] : null;
      const dim = u ? u.dim : 'piece';
      const groupKey = `${key}|${dim}|${dim === 'count' ? n.unit : ''}`;
      let g = map.get(groupKey);
      if (!g) {
        g = { key, name: n.name, dim, unit: u ? (dim === 'mass' ? 'g' : dim === 'volume' ? 'ml' : n.unit) : null, qty: 0, unknown: false, from: new Set() };
        map.set(groupKey, g);
      }
      if (label) g.from.add(label);
      if (n.qty == null) { g.unknown = true; continue; }
      const q = n.qty * factor;
      g.qty += u && u.toBase ? q * u.toBase : q;
    }
  }
  return [...map.values()]
    .map((g) => {
      const hasQty = g.qty > 0;
      let display = hasQty ? formatQty(g.qty, g.unit) : 'selon besoin';
      if (hasQty && g.unit === 'g' && g.qty >= 1000) display = `${fmtNum(g.qty / 1000, 2)} kg`;
      if (hasQty && g.unit === 'ml' && g.qty >= 1000) display = `${fmtNum(g.qty / 1000, 2)} l`;
      if (hasQty && g.unknown) display += ' + selon besoin';
      return { name: g.name, qty: hasQty ? g.qty : null, unit: g.unit, display, hint: hasQty ? hintFor(g.qty, g.unit, g.name) : '', from: [...g.from] };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Devine la catégorie d'une préparation à partir de son titre. */
export function guessCategory(title = '') {
  const t = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/curd|confit|coulis|compot|insert|gelee|marmelade|caramel/.test(t)) return 'insert';
  if (/glacage|nappage|miroir|icing|frosting|fondant/.test(t)) return 'glacage';
  if (/genoise|biscuit|joconde|dacquoise|sponge|financier|cake|brownie|madeleine|savoie|gateau/.test(t)) return 'biscuit';
  if (/creme|chantilly|ganache|mousse|mousseline|patissiere|diplomate|bavarois|crémeux|cremeux|namelaka|mascarpone/.test(t)) return 'creme';
  if (/pate|tarte|brisee|sablee|sucree|feuillet|choux|croquant|crumble|streusel|sable/.test(t)) return 'pate';
  if (/macaron|meringue|praline|decor|tuile/.test(t)) return 'decor';
  return 'autre';
}

export const CATEGORIES = {
  biscuit: { label: 'Biscuit & génoise', icon: 'cake' },
  creme: { label: 'Crème & mousse', icon: 'cream' },
  insert: { label: 'Insert & fruit', icon: 'strawberry' },
  glacage: { label: 'Glaçage', icon: 'donut' },
  pate: { label: 'Pâte & fond', icon: 'tart' },
  decor: { label: 'Décor & croustillant', icon: 'macaron' },
  autre: { label: 'Autre', icon: 'cupcake' },
};
