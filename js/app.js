import { AISLE_ORDER } from './data.js';
import { state, save, item, allItemIds, allRecipes, recipe, replaceState, resetState } from './store.js';
import {
  todayIso, addDays, parseDate, dayOfWeek, candidates, groceryRows, planTotal, costPerServing, avgMacros,
  newPlan, fillPlan, swapOptions, thawFor,
} from './planner.js';
import { parseLine, matchItem, convert, splitRecipeText } from './parse.js';
import { buildIcs } from './ics.js';

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const fmtDate = (iso) => parseDate(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dayLabel = (iso) => `${DOW[dayOfWeek(iso)]} · ${fmtDate(iso)}`;

const FRAC = [[0, ''], [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.5, '½'], [2 / 3, '⅔'], [0.75, '¾'], [1, '']];
function fmtQty(q) {
  if (q >= 10) return String(Math.round(q));
  const whole = Math.floor(q), rest = q - whole;
  let best = FRAC[0], bestD = 1;
  for (const f of FRAC) { const d = Math.abs(rest - f[0]); if (d < bestD) { bestD = d; best = f; } }
  if (bestD > 0.06) return String(Math.round(q * 10) / 10);
  const w = best[0] === 1 ? whole + 1 : whole;
  return (w ? String(w) : '') + best[1] || '0';
}
const unitLabel = (u, q) => (u === 'each' ? '' : q > 1 && !['oz', 'lb', 'tbsp', 'tsp'].includes(u) ? u + 's' : u);
const amount = (q, u) => `${fmtQty(q)} ${unitLabel(u, q)}`.trim();

const ui = { recipeFilter: 'all', recipeQuery: '', priceQuery: '', sheetServings: null, cook: null, wakeLock: null };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function commit() { save(); render(); }

// ---------- render root ----------
function render() {
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === state.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const p = state.plan;
  $('#subtitle').textContent = p ? `${fmtDate(p.start)} – ${fmtDate(addDays(p.start, 6))}` : '';
  const view = $('#view');
  const scroll = window.scrollY;
  view.innerHTML = { plan: viewPlan, list: viewList, recipes: viewRecipes, settings: viewSettings }[state.tab]();
  window.scrollTo(0, scroll);
}

// ---------- Plan ----------
function onboarding() {
  return `
  <div class="card stack">
    <h2>Plan a week of dinners 👋</h2>
    <p class="muted">Set a budget and we'll build the week to come in under it — with one priced shopping list. Everything stays on your phone.</p>
    <div class="two">
      <label class="field"><span>Weekly budget ($)</span><input type="number" inputmode="decimal" min="0" data-set="budget" value="${esc(state.settings.budget)}"></label>
      <label class="field"><span>People per dinner</span><input type="number" inputmode="numeric" min="1" max="12" data-set="servings" value="${esc(state.settings.servings)}"></label>
    </div>
    <label class="field"><span>Diet</span>${dietSelect()}</label>
    <div class="field"><span class="small muted" style="font-weight:700">Nights you cook</span>${cookDayChips()}</div>
    <button class="btn primary block" data-act="build">Build my week</button>
  </div>`;
}

function alerts(p) {
  const out = [];
  const today = todayIso();
  const idx = Math.round((parseDate(today) - parseDate(p.start)) / 864e5);
  if (idx > 6) {
    out.push(`<div class="alert info"><span>📆</span><div class="grow">This week's plan has ended.</div><button class="btn sm primary" data-act="next-week">Plan next week</button></div>`);
  }
  if (dayOfWeek(today) === state.settings.shopDay && idx <= 6) {
    out.push(`<div class="alert good"><span>🛒</span><div class="grow">It's shopping day${state.settings.store ? ' at ' + esc(state.settings.store) : ''} — list total ${money(planTotal(p))}.</div><button class="btn sm" data-tab="list">List</button></div>`);
  }
  if (idx >= 0 && idx <= 6) {
    const d = p.days[idx];
    const r = d && !d.skipped && recipe(d.recipeId);
    if (r) out.push(`<div class="alert info"><span>${r.emoji || '🍽️'}</span><div class="grow">Tonight: <b>${esc(r.name)}</b></div><button class="btn sm primary" data-act="cook" data-id="${r.id}" data-serv="${d.servings}">Cook</button></div>`);
  }
  if (idx >= -1 && idx <= 5) {
    const frozen = thawFor(p, idx + 1);
    const r = frozen.length && recipe(p.days[idx + 1].recipeId);
    if (frozen.length) out.push(`<div class="alert warn"><span>🧊</span><div>Move <b>${esc(frozen.map((f) => f.name.toLowerCase()).join(', '))}</b> to the fridge tonight for tomorrow's ${esc(r.name)}.</div></div>`);
  }
  return out.join('');
}

function viewPlan() {
  const p = state.plan;
  if (!p) return onboarding();
  const total = planTotal(p);
  const budget = Number(state.settings.budget) || 0;
  const over = budget && total > budget;
  const pct = budget ? Math.min(100, (total / budget) * 100) : 0;
  const m = avgMacros(p);
  const dinners = p.days.filter((d) => !d.skipped && d.recipeId).length;
  const today = todayIso();

  const days = p.days.map((d, i) => {
    const iso = addDays(p.start, i);
    const head = `<div class="day-head"><span class="day-label ${iso === today ? 'today' : ''}">${iso === today ? 'Today · ' + fmtDate(iso) : dayLabel(iso)}</span>
      ${!d.skipped && d.recipeId ? `<button class="icon-btn ${d.locked ? 'on' : ''}" data-act="lock" data-i="${i}" aria-label="${d.locked ? 'Unlock' : 'Keep'} this dinner" title="Keep when regenerating">${d.locked ? '🔒' : '🔓'}</button>` : ''}</div>`;
    if (d.skipped) {
      return `<article class="card day off">${head}<div class="row between"><span class="muted">Night off 🌙</span><button class="btn sm" data-act="unskip" data-i="${i}">Plan a dinner</button></div></article>`;
    }
    const r = recipe(d.recipeId);
    if (!r) {
      return `<article class="card day">${head}<div class="row between"><span class="muted">No dinner picked</span><span class="row"><button class="btn sm primary" data-act="swap" data-i="${i}">Choose</button><button class="btn sm ghost" data-act="skip" data-i="${i}">Night off</button></span></div></article>`;
    }
    return `<article class="card day">${head}
      <button class="day-main" data-act="open" data-id="${r.id}" data-serv="${d.servings}">
        <span class="emoji">${r.emoji || '🍽️'}</span>
        <span class="grow"><span class="day-name">${esc(r.name)}</span><br>
        <span class="small muted">${r.minutes} min · ${money(costPerServing(r))}/serving${r.macros ? ' · ' + r.macros.cal + ' cal' : ''}</span></span>
      </button>
      <div class="day-actions">
        <span class="stepper"><button data-act="serv" data-i="${i}" data-d="-1" aria-label="Fewer servings">−</button><span>${d.servings} ${d.servings === 1 ? 'serving' : 'servings'}</span><button data-act="serv" data-i="${i}" data-d="1" aria-label="More servings">+</button></span>
        <button class="btn sm" data-act="swap" data-i="${i}">⇄ Swap</button>
        <button class="btn sm" data-act="move" data-i="${i}">↕ Move</button>
        <button class="btn sm ghost" data-act="skip" data-i="${i}">Skip</button>
      </div>
    </article>`;
  }).join('');

  return `
    ${alerts(p)}
    <div class="card">
      <div class="row between">
        <div><div class="small muted">Groceries this week</div><div class="budget-big" style="color:${over ? 'var(--bad)' : 'inherit'}">${money(total)}</div></div>
        <div style="text-align:right"><div class="small muted">Budget</div><div style="font-weight:700">${budget ? money(budget) : '—'}</div></div>
      </div>
      ${budget ? `<div class="meter ${over ? 'over' : ''}"><div style="width:${pct}%"></div></div>
      <div class="small ${over ? '' : 'muted'}" style="${over ? 'color:var(--bad);font-weight:600' : ''}">${over ? `${money(total - budget)} over — try swapping a dinner or tap Regenerate` : `${money(budget - total)} left · ${dinners} dinners · ${money(dinners ? total / p.days.reduce((s, d) => s + (d.skipped || !d.recipeId ? 0 : d.servings), 0) : 0)}/serving`}</div>` : ''}
      ${m ? `<div class="macros"><div><b>${m.cal}</b><span>cal</span></div><div><b>${m.protein}g</b><span>protein</span></div><div><b>${m.carbs}g</b><span>carbs</span></div><div><b>${m.fat}g</b><span>fat</span></div></div><div class="small muted" style="text-align:center;margin-top:4px">avg per serving</div>` : ''}
      <div class="row" style="margin-top:12px">
        <button class="btn grow" data-act="regen">🎲 Regenerate</button>
        <button class="btn primary grow" data-tab="list">🛒 Shopping list</button>
      </div>
    </div>
    ${days}
    <div class="row" style="justify-content:center;margin-top:8px"><button class="btn ghost small" data-act="next-week">Start a new week →</button></div>`;
}

// ---------- Shopping list ----------
function listText() {
  const rows = groceryRows(state.plan).filter((r) => r.counts);
  const lines = [`Shopping list${state.settings.store ? ' — ' + state.settings.store : ''} (${money(planTotal(state.plan))})`];
  for (const aisle of AISLE_ORDER) {
    const group = rows.filter((r) => (r.it.aisle || 'Other') === aisle);
    if (!group.length) continue;
    lines.push('', aisle.toUpperCase());
    for (const r of group) lines.push(`☐ ${r.it.name} — ${r.packs} × ${amount(r.it.pack, r.it.unit)} (${money(r.cost)})`);
  }
  if (state.list.extras.length) {
    lines.push('', 'MY ITEMS');
    for (const e of state.list.extras) lines.push(`☐ ${e.name}${Number(e.price) ? ` (${money(Number(e.price))})` : ''}`);
  }
  return lines.join('\n');
}

function viewList() {
  const p = state.plan;
  if (!p) return `<div class="empty"><div class="big">🛒</div><p>Build a plan first and your shopping list shows up here.</p><button class="btn primary" data-tab="plan">Go to Plan</button></div>`;
  const rows = groceryRows(p);
  const total = planTotal(p);
  const budget = Number(state.settings.budget) || 0;
  const checked = state.list.checked;
  const toBuy = rows.filter((r) => r.counts);
  const boughtCount = toBuy.filter((r) => checked[r.id]).length + state.list.extras.filter((e) => e.checked).length;
  const allCount = toBuy.length + state.list.extras.length;

  const rowHtml = (r) => `
    <div class="list-item ${checked[r.id] ? 'done' : ''}">
      <input type="checkbox" data-check="${r.id}" ${checked[r.id] ? 'checked' : ''} aria-label="Got ${esc(r.it.name)}">
      <div class="grow"><div class="li-name">${esc(r.it.name)}</div>
        <div class="small muted">${r.packs} × ${esc(amount(r.it.pack, r.it.unit))} · recipes use ${esc(amount(r.need, r.it.unit))}</div></div>
      <button class="btn sm ghost" data-act="have" data-id="${r.id}" title="Already have it">Have</button>
      <button class="li-price" data-act="edit-price" data-id="${r.id}" aria-label="Edit price">${money(r.cost)}</button>
    </div>`;

  let groups = '';
  for (const aisle of AISLE_ORDER) {
    const g = toBuy.filter((r) => (r.it.aisle || 'Other') === aisle);
    if (g.length) groups += `<div class="section-title">${aisle}</div><div class="card" style="padding:4px 12px">${g.map(rowHtml).join('')}</div>`;
  }

  const extras = state.list.extras.map((e, i) => `
    <div class="list-item ${e.checked ? 'done' : ''}">
      <input type="checkbox" data-extra-check="${i}" ${e.checked ? 'checked' : ''} aria-label="Got ${esc(e.name)}">
      <div class="grow li-name">${esc(e.name)}</div>
      <span class="li-price">${Number(e.price) ? money(Number(e.price)) : ''}</span>
      <button class="icon-btn" data-act="del-extra" data-i="${i}" aria-label="Remove">✕</button>
    </div>`).join('');

  const have = rows.filter((r) => r.have);
  const staples = rows.filter((r) => r.staple && !r.have);

  return `
    <div class="card">
      <div class="row between">
        <div><div class="small muted">${state.settings.store ? esc(state.settings.store) : 'Estimated total'}</div><div class="budget-big">${money(total)}</div></div>
        <div style="text-align:right" class="small muted">${boughtCount}/${allCount} in cart${budget ? `<br>${total > budget ? `<b style="color:var(--bad)">${money(total - budget)} over</b>` : `${money(budget - total)} under budget`}` : ''}</div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn grow" data-act="share-list">📤 Share</button>
        <button class="btn grow" data-act="clear-checks">Uncheck all</button>
      </div>
      <p class="small muted" style="margin-top:8px">Prices are estimates — tap any price to set what your store charges. It's remembered for next time.</p>
    </div>
    ${groups}
    <div class="section-title">My items</div>
    <div class="card" style="padding:4px 12px 12px">
      ${extras}
      <form class="row" data-form="add-extra" style="margin-top:10px">
        <input type="text" name="name" placeholder="Add item (e.g. milk)" class="grow" required>
        <input type="number" name="price" placeholder="$" step="0.01" min="0" inputmode="decimal" style="width:80px">
        <button class="btn primary" type="submit" aria-label="Add">＋</button>
      </form>
    </div>
    ${have.length ? `<div class="section-title">Already have</div><div class="card" style="padding:4px 12px">${have.map((r) => `
      <div class="list-item"><div class="grow"><div class="li-name muted">${esc(r.it.name)}</div><div class="small muted">need ${esc(amount(r.need, r.it.unit))}</div></div>
      <button class="btn sm" data-act="have" data-id="${r.id}">Need it</button></div>`).join('')}</div>` : ''}
    ${staples.length ? `<details class="card"><summary><b>Pantry staples</b> <span class="muted small">(${staples.length}, not counted)</span></summary>
      <p class="small muted">Assumed on hand. Turn this off in Settings if you need to buy them.</p>
      ${staples.map((r) => `<div class="list-item"><div class="grow">${esc(r.it.name)}</div><span class="small muted">${esc(amount(r.need, r.it.unit))}</span></div>`).join('')}
    </details>` : ''}`;
}

// ---------- Recipes ----------
const FILTERS = [['all', 'All'], ['fav', '♥ Favorites'], ['mine', 'My recipes'], ['quick', '≤ 25 min'], ['vegetarian', 'Vegetarian'], ['cheap', 'Under $2.50'], ['high-protein', 'High protein'], ['kid-friendly', 'Kid-friendly']];

function stars(n) { return n ? `<span class="stars" aria-label="${n} stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>` : ''; }

function viewRecipes() {
  const q = ui.recipeQuery.toLowerCase();
  const f = ui.recipeFilter;
  const list = allRecipes().filter((r) => {
    if (q && !(r.name + ' ' + r.tags.join(' ')).toLowerCase().includes(q)) return false;
    if (f === 'fav') return state.favorites.includes(r.id);
    if (f === 'mine') return r.custom;
    if (f === 'quick') return r.minutes <= 25;
    if (f === 'cheap') return costPerServing(r) < 2.5;
    if (f === 'vegetarian') return r.tags.includes('vegetarian') || r.tags.includes('vegan');
    if (f !== 'all') return r.tags.includes(f);
    return true;
  }).sort((a, b) => (state.favorites.includes(b.id) - state.favorites.includes(a.id)) || ((state.ratings[b.id] || 3) - (state.ratings[a.id] || 3)) || a.name.localeCompare(b.name));

  return `
    <input type="search" placeholder="Search recipes" data-input="recipeQuery" value="${esc(ui.recipeQuery)}" aria-label="Search recipes">
    <div class="chips" style="margin:10px 0 12px">${FILTERS.map(([k, l]) => `<button class="chip" data-act="filter" data-f="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
    <button class="btn primary block" data-act="add-recipe" style="margin-bottom:12px">＋ Add your own recipe</button>
    ${list.length ? `<div class="grid">${list.map((r) => `
      <button class="rcard" data-act="open" data-id="${r.id}">
        <span class="emoji">${r.emoji || '🍽️'}</span>
        <span class="rcard-name">${state.favorites.includes(r.id) ? '♥ ' : ''}${esc(r.name)}</span>
        <span class="small muted">${r.minutes} min · ${money(costPerServing(r))}/serv</span>
        ${stars(state.ratings[r.id])}
      </button>`).join('')}</div>` : `<div class="empty"><div class="big">🔍</div><p>No recipes match.</p></div>`}`;
}

// ---------- Settings ----------
function dietSelect() {
  const d = state.settings.diet;
  return `<select data-set="diet">${[['any', 'Anything'], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan']].map(([v, l]) => `<option value="${v}" ${d === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
}
function cookDayChips() {
  return `<div class="chips" style="margin-top:6px">${DOW.map((n, i) => `<button class="chip" data-act="cookday" data-d="${i}" aria-pressed="${state.settings.cookDays.includes(i)}">${n}</button>`).join('')}</div>`;
}

function viewSettings() {
  const s = state.settings;
  return `
    <div class="section-title">Your week</div>
    <div class="card">
      <div class="two">
        <label class="field"><span>Weekly budget ($)</span><input type="number" inputmode="decimal" min="0" data-set="budget" value="${esc(s.budget)}"></label>
        <label class="field"><span>People per dinner</span><input type="number" inputmode="numeric" min="1" max="12" data-set="servings" value="${esc(s.servings)}"></label>
      </div>
      <div class="two">
        <label class="field"><span>Your store</span><input type="text" data-set="store" placeholder="e.g. Aldi on Main St" value="${esc(s.store)}"></label>
        <label class="field"><span>Shopping day</span><select data-set="shopDay">${DOW_FULL.map((n, i) => `<option value="${i}" ${s.shopDay === i ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <div class="field"><span class="small muted" style="font-weight:700">Nights you cook</span>${cookDayChips()}</div>
    </div>

    <div class="section-title">Food preferences</div>
    <div class="card">
      <div class="two">
        <label class="field"><span>Diet</span>${dietSelect()}</label>
        <label class="field"><span>Max cook time</span><select data-set="maxMinutes">${[[0, 'Any'], [20, '20 min'], [30, '30 min'], [45, '45 min']].map(([v, l]) => `<option value="${v}" ${Number(s.maxMinutes) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Never include (comma separated)</span><input type="text" data-set="avoid" placeholder="e.g. shrimp, mushroom" value="${esc(s.avoid)}"></label>
      <label class="toggle"><span>I already have pantry staples<br><span class="small muted">Oil, spices, soy sauce, honey… not counted in the budget</span></span><input type="checkbox" data-set="skipStaples" ${s.skipStaples ? 'checked' : ''}></label>
    </div>

    <div class="section-title">Prices</div>
    <div class="card">
      <p class="small muted">Match the prices to your store so budgets are accurate.</p>
      <button class="btn block" data-act="prices">Edit grocery prices (${allItemIds().length} items)</button>
    </div>

    <div class="section-title">Reminders</div>
    <div class="card">
      <p class="small muted">Adds your shopping day and "thaw tonight" reminders for this week to your phone's calendar, with alerts.</p>
      <button class="btn block" data-act="ics" ${state.plan ? '' : 'disabled'}>📅 Add this week's reminders to calendar</button>
    </div>

    <div class="section-title">Your data</div>
    <div class="card stack">
      <p class="small muted">Everything is saved only on this device. Back it up to move to a new phone.</p>
      <div class="row"><button class="btn grow" data-act="export">⬇️ Back up</button><button class="btn grow" data-act="import">⬆️ Restore</button></div>
      <input type="file" id="import-file" accept="application/json,.json" hidden>
      <button class="btn block danger" data-act="reset">Erase everything</button>
    </div>
    <p class="small muted" style="text-align:center;margin-top:18px">SupperPlan · free & open · works offline</p>`;
}

// ---------- Sheets ----------
function openSheet(html) {
  const sheet = $('#sheet');
  if (!history.state?.overlay) history.pushState({ overlay: 1 }, '');
  sheet.innerHTML = `<div class="grab"></div>${html}`;
  sheet.hidden = false;
  $('#backdrop').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet(fromPop = false) {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.hidden = true;
  $('#backdrop').hidden = true;
  document.body.style.overflow = '';
  if (!fromPop && $('#cook').hidden && history.state?.overlay) history.back();
}
const sheetHead = (title) => `<div class="sheet-head"><h2>${title}</h2><button class="icon-btn" data-act="close" aria-label="Close">✕</button></div>`;

function openRecipe(id, servings) {
  const r = recipe(id);
  if (!r) return;
  if (servings) ui.sheetServings = Number(servings);
  const serv = ui.sheetServings || state.settings.servings;
  ui.sheetRecipe = id;
  const scale = serv / r.serves;
  const fav = state.favorites.includes(id);
  const rating = state.ratings[id] || 0;
  openSheet(`
    ${sheetHead('')}
    <div class="hero"><span class="emoji">${r.emoji || '🍽️'}</span><div><h2>${esc(r.name)}</h2>
      <div class="small muted">${r.minutes} min · ${money(costPerServing(r))}/serving · ${r.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div></div></div>
    ${r.macros ? `<div class="macros"><div><b>${r.macros.cal}</b><span>cal</span></div><div><b>${r.macros.protein}g</b><span>protein</span></div><div><b>${r.macros.carbs}g</b><span>carbs</span></div><div><b>${r.macros.fat}g</b><span>fat</span></div></div><div class="small muted" style="text-align:center;margin-top:4px">per serving</div>` : ''}
    <div class="row between" style="margin:14px 0 4px">
      <div>${[1, 2, 3, 4, 5].map((n) => `<button class="star-btn ${n <= rating ? 'on' : ''}" data-act="rate" data-v="${n}" aria-label="Rate ${n}">★</button>`).join('')}</div>
      <button class="icon-btn ${fav ? 'on' : ''}" data-act="fav" aria-label="Favorite">${fav ? '♥' : '♡'}</button>
    </div>
    <p class="small muted">Rate dinners after you cook them — 4–5★ show up more often, 1★ never gets picked.</p>
    <div class="row" style="margin:12px 0">
      <button class="btn primary grow" data-act="cook" data-id="${id}" data-serv="${serv}">👩‍🍳 Start cooking</button>
      <button class="btn grow" data-act="add-to-plan">＋ Add to week</button>
    </div>
    <div class="row between" style="margin-top:16px"><h3>Ingredients</h3>
      <span class="stepper"><button data-act="sheet-serv" data-d="-1" aria-label="Fewer servings">−</button><span>${serv} serv</span><button data-act="sheet-serv" data-d="1" aria-label="More servings">+</button></span></div>
    <ul class="ings">${r.ingredients.map(([iid, q]) => { const it = item(iid); return `<li><b>${esc(amount(q * scale, it?.unit || ''))}</b><span>${esc(it?.name || iid)}</span></li>`; }).join('')}</ul>
    <h3 style="margin-top:16px">Steps</h3>
    <ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${r.source ? `<p class="small muted">Source: ${esc(r.source)}</p>` : ''}
    ${r.custom ? `<div class="row" style="margin-top:12px"><button class="btn grow" data-act="edit-recipe">Edit</button><button class="btn grow danger" data-act="del-recipe">Delete</button></div>` : ''}`);
}

function openSwap(i) {
  const p = state.plan;
  const opts = swapOptions(p, i);
  const cur = recipe(p.days[i].recipeId);
  openSheet(`${sheetHead(`Swap ${DOW_FULL[dayOfWeek(addDays(p.start, i))]}`)}
    ${cur ? `<p class="small muted">Now: ${esc(cur.name)}. Price change shows the effect on your weekly total.</p>` : ''}
    ${opts.length ? opts.map(({ r, delta }) => `
      <button class="pick" data-act="do-swap" data-i="${i}" data-id="${r.id}">
        <span class="emoji">${r.emoji || '🍽️'}</span>
        <span class="grow"><b>${esc(r.name)}</b><br><span class="small muted">${r.minutes} min${r.macros ? ' · ' + r.macros.cal + ' cal' : ''} ${stars(state.ratings[r.id])}</span></span>
        <span class="delta ${delta > 0.005 ? 'up' : delta < -0.005 ? 'down' : ''}">${delta > 0.005 ? '+' : delta < -0.005 ? '−' : '±'}${money(Math.abs(delta))}</span>
      </button>`).join('') : '<p class="muted">No other recipes match your preferences. Add your own in Recipes.</p>'}`);
}

function openMove(i) {
  const p = state.plan;
  openSheet(`${sheetHead('Move to…')}
    ${p.days.map((d, j) => j === i ? '' : `<button class="pick" data-act="do-move" data-i="${i}" data-j="${j}">
      <span class="grow"><b>${dayLabel(addDays(p.start, j))}</b><br><span class="small muted">${d.skipped ? 'Night off' : esc(recipe(d.recipeId)?.name || 'Empty')}</span></span>
      <span class="small muted">${d.skipped || !d.recipeId ? 'Move here' : 'Swap'}</span></button>`).join('')}`);
}

function openAddToPlan() {
  const id = ui.sheetRecipe;
  if (!state.plan) state.plan = { start: todayIso(), days: Array.from({ length: 7 }, () => ({ recipeId: null, servings: state.settings.servings, skipped: false, locked: false })) };
  const p = state.plan;
  openSheet(`${sheetHead('Add to which night?')}
    ${p.days.map((d, j) => `<button class="pick" data-act="do-add" data-j="${j}" data-id="${id}">
      <span class="grow"><b>${dayLabel(addDays(p.start, j))}</b><br><span class="small muted">${d.skipped ? 'Night off' : esc(recipe(d.recipeId)?.name || 'Empty')}</span></span>
      <span class="small muted">${d.skipped || !d.recipeId ? 'Add' : 'Replace'}</span></button>`).join('')}`);
}

function openPrices() {
  const q = ui.priceQuery.toLowerCase();
  const ids = allItemIds().filter((id) => !q || item(id).name.toLowerCase().includes(q)).sort((a, b) => item(a).name.localeCompare(item(b).name));
  const body = ids.map((id) => {
    const it = item(id);
    return `<div class="list-item"><div class="grow"><div class="li-name">${esc(it.name)}</div><div class="small muted">${esc(it.aisle || 'Other')}</div></div>
      <label class="small muted" style="width:88px">Pack (${esc(it.unit)})<input type="number" step="any" min="0.01" inputmode="decimal" data-pack="${id}" value="${it.pack}"></label>
      <label class="small muted" style="width:88px">Price $<input type="number" step="0.01" min="0" inputmode="decimal" data-price="${id}" value="${it.price.toFixed(2)}"></label></div>`;
  }).join('');
  if ($('#price-rows')) { $('#price-rows').innerHTML = body; return; }
  openSheet(`${sheetHead('Grocery prices')}
    <input type="search" placeholder="Search items" data-input="priceQuery" value="${esc(ui.priceQuery)}">
    <div id="price-rows">${body}</div>
    <button class="btn block ghost" data-act="reset-prices" style="margin-top:12px">Reset all prices to defaults</button>`);
}

// ---------- Add / edit recipe ----------
const RECIPE_TAGS = ['vegetarian', 'vegan', 'kid-friendly', 'high-protein', 'freezer-friendly', 'soup', 'mexican', 'italian', 'asian'];

function openRecipeForm(editId) {
  const r = editId ? recipe(editId) : null;
  ui.editingId = editId || null;
  const ingText = r ? r.ingredients.map(([id, q]) => `${fmtQty(q)} ${item(id)?.unit === 'each' ? '' : item(id)?.unit || ''} ${item(id)?.name || id}`.replace(/\s+/g, ' ')).join('\n') : '';
  openSheet(`${sheetHead(r ? 'Edit recipe' : 'Add a recipe')}
    ${r ? '' : `<details class="card" open style="box-shadow:none"><summary><b>Paste a recipe</b> <span class="small muted">from a website, video caption, or notes</span></summary>
      <textarea id="paste" placeholder="Paste the whole recipe here — title, ingredients and steps."></textarea>
      <button class="btn block" data-act="autofill" style="margin-top:8px">✨ Auto-fill the form</button></details>`}
    <form data-form="recipe" autocomplete="off">
      <div class="row"><label class="field" style="width:70px"><span>Emoji</span><input type="text" name="emoji" maxlength="4" value="${esc(r?.emoji || '🍽️')}"></label>
        <label class="field grow"><span>Name</span><input type="text" name="name" required value="${esc(r?.name || '')}"></label></div>
      <div class="two">
        <label class="field"><span>Serves</span><input type="number" name="serves" min="1" inputmode="numeric" value="${r?.serves || 4}"></label>
        <label class="field"><span>Minutes</span><input type="number" name="minutes" min="1" inputmode="numeric" value="${r?.minutes || 30}"></label>
      </div>
      <label class="field"><span>Ingredients (one per line)</span><textarea name="ingredients" placeholder="1.5 lb chicken thighs&#10;2 bell peppers&#10;1 cup rice">${esc(ingText)}</textarea></label>
      <button class="btn block" type="button" data-act="match">🔎 Match ingredients to prices</button>
      <div id="match-area" style="margin-top:10px"></div>
      <label class="field"><span>Steps (one per line)</span><textarea name="steps">${esc(r?.steps.join('\n') || '')}</textarea></label>
      <div class="field"><span class="small muted" style="font-weight:700">Tags</span><div class="chips" style="flex-wrap:wrap">${RECIPE_TAGS.map((t) => `<label class="chip"><input type="checkbox" name="tag" value="${t}" ${r?.tags.includes(t) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
      <div class="field"><span class="small muted" style="font-weight:700">Per serving (optional)</span><div class="four">
        ${['cal', 'protein', 'carbs', 'fat'].map((k) => `<label class="small muted">${k}<input type="number" name="m_${k}" min="0" inputmode="numeric" value="${r?.macros?.[k] ?? ''}"></label>`).join('')}</div></div>
      <label class="field"><span>Source link (optional)</span><input type="text" name="source" value="${esc(r?.source || '')}"></label>
      <button class="btn primary block" type="submit">Save recipe</button>
    </form>`);
  if (r) runMatch();
}

function itemOptions(selected) {
  const ids = allItemIds().sort((a, b) => item(a).name.localeCompare(item(b).name));
  return `<option value="__new" ${!selected ? 'selected' : ''}>➕ New item</option>` + ids.map((id) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(item(id).name)} (${esc(item(id).unit)})</option>`).join('');
}

function runMatch() {
  const form = $('form[data-form="recipe"]');
  const lines = form.ingredients.value.split('\n').map((l) => l.trim()).filter(Boolean);
  const area = $('#match-area');
  if (!lines.length) { area.innerHTML = '<p class="small muted">Add some ingredients first.</p>'; return; }
  area.innerHTML = `<p class="small muted">Check each match so your budget math is right. Amounts are in the item's unit.</p>` + lines.map((line, k) => {
    const { qty, unit, name } = parseLine(line);
    const id = matchItem(name, state.customItems);
    let q = qty ?? 1, warn = false;
    if (id) {
      const it = item(id);
      const target = it.unit;
      if (unit && unit !== target) { const c = convert(q, unit, target); if (c == null) warn = true; else q = c; }
      else if (!unit && target !== 'each' && qty != null && !['clove', 'can', 'bunch', 'slice', 'stalk'].includes(target)) warn = true;
    }
    q = Math.round(q * 100) / 100;
    return `<div class="match-row ${warn || !id ? 'warn' : ''}" data-k="${k}">
      <div class="line">“${esc(line)}”${warn ? ' — check the amount' : ''}</div>
      <div class="match-controls">
        <select data-match-sel data-name="${esc(name)}" data-unit="${esc(unit || 'each')}">${itemOptions(id)}</select>
        <input type="number" step="any" min="0" inputmode="decimal" data-match-qty value="${q}" aria-label="Amount">
      </div>
      <div class="small muted" data-match-unit>${id ? esc(item(id).unit) : `new item · ${esc(unit || 'each')} · set its price in Settings → Prices`}</div>
    </div>`;
  }).join('');
}

function saveRecipe(form) {
  const name = form.name.value.trim();
  if (!name) return;
  if (!$('#match-area').children.length) runMatch();
  const ingredients = [];
  for (const row of document.querySelectorAll('.match-row')) {
    const sel = row.querySelector('[data-match-sel]');
    const qty = Number(row.querySelector('[data-match-qty]').value) || 0;
    let id = sel.value;
    if (id === '__new') {
      const nm = sel.dataset.name.replace(/^\w/, (c) => c.toUpperCase());
      id = 'my_' + nm.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);
      if (!item(id)) state.customItems[id] = { name: nm, aisle: 'Other', unit: sel.dataset.unit || 'each', pack: qty || 1, price: 0 };
    }
    if (qty > 0) ingredients.push([id, qty]);
  }
  const macros = {};
  let hasMacros = false;
  for (const k of ['cal', 'protein', 'carbs', 'fat']) { const v = form[`m_${k}`].value; if (v !== '') { macros[k] = Number(v); hasMacros = true; } }
  const data = {
    id: ui.editingId || 'my-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + Date.now().toString(36),
    name, emoji: form.emoji.value.trim() || '🍽️', custom: true,
    serves: Math.max(1, Number(form.serves.value) || 4), minutes: Math.max(1, Number(form.minutes.value) || 30),
    tags: [...form.querySelectorAll('input[name=tag]:checked')].map((c) => c.value),
    macros: hasMacros ? { cal: 0, protein: 0, carbs: 0, fat: 0, ...macros } : null,
    ingredients,
    steps: form.steps.value.split('\n').map((s) => s.replace(/^(step\s*)?\d+[.):]?\s*/i, '').trim()).filter(Boolean),
    source: form.source.value.trim(),
  };
  const idx = state.customRecipes.findIndex((r) => r.id === data.id);
  if (idx >= 0) state.customRecipes[idx] = data; else state.customRecipes.push(data);
  save();
  const newItems = ingredients.filter(([id]) => state.customItems[id] && !state.customItems[id].price).length;
  toast(newItems ? `Saved! Set prices for ${newItems} new item${newItems > 1 ? 's' : ''} in Settings.` : 'Recipe saved');
  ui.sheetServings = null;
  openRecipe(data.id);
  render();
}

// ---------- Cook mode ----------
async function openCook(id, servings) {
  const r = recipe(id);
  if (!r) return;
  closeSheet(true); // cook mode takes over the sheet's history entry
  ui.cook = { id, step: -1, servings: Number(servings) || state.settings.servings };
  renderCook();
  $('#cook').hidden = false;
  if (!history.state?.overlay) history.pushState({ overlay: 1 }, '');
  try { ui.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not supported */ }
}
function renderCook() {
  const { id, step, servings } = ui.cook;
  const r = recipe(id);
  const n = r.steps.length;
  const scale = servings / r.serves;
  const body = step < 0
    ? `<div style="font-size:1.1rem;font-weight:500"><h2 style="margin-bottom:10px">Get these ready</h2><ul class="ings">${r.ingredients.map(([iid, q]) => `<li><b>${esc(amount(q * scale, item(iid)?.unit || ''))}</b><span>${esc(item(iid)?.name || iid)}</span></li>`).join('')}</ul></div>`
    : `<div class="small muted" style="font-size:.9rem;margin-bottom:8px">STEP ${step + 1} OF ${n}</div>${esc(r.steps[step])}`;
  $('#cook').innerHTML = `
    <div class="row between"><b>${r.emoji || ''} ${esc(r.name)}</b><button class="icon-btn" data-act="close-cook" aria-label="Close">✕</button></div>
    <div class="cook-progress" style="margin:12px 0"><div style="width:${((step + 1) / n) * 100}%"></div></div>
    <div class="cook-step">${body}</div>
    <div class="cook-nav">
      <button class="btn" data-act="cook-step" data-d="-1" ${step < 0 ? 'disabled' : ''}>← Back</button>
      ${step >= n - 1 ? `<button class="btn primary" data-act="cook-done">Done! Rate it</button>` : `<button class="btn primary" data-act="cook-step" data-d="1">${step < 0 ? 'Start →' : 'Next step →'}</button>`}
    </div>`;
}
function closeCook(fromPop = false) {
  if ($('#cook').hidden) return;
  $('#cook').hidden = true;
  ui.wakeLock?.release?.();
  ui.wakeLock = null;
  if (!fromPop && history.state?.overlay) history.back();
}

// ---------- actions ----------
const act = {
  build() {
    state.plan = newPlan();
    state.list.checked = {};
    commit();
    toast('Your week is ready');
  },
  regen() {
    state.plan = fillPlan(state.plan);
    commit();
    toast('New dinners picked (🔒 ones kept)');
  },
  'next-week'() {
    if (!confirm('Start a new week? Your current plan will be replaced.')) return;
    const p = state.plan;
    const next = p ? addDays(p.start, 7) : todayIso();
    state.plan = newPlan(next < todayIso() ? todayIso() : next);
    state.list.checked = {};
    state.list.have = {};
    state.list.extras.forEach((e) => { e.checked = false; });
    commit();
  },
  lock(el) { const d = state.plan.days[el.dataset.i]; d.locked = !d.locked; commit(); },
  skip(el) { const d = state.plan.days[el.dataset.i]; d.skipped = true; d.locked = false; commit(); },
  unskip(el) {
    const i = Number(el.dataset.i);
    const d = state.plan.days[i];
    d.skipped = false;
    if (!d.recipeId || state.plan.days.some((o, j) => j !== i && o.recipeId === d.recipeId && !o.skipped)) {
      const best = swapOptions(state.plan, i)[0];
      d.recipeId = best?.r.id || null;
    }
    commit();
  },
  serv(el) {
    const d = state.plan.days[el.dataset.i];
    d.servings = Math.min(20, Math.max(1, d.servings + Number(el.dataset.d)));
    commit();
  },
  swap(el) { openSwap(Number(el.dataset.i)); },
  'do-swap'(el) {
    const d = state.plan.days[el.dataset.i];
    d.recipeId = el.dataset.id;
    d.skipped = false;
    closeSheet();
    commit();
  },
  move(el) { openMove(Number(el.dataset.i)); },
  'do-move'(el) {
    const days = state.plan.days, i = Number(el.dataset.i), j = Number(el.dataset.j);
    [days[i], days[j]] = [days[j], days[i]];
    closeSheet();
    commit();
  },
  open(el) { ui.sheetServings = null; openRecipe(el.dataset.id, el.dataset.serv); },
  close() { closeSheet(); },
  'sheet-serv'(el) {
    ui.sheetServings = Math.min(20, Math.max(1, (ui.sheetServings || state.settings.servings) + Number(el.dataset.d)));
    const top = $('#sheet').scrollTop;
    openRecipe(ui.sheetRecipe);
    $('#sheet').scrollTop = top;
  },
  rate(el) {
    const v = Number(el.dataset.v);
    if (state.ratings[ui.sheetRecipe] === v) delete state.ratings[ui.sheetRecipe]; else state.ratings[ui.sheetRecipe] = v;
    save();
    const top = $('#sheet').scrollTop;
    openRecipe(ui.sheetRecipe);
    $('#sheet').scrollTop = top;
    render();
  },
  fav() {
    const id = ui.sheetRecipe;
    state.favorites = state.favorites.includes(id) ? state.favorites.filter((f) => f !== id) : [...state.favorites, id];
    save();
    const top = $('#sheet').scrollTop;
    openRecipe(id);
    $('#sheet').scrollTop = top;
    render();
  },
  'add-to-plan'() { openAddToPlan(); },
  'do-add'(el) {
    const d = state.plan.days[el.dataset.j];
    d.recipeId = el.dataset.id;
    d.skipped = false;
    if (ui.sheetServings) d.servings = ui.sheetServings;
    closeSheet();
    state.tab = 'plan';
    commit();
    toast('Added to your week');
  },
  cook(el) { openCook(el.dataset.id, el.dataset.serv); },
  'cook-step'(el) {
    ui.cook.step = Math.max(-1, Math.min(recipe(ui.cook.id).steps.length - 1, ui.cook.step + Number(el.dataset.d)));
    renderCook();
  },
  'cook-done'() { const id = ui.cook.id; closeCook(true); ui.sheetServings = null; openRecipe(id); },
  'close-cook'() { closeCook(); },

  have(el) {
    const id = el.dataset.id;
    if (state.list.have[id]) delete state.list.have[id]; else state.list.have[id] = true;
    commit();
  },
  'edit-price'(el) {
    const it = item(el.dataset.id);
    const v = prompt(`Price at your store for ${it.name} (${amount(it.pack, it.unit) || '1'})`, it.price.toFixed(2));
    if (v == null) return;
    const n = parseFloat(v.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n >= 0) { state.prices[it.id] = n; commit(); toast('Price saved'); }
  },
  'clear-checks'() { state.list.checked = {}; state.list.extras.forEach((e) => { e.checked = false; }); commit(); },
  'del-extra'(el) { state.list.extras.splice(Number(el.dataset.i), 1); commit(); },
  async 'share-list'() {
    const text = listText();
    try {
      if (navigator.share) await navigator.share({ title: 'Shopping list', text });
      else { await navigator.clipboard.writeText(text); toast('List copied'); }
    } catch (e) {
      if (e?.name !== 'AbortError') { try { await navigator.clipboard.writeText(text); toast('List copied'); } catch { toast('Could not share'); } }
    }
  },

  filter(el) { ui.recipeFilter = el.dataset.f; render(); },
  'add-recipe'() { openRecipeForm(); },
  'edit-recipe'() { openRecipeForm(ui.sheetRecipe); },
  'del-recipe'() {
    if (!confirm('Delete this recipe?')) return;
    const id = ui.sheetRecipe;
    state.customRecipes = state.customRecipes.filter((r) => r.id !== id);
    state.plan?.days.forEach((d) => { if (d.recipeId === id) d.recipeId = null; });
    closeSheet();
    commit();
  },
  autofill() {
    const text = $('#paste').value;
    if (!text.trim()) return toast('Paste a recipe first');
    const s = splitRecipeText(text);
    const f = $('form[data-form="recipe"]');
    if (s.title) f.name.value = s.title.slice(0, 80);
    if (s.serves) f.serves.value = s.serves;
    if (s.minutes) f.minutes.value = s.minutes;
    f.ingredients.value = s.ingredients.join('\n');
    f.steps.value = s.steps.join('\n');
    const lower = text.toLowerCase();
    if (!/chicken|beef|pork|turkey|sausage|bacon|shrimp|salmon|fish|tuna|meat/.test(lower)) f.querySelector('input[value=vegetarian]').checked = true;
    const cal = text.match(/(\d{2,4})\s*(?:kcal|calories)/i);
    if (cal) f.m_cal.value = cal[1];
    const prot = text.match(/protein\s*:?\s*(\d+)\s*g/i);
    if (prot) f.m_protein.value = prot[1];
    $('#paste').closest('details').open = false;
    runMatch();
    toast(s.ingredients.length ? `Found ${s.ingredients.length} ingredients & ${s.steps.length} steps` : 'Filled what we could — check the form');
  },
  match() { runMatch(); },

  cookday(el) {
    const d = Number(el.dataset.d);
    const cd = state.settings.cookDays;
    state.settings.cookDays = cd.includes(d) ? cd.filter((x) => x !== d) : [...cd, d].sort();
    commit();
  },
  prices() { ui.priceQuery = ''; openPrices(); },
  'reset-prices'() {
    if (!confirm('Reset all prices and pack sizes to the built-in estimates?')) return;
    state.prices = {}; state.packs = {};
    save();
    $('#price-rows').remove();
    openPrices();
    render();
  },
  ics() {
    if (!state.plan) return;
    download(`supperplan-${state.plan.start}.ics`, buildIcs(state.plan), 'text/calendar');
    toast('Open the file to add the reminders');
  },
  export() { download(`supperplan-backup-${todayIso()}.json`, JSON.stringify(state, null, 2), 'application/json'); },
  import() { $('#import-file').click(); },
  reset() {
    if (!confirm('Erase all plans, recipes, ratings and prices on this device?')) return;
    resetState();
    render();
  },
};

// ---------- event wiring ----------
document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    closeSheet();
    state.tab = tab.dataset.tab;
    save();
    render();
    window.scrollTo(0, 0);
    return;
  }
  const el = e.target.closest('[data-act]');
  if (el && act[el.dataset.act]) { e.preventDefault(); act[el.dataset.act](el, e); }
});

$('#backdrop').addEventListener('click', () => closeSheet());
window.addEventListener('popstate', () => { closeSheet(true); closeCook(true); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeCook(); closeSheet(); } });

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.set) {
    const k = t.dataset.set;
    let v = t.type === 'checkbox' ? t.checked : t.value;
    if (['budget', 'servings', 'shopDay', 'maxMinutes'].includes(k)) v = Number(v) || 0;
    if (k === 'servings') v = Math.max(1, v);
    state.settings[k] = v;
    commit();
  } else if (t.dataset.check) {
    if (t.checked) state.list.checked[t.dataset.check] = true; else delete state.list.checked[t.dataset.check];
    commit();
  } else if (t.dataset.extraCheck != null) {
    state.list.extras[Number(t.dataset.extraCheck)].checked = t.checked;
    commit();
  } else if (t.dataset.price) {
    const n = parseFloat(t.value);
    if (Number.isFinite(n) && n >= 0) { state.prices[t.dataset.price] = n; save(); render(); }
  } else if (t.dataset.pack) {
    const n = parseFloat(t.value);
    if (Number.isFinite(n) && n > 0) { state.packs[t.dataset.pack] = n; save(); render(); }
  } else if (t.matches('[data-match-sel]')) {
    const unitEl = t.closest('.match-row').querySelector('[data-match-unit]');
    unitEl.textContent = t.value === '__new' ? `new item · ${t.dataset.unit}` : item(t.value).unit;
  } else if (t.id === 'import-file' && t.files[0]) {
    t.files[0].text().then((txt) => {
      try {
        const data = JSON.parse(txt);
        if (!data.settings) throw new Error('bad');
        replaceState(data);
        render();
        toast('Backup restored');
      } catch { toast("That file isn't a SupperPlan backup"); }
    });
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.input === 'recipeQuery') {
    ui.recipeQuery = t.value;
    render();
    const s = $('[data-input="recipeQuery"]');
    s.focus();
    s.setSelectionRange(s.value.length, s.value.length);
  } else if (t.dataset.input === 'priceQuery') {
    ui.priceQuery = t.value;
    openPrices();
  }
});

document.addEventListener('submit', (e) => {
  const f = e.target;
  if (f.dataset.form === 'add-extra') {
    e.preventDefault();
    const name = f.name.value.trim();
    if (!name) return;
    state.list.extras.push({ name, price: parseFloat(f.price.value) || 0, checked: false });
    commit();
    $('form[data-form="add-extra"] input[name=name]')?.focus();
  } else if (f.dataset.form === 'recipe') {
    e.preventDefault();
    saveRecipe(f);
  }
});

// ---------- boot ----------
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
