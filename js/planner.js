// Budget math and week generation.
import { state, item, allRecipes, recipe } from './store.js';

const EPS = 1e-6;

export function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); }
export const todayIso = () => isoDate(new Date());
export const dayOfWeek = (s) => parseDate(s).getDay();

/** Recipes allowed by the user's diet / avoid / time settings. Recipes rated 1★ are never auto-picked. */
export function candidates() {
  const { diet, avoid, maxMinutes } = state.settings;
  const avoidWords = avoid.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  return allRecipes().filter((r) => {
    if (diet === 'vegetarian' && !(r.tags.includes('vegetarian') || r.tags.includes('vegan'))) return false;
    if (diet === 'vegan' && !r.tags.includes('vegan')) return false;
    if (maxMinutes && r.minutes > maxMinutes) return false;
    if (state.ratings[r.id] === 1) return false;
    if (avoidWords.length) {
      const text = (r.name + ' ' + r.ingredients.map(([id]) => item(id)?.name || id).join(' ')).toLowerCase();
      if (avoidWords.some((w) => text.includes(w))) return false;
    }
    return true;
  });
}

/** Total quantity of each item the plan needs, in the item's unit. */
export function needs(plan) {
  const map = new Map();
  if (!plan) return map;
  for (const d of plan.days) {
    if (d.skipped || !d.recipeId) continue;
    const r = recipe(d.recipeId);
    if (!r) continue;
    const scale = d.servings / r.serves;
    for (const [id, q] of r.ingredients) map.set(id, (map.get(id) || 0) + q * scale);
  }
  return map;
}

/** Grocery rows for a plan. Buying is by whole packs, so shared ingredients get cheaper per meal. */
export function groceryRows(plan) {
  const rows = [];
  for (const [id, need] of needs(plan)) {
    const it = item(id);
    if (!it) continue;
    const packs = Math.max(1, Math.ceil(need / it.pack - EPS));
    const staple = !!it.staple && state.settings.skipStaples;
    const have = !!state.list.have[id];
    rows.push({ id, it, need, packs, cost: packs * it.price, staple, have, counts: !staple && !have });
  }
  return rows;
}

export function planTotal(plan) {
  const groceries = groceryRows(plan).reduce((s, r) => s + (r.counts ? r.cost : 0), 0);
  const extras = state.list.extras.reduce((s, e) => s + (Number(e.price) || 0), 0);
  return groceries + extras;
}

/** Proportional (not pack-rounded) cost of one serving — a fair "what this dish costs" number. */
export function costPerServing(r) {
  let total = 0;
  for (const [id, q] of r.ingredients) {
    const it = item(id);
    if (!it || (it.staple && state.settings.skipStaples)) continue;
    total += (q / it.pack) * it.price;
  }
  return total / r.serves;
}

/** Average macros per serving across the planned dinners. */
export function avgMacros(plan) {
  const sum = { cal: 0, protein: 0, carbs: 0, fat: 0 };
  let n = 0;
  for (const d of plan?.days || []) {
    if (d.skipped || !d.recipeId) continue;
    const r = recipe(d.recipeId);
    if (!r?.macros) continue;
    for (const k in sum) sum[k] += r.macros[k] || 0;
    n++;
  }
  if (!n) return null;
  for (const k in sum) sum[k] = Math.round(sum[k] / n);
  return sum;
}

function weight(r) {
  const rating = state.ratings[r.id];
  let w = 1;
  if (state.favorites.includes(r.id)) w += 2;
  if (rating) w += rating - 3;
  return Math.max(0.2, w);
}

function weightedSample(pool, n, rand) {
  const bag = pool.slice();
  const out = [];
  while (out.length < n) {
    if (!bag.length) bag.push(...pool); // not enough recipes: allow repeats
    const total = bag.reduce((s, r) => s + weight(r), 0);
    let x = rand() * total;
    let i = 0;
    for (; i < bag.length - 1; i++) { x -= weight(bag[i]); if (x <= 0) break; }
    out.push(bag.splice(i, 1)[0]);
  }
  return out;
}

export function newPlan(start = todayIso()) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const dow = dayOfWeek(addDays(start, i));
    days.push({ recipeId: null, servings: state.settings.servings, skipped: !state.settings.cookDays.includes(dow), locked: false });
  }
  return fillPlan({ start, days });
}

/**
 * Fill every open (not skipped, not locked) night. Tries many random combinations and keeps
 * the one that fits the budget with the best-liked recipes.
 */
export function fillPlan(plan, rand = Math.random) {
  const open = plan.days.map((d, i) => (!d.skipped && !(d.locked && d.recipeId) ? i : -1)).filter((i) => i >= 0);
  if (!open.length) return plan;
  const keptIds = new Set(plan.days.filter((d) => d.locked && d.recipeId).map((d) => d.recipeId));
  let pool = candidates().filter((r) => !keptIds.has(r.id));
  if (!pool.length) pool = candidates();
  if (!pool.length) pool = allRecipes();

  const budget = Number(state.settings.budget) || 0;
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 400; t++) {
    const pick = weightedSample(pool, open.length, rand);
    const trial = { ...plan, days: plan.days.map((d) => ({ ...d })) };
    open.forEach((dayIdx, k) => { trial.days[dayIdx].recipeId = pick[k].id; });
    const total = planTotal(trial);
    const over = budget ? Math.max(0, total - budget) : 0;
    const liked = pick.reduce((s, r) => s + weight(r), 0);
    const score = over * 20 - liked + rand() * 0.5;
    if (score < bestScore) { bestScore = score; best = trial; }
  }
  return best;
}

/** Other recipes for one night, sorted by how much they'd change the weekly total. */
export function swapOptions(plan, dayIdx) {
  const current = planTotal(plan);
  const used = new Set(plan.days.map((d) => d.recipeId));
  return candidates()
    .filter((r) => !used.has(r.id))
    .map((r) => {
      const trial = { ...plan, days: plan.days.map((d, i) => (i === dayIdx ? { ...d, recipeId: r.id, skipped: false } : d)) };
      return { r, delta: planTotal(trial) - current };
    })
    .sort((a, b) => a.delta - b.delta);
}

/** The plan's shopping date: the chosen shopping weekday on or just before the first day. */
export function shopDate(plan) {
  for (let i = -6; i < 1; i++) {
    const iso = addDays(plan.start, i);
    if (dayOfWeek(iso) === state.settings.shopDay) return iso;
  }
  return plan.start;
}

/** Frozen items to thaw the night before day `i` (none if they were just bought fresh). */
export function thawFor(plan, i) {
  const d = plan.days[i];
  if (!d || d.skipped || !d.recipeId) return [];
  if (addDays(plan.start, i - 1) <= shopDate(plan)) return [];
  const r = recipe(d.recipeId);
  return r ? freezerItems(r) : [];
}

/** Items in a recipe that are usually frozen and need thawing the night before. */
export function freezerItems(r) {
  return r.ingredients.map(([id]) => item(id)).filter((it) => it?.freezer);
}
