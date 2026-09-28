// App state, persisted to localStorage on the device. Nothing leaves the phone.
import { CATALOG, RECIPES } from './data.js';

const KEY = 'supperplan:v1';

export const defaultState = () => ({
  settings: {
    budget: 60,          // weekly grocery budget, $
    servings: 2,         // default people per dinner
    store: '',           // just a label for the list
    shopDay: 0,          // 0 = Sunday
    cookDays: [0, 1, 2, 3, 4],   // Sun–Thu; Fri/Sat are nights off by default
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
  plan: null,            // { start: 'YYYY-MM-DD', days: [{ recipeId, servings, skipped, locked }] }
  list: { checked: {}, have: {}, extras: [] },
  tab: 'plan',
});

export let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const base = defaultState();
    return { ...base, ...saved, settings: { ...base.settings, ...saved.settings }, list: { ...base.list, ...saved.list } };
  } catch {
    return defaultState();
  }
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
}

export function replaceState(next) {
  const base = defaultState();
  state = { ...base, ...next, settings: { ...base.settings, ...next.settings }, list: { ...base.list, ...next.list } };
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
