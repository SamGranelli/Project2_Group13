// App state, persisted to localStorage on the device. Nothing leaves the phone.
import { CATALOG, RECIPES } from './data.js';

const KEY = 'supperplan:v1';

export const MEALS = ['breakfast', 'lunch', 'dinner'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export const defaultState = () => ({
  settings: {
    budget: 110,         // weekly grocery budget, $
    servings: 2,         // default people per meal
    store: '',           // just a label for the list
    shopDay: 0,          // 0 = Sunday
    // Which weekdays (0 = Sunday) each meal gets planned. An empty list turns that meal off.
    mealDays: { breakfast: [...ALL_DAYS], lunch: [1, 2, 3, 4, 5], dinner: [0, 1, 2, 3, 4] },
    leftoverLunch: false, // fill lunch with extra servings of the night before's dinner
    diet: 'any',         // any | vegetarian | vegan
    avoid: '',           // comma-separated words, e.g. "shrimp, mushroom"
    maxMinutes: 0,       // 0 = no limit
    skipStaples: true,   // assume spices/oil/soy sauce are already in the pantry
  },
  prices: {},            // itemId -> price override
  packs: {},             // itemId -> pack size override
  customItems: {},       // itemId -> catalog entry created by imported recipes
  customRecipes: [],
  ratings: {},           // recipeId -> 1..5
  favorites: [],
  // { start: 'YYYY-MM-DD', days: [{ breakfast: slot, lunch: slot, dinner: slot }] }
  // slot = { recipeId, servings, skipped, locked, leftover }
  plan: null,
  list: { checked: {}, have: {}, extras: [] },
  tab: 'plan',
  notice: null,          // one-time message shown on the Plan tab
});

function merge(saved) {
  const base = defaultState();
  const next = { ...base, ...saved, settings: { ...base.settings, ...saved.settings }, list: { ...base.list, ...saved.list } };
  // Upgrade from the dinner-only version: keep the dinner nights, add breakfast & lunch.
  if (saved.settings && !saved.settings.mealDays) {
    next.settings.mealDays = { ...base.settings.mealDays, dinner: saved.settings.cookDays || base.settings.mealDays.dinner };
    delete next.settings.cookDays;
    if (saved.plan) next.notice = 'meals-added';
  }
  if (next.plan?.days?.[0] && 'recipeId' in next.plan.days[0]) {
    const s = next.settings.servings;
    const [y, m, day] = next.plan.start.split('-').map(Number);
    const { mealDays } = next.settings;
    next.plan.days = next.plan.days.map((d, i) => {
      const dow = new Date(y, m - 1, day + i).getDay();
      const slot = (meal) => ({ recipeId: null, servings: s, skipped: !mealDays[meal].includes(dow), locked: false, leftover: false });
      return { breakfast: slot('breakfast'), lunch: slot('lunch'), dinner: { leftover: false, ...d } };
    });
    next.plan.needsFill = true;
  }
  return next;
}

export let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return merge(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

export function replaceState(next) {
  state = merge(next);
  save();
}

export function resetState() {
  state = defaultState();
  save();
}

export const item = (id) => {
  const base = state.customItems[id] || CATALOG[id];
  if (!base) return null;
  return { ...base, id, price: state.prices[id] ?? base.price, pack: state.packs[id] ?? base.pack };
};

export const allItemIds = () => [...Object.keys(CATALOG), ...Object.keys(state.customItems)];
export const allRecipes = () => [...RECIPES, ...state.customRecipes];
export const recipe = (id) => allRecipes().find((r) => r.id === id) || null;
export const mealsOf = (r) => r.meals || ['dinner'];
