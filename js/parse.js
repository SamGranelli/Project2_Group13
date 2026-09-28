// Turn pasted recipe text (from a website, caption, or notes) into structured ingredients.
import { CATALOG } from './data.js';

const FRACTIONS = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅕': 0.2 };

const UNIT_ALIASES = {
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  oz: ['oz', 'ounce', 'ounces'],
  cup: ['cup', 'cups', 'c'],
  tbsp: ['tbsp', 'tbs', 'tablespoon', 'tablespoons', 'tbsps'],
  tsp: ['tsp', 'teaspoon', 'teaspoons', 'tsps'],
  clove: ['clove', 'cloves'],
  can: ['can', 'cans', 'tin', 'tins'],
  bunch: ['bunch', 'bunches'],
  slice: ['slice', 'slices'],
  stalk: ['stalk', 'stalks', 'rib', 'ribs'],
  each: ['each', 'whole', 'large', 'medium', 'small', 'piece', 'pieces'],
};
const UNIT_LOOKUP = Object.fromEntries(Object.entries(UNIT_ALIASES).flatMap(([u, list]) => list.map((a) => [a, u])));

// Convert between units that are measuring the same thing.
const TO_BASE = { tsp: ['vol', 1], tbsp: ['vol', 3], cup: ['vol', 48], oz: ['wt', 1], lb: ['wt', 16] };
export function convert(qty, from, to) {
  if (from === to) return qty;
  const a = TO_BASE[from], b = TO_BASE[to];
  if (a && b && a[0] === b[0]) return (qty * a[1]) / b[1];
  return null;
}

// Common words that point at a catalog item.
const ALIASES = {
  scallion: 'green_onion', scallions: 'green_onion', spaghetti: 'pasta', penne: 'pasta', ziti: 'pasta', rigatoni: 'pasta',
  macaroni: 'pasta', linguine: 'pasta', fettuccine: 'pasta', orzo: 'pasta', noodle: 'egg_noodles', yogurt: 'greek_yogurt',
  broth: 'chicken_broth', stock: 'chicken_broth', parm: 'parmesan', parmigiano: 'parmesan', cheddar: 'cheddar',
  mozzarella: 'mozzarella', prawn: 'shrimp', prawns: 'shrimp', garbanzo: 'chickpeas', cilantro: 'cilantro', coriander: 'cilantro',
  slaw: 'cabbage', coleslaw: 'cabbage', cabbage: 'cabbage', kielbasa: 'pork_sausage', sausage: 'pork_sausage',
  tortilla: 'tortillas', tortillas: 'tortillas', bun: 'buns', buns: 'buns', sriracha: 'sriracha', honey: 'honey', ramen: 'ramen',
  'soy': 'soy_sauce', tamari: 'soy_sauce', 'marinara': 'marinara', 'pasta sauce': 'marinara', 'coconut': 'coconut_milk',
};

const NOISE = new Set(['chopped', 'diced', 'minced', 'sliced', 'fresh', 'freshly', 'large', 'small', 'medium', 'boneless', 'skinless',
  'of', 'and', 'or', 'to', 'taste', 'for', 'serving', 'the', 'a', 'an', 'finely', 'roughly', 'cut', 'into', 'pieces', 'peeled',
  'drained', 'rinsed', 'optional', 'plus', 'more', 'about', 'cooked', 'uncooked', 'dried', 'ground', 'shredded', 'grated', 'can', 'cans',
  'packed', 'whole', 'thinly', 'halved', 'cubed', 'divided', 'at', 'room', 'temperature', 'softened', 'melted', 'frozen', 'thawed']);

const singular = (w) => w.replace(/(ies)$/, 'y').replace(/(oes|ches|shes)$/, (m) => m.slice(0, -2)).replace(/s$/, '');

function tokens(s) {
  return s.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w && !NOISE.has(w)).map(singular);
}

function parseNumber(str) {
  str = str.trim();
  let total = 0, found = false;
  for (const part of str.split(/\s+/)) {
    if (/^\d+\/\d+$/.test(part)) { const [a, b] = part.split('/').map(Number); if (b) { total += a / b; found = true; } continue; }
    const m = part.match(/^(\d*\.?\d+)?([¼½¾⅓⅔⅛⅕])?$/);
    if (m && (m[1] || m[2])) { total += (m[1] ? parseFloat(m[1]) : 0) + (m[2] ? FRACTIONS[m[2]] : 0); found = true; }
  }
  return found ? total : null;
}

