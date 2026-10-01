// Budget math and week generation.
import { state, item, allRecipes, recipe, mealsOf, MEALS } from './store.js';

const EPS = 1e-6;

export function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); }
export const todayIso = () => isoDate(new Date());
export const dayOfWeek = (s) => parseDate(s).getDay();

// Breakfasts and lunches repeat through the week (like real life, and cheaper); dinners don't.
const MAX_DISTINCT = { breakfast: 3, lunch: 3, dinner: 7 };

/** Recipes for a meal allowed by the user's diet / avoid / time settings. Recipes rated 1★ are never auto-picked. */
export function candidates(meal) {
  const { diet, avoid, maxMinutes } = state.settings;
  const avoidWords = avoid.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean);
  return allRecipes().filter((r) => {
    if (meal && !mealsOf(r).includes(meal)) return false;
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

const emptySlot = (skipped = false) => ({ recipeId: null, servings: state.settings.servings, skipped, locked: false, leftover: false });

/** The recipe actually eaten in a slot (leftover lunches follow the previous night's dinner). */
export function slotRecipe(plan, i, meal) {
  const s = plan.days[i]?.[meal];
  if (!s || s.skipped) return null;
  if (s.leftover) {
    const prev = plan.days[i - 1]?.dinner;
    return prev && !prev.skipped ? recipe(prev.recipeId) : null;
  }
  return recipe(s.recipeId);
}

/** Every planned meal: [{ i, meal, slot, r }]. */
export function plannedMeals(plan) {
  const out = [];
  plan?.days.forEach((d, i) => MEALS.forEach((meal) => {
    const r = slotRecipe(plan, i, meal);
    if (r) out.push({ i, meal, slot: d[meal], r });
  }));
  return out;
}

/** Total quantity of each item the plan needs, in the item's unit. */
export function needs(plan) {
  const map = new Map();
  for (const { slot, r } of plannedMeals(plan)) {
    const scale = slot.servings / r.serves;
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

/** Average macros per person per day, over days with at least one planned meal. */
export function avgMacros(plan) {
  const sum = { cal: 0, protein: 0, carbs: 0, fat: 0 };
  const days = new Set();
  for (const { i, r } of plannedMeals(plan)) {
    if (!r.macros) continue;
    for (const k in sum) sum[k] += r.macros[k] || 0;
    days.add(i);
  }
  if (!days.size) return null;
  for (const k in sum) sum[k] = Math.round(sum[k] / days.size);
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

/** Turn slots on/off to match the meal-days settings, and apply the leftover-lunch setting. */
function applySchedule(plan) {
  plan.days.forEach((d, i) => {
    const dow = dayOfWeek(addDays(plan.start, i));
    for (const meal of MEALS) {
      d[meal] ||= emptySlot();
      const on = state.settings.mealDays[meal].includes(dow);
      if (!d[meal].recipeId && !d[meal].leftover) d[meal].skipped = !on;
    }
    const prevDinner = plan.days[i - 1]?.dinner;
    if (state.settings.leftoverLunch && !d.lunch.skipped && !d.lunch.locked && prevDinner && !prevDinner.skipped) {
      d.lunch.leftover = true;
      d.lunch.recipeId = null;
    }
  });
  return plan;
}

export function newPlan(start = todayIso()) {
  const days = Array.from({ length: 7 }, () => ({ breakfast: emptySlot(), lunch: emptySlot(), dinner: emptySlot() }));
  return fillPlan(applySchedule({ start, days }));
}

/** Rebuild everything except kept (🔒) meals, following the current meal-days settings. */
export function regenerate(plan) {
  const next = clonePlan(plan);
  for (const d of next.days) for (const meal of MEALS) {
    if (!(d[meal].locked && d[meal].recipeId)) Object.assign(d[meal], { recipeId: null, leftover: false, skipped: false, locked: false });
  }
  return fillPlan(applySchedule(next));
}

/** Fill only the empty open slots (e.g. after upgrading an old dinner-only plan). */
export function completePlan(plan) {
  delete plan.needsFill;
  return fillPlan(plan, { onlyEmpty: true });
}

const clonePlan = (plan) => ({ ...plan, days: plan.days.map((d) => Object.fromEntries(MEALS.map((m) => [m, { ...d[m] }]))) });

/**
 * Fill open slots (not skipped, not locked, not leftovers). Tries many random combinations and keeps
 * the one that fits the budget with the best-liked recipes.
 */
export function fillPlan(plan, { onlyEmpty = false, rand = Math.random } = {}) {
  const open = {};
  const pools = {};
  for (const meal of MEALS) {
    open[meal] = plan.days.map((d, i) => {
      const s = d[meal];
      if (s.skipped || s.leftover) return -1;
      if (onlyEmpty ? s.recipeId : s.locked && s.recipeId) return -1;
      return i;
    }).filter((i) => i >= 0);
    const openSet = new Set(open[meal]);
    const kept = new Set(plan.days.filter((d, i) => !openSet.has(i) && !d[meal].skipped && d[meal].recipeId).map((d) => d[meal].recipeId));
    let pool = candidates(meal);
    if (meal === 'dinner') pool = pool.filter((r) => !kept.has(r.id));
    if (!pool.length) pool = candidates(meal);
    if (!pool.length) pool = allRecipes().filter((r) => mealsOf(r).includes(meal));
    pools[meal] = pool;
  }
  if (!MEALS.some((m) => open[m].length)) return plan;

  const budget = Number(state.settings.budget) || 0;
  let best = null, bestScore = Infinity;
  for (let t = 0; t < 300; t++) {
    const trial = clonePlan(plan);
    let liked = 0;
    for (const meal of MEALS) {
      const slots = open[meal];
      if (!slots.length || !pools[meal].length) continue;
      const pick = weightedSample(pools[meal], Math.min(slots.length, MAX_DISTINCT[meal]), rand);
      slots.forEach((dayIdx, k) => { trial.days[dayIdx][meal].recipeId = pick[k % pick.length].id; });
      liked += pick.reduce((s, r) => s + weight(r), 0);
    }
    const total = planTotal(trial);
    const over = budget ? Math.max(0, total - budget) : 0;
    const score = over * 20 - liked + rand() * 0.5;
    if (score < bestScore) { bestScore = score; best = trial; }
  }
  return best;
}

/** Other recipes for one slot, sorted by how much they'd change the weekly total. */
export function swapOptions(plan, dayIdx, meal) {
  const current = planTotal(plan);
  const cur = plan.days[dayIdx][meal].recipeId;
  const usedDinners = new Set(plan.days.map((d) => d.dinner.recipeId));
  return candidates(meal)
    .filter((r) => r.id !== cur && !(meal === 'dinner' && usedDinners.has(r.id)))
    .map((r) => {
      const trial = clonePlan(plan);
      Object.assign(trial.days[dayIdx][meal], { recipeId: r.id, skipped: false, leftover: false });
      return { r, delta: planTotal(trial) - current };
    })
    .sort((a, b) => a.delta - b.delta);
}

/** Cost change of turning a lunch into leftovers of the previous night's dinner (null if no dinner). */
export function leftoverOption(plan, dayIdx) {
  const prev = plan.days[dayIdx - 1]?.dinner;
  if (!prev || prev.skipped || !prev.recipeId) return null;
  const trial = clonePlan(plan);
  Object.assign(trial.days[dayIdx].lunch, { recipeId: null, skipped: false, leftover: true });
  return { r: recipe(prev.recipeId), delta: planTotal(trial) - planTotal(plan) };
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
  if (!plan.days[i] || addDays(plan.start, i - 1) <= shopDate(plan)) return [];
  const seen = new Map();
  for (const meal of MEALS) {
    const s = plan.days[i][meal];
    if (s.leftover) continue; // already cooked last night
    const r = slotRecipe(plan, i, meal);
    if (r) for (const it of freezerItems(r)) seen.set(it.id, { ...it, forRecipe: r.name });
  }
  return [...seen.values()];
}

/** Items in a recipe that are usually frozen and need thawing the night before. */
export function freezerItems(r) {
  return r.ingredients.map(([id]) => item(id)).filter((it) => it?.freezer);
}