/** "1 ½ cups diced onion" → { qty: 1.5, unit: 'cup', name: 'diced onion' } */
export function parseLine(line) {
  let s = line.replace(/^[\s•\-*–▢□☐✓]+/, '').trim();
  const numRe = /^((?:\d+\s+)?(?:\d+\/\d+|\d*\.?\d+[¼½¾⅓⅔⅛⅕]?|[¼½¾⅓⅔⅛⅕]))(?:\s*(?:-|–|to)\s*(?:\d+\/\d+|\d*\.?\d+))?\s*/;
  let qty = null;
  const m = s.match(numRe);
  if (m) { qty = parseNumber(m[1]); s = s.slice(m[0].length); }
  let unit = null;
  const um = s.match(/^([a-zA-Z]+)\.?\s+/);
  if (um && UNIT_LOOKUP[um[1].toLowerCase()]) { unit = UNIT_LOOKUP[um[1].toLowerCase()]; s = s.slice(um[0].length); }
  // "1 (15 oz) can black beans"
  const cm = s.match(/^\(.*?\)\s*(cans?|tins?|packages?|pkg)\b\s*/i);
  if (cm) { unit = /can|tin/i.test(cm[1]) ? 'can' : unit; s = s.slice(cm[0].length); }
  s = s.replace(/^of\s+/i, '').replace(/,.*$/, '').trim();
  return { qty, unit, name: s || line.trim() };
}

/** Best catalog match for an ingredient name (or null). */
export function matchItem(name, extraItems = {}) {
  const lower = name.toLowerCase();
  const words = tokens(name);
  if (!words.length) return null;
  const all = { ...CATALOG, ...extraItems };
  let best = null, bestScore = 0;
  for (const [id, it] of Object.entries(all)) {
    const itWords = new Set([...tokens(it.name), ...tokens(id.replace(/_/g, ' '))]);
    let score = words.filter((w) => itWords.has(w)).length;
    for (const [alias, target] of Object.entries(ALIASES)) {
      if (target === id && new RegExp(`\\b${alias}\\b`).test(lower)) score += 1.5;
    }
    if (score > 0) score -= itWords.size * 0.05; // prefer tighter names on ties
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return bestScore >= 0.9 ? best : null;
}

/** Split a pasted recipe into title / ingredient lines / steps using its headings. */
export function splitRecipeText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let title = '', ings = [], steps = [], mode = null;
  for (const l of lines) {
    const low = l.toLowerCase().replace(/[:#*]/g, '').trim();
    if (/^ingredients?\b/.test(low) && low.length < 30) { mode = 'ing'; continue; }
    if (/^(instructions?|directions?|method|steps|preparation|how to make)\b/.test(low) && low.length < 40) { mode = 'step'; continue; }
    if (!mode) { if (!title) title = l.replace(/^#+\s*/, ''); continue; }
    (mode === 'ing' ? ings : steps).push(l);
  }
  // No headings? Guess: lines starting with a number/fraction are ingredients, longer sentences are steps.
  if (!ings.length && !steps.length) {
    for (const l of lines.slice(title ? 1 : 0)) {
      if (/^[\d¼½¾⅓⅔•\-*]/.test(l) && l.length < 80 && !/^\d+[.)]\s+[A-Z]/.test(l)) ings.push(l);
      else steps.push(l);
    }
  }
  steps = steps.map((s) => s.replace(/^(step\s*)?\d+[.):]?\s*/i, '')).filter(Boolean);
  const serves = text.match(/(?:serves|servings|yield)\s*:?\s*(\d+)/i);
  const time = text.match(/(?:total time|cook time|ready in)\s*:?\s*(\d+)\s*(min|minutes|hr|hours?)/i);
  return {
    title,
    ingredients: ings,
    steps,
    serves: serves ? Number(serves[1]) : null,
    minutes: time ? Number(time[1]) * (/h/i.test(time[2]) ? 60 : 1) : null,
  };
}
