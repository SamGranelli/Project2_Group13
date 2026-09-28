# 🍽️ SupperPlan

A free budget dinner planner for your phone. It plans a week of dinners under your grocery budget and gives you one priced shopping list.

It's a web app you install on your home screen (a PWA). No app store, no account, no subscription. Your data stays on your phone and it works offline.

## Features

- **Weekly plan under budget.** Set a weekly budget and household size, and it picks dinners that fit. It buys whole packs and prefers recipes that share ingredients.
- **Change the week.** Swap any dinner (the list shows how each option changes your total, like **+$1.20** or **−$0.85**). You can also move dinners between days, skip nights, change servings, and 🔒 lock dinners you want to keep when you regenerate.
- **Priced shopping list** grouped by aisle. Tap a price to set what your store charges; it's remembered. You can mark items you already have, add your own items (milk, snacks…), and share or copy the list.
- **Macros.** Calories, protein, carbs and fat per serving, plus a weekly average.
- **Your own recipes.** Paste a recipe from a website, video caption or notes, then tap **Auto-fill**. It pulls out the title, ingredients and steps and matches each ingredient to a grocery item and price.
- **Cook mode.** Step by step with big text, and the screen stays on.
- **Ratings and favorites.** 4–5★ dinners come up more often; 1★ dinners are never picked.
- **Reminders.** Adds your shopping day and "move the chicken to the fridge tonight" thaw reminders to your phone's calendar.
- **Preferences.** Vegetarian or vegan, a max cook time, and ingredients to never include.
- **Backup and restore** to a file, so you can move to a new phone.

It includes 24 budget dinners. Prices are rough US averages; edit them in **Settings → Prices** to match your store.

## Put it on your phone

It has to be served over HTTPS once. After that it runs offline. The easiest free option is GitHub Pages:

1. On GitHub, open this repo, then **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, pick this branch and the `/ (root)` folder, and click **Save**.
3. After a minute you get a link like `https://<your-username>.github.io/Project2_Group13/`.
4. Open that link on your phone:
   - **iPhone (Safari):** Share button → **Add to Home Screen**.
   - **Android (Chrome):** ⋮ menu → **Install app** (or **Add to Home screen**).

(GitHub Pages is free for public repos. If this repo is private, make it public or use another free static host such as Netlify or Cloudflare Pages. It's just static files, so drag and drop the folder.)

## Run it on your computer

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

There's no build step and no dependencies. It's plain HTML, CSS and JavaScript.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `css/styles.css` | App shell and styles (light and dark mode) |
| `js/data.js` | Built-in grocery items (with prices) and recipes: add more here |
| `js/planner.js` | Budget math, week generation, swap pricing |
| `js/parse.js` | Turns pasted recipe text into ingredients |
| `js/ics.js` | Calendar reminders file |
| `js/store.js` | Saves everything to the device |
| `js/app.js` | Screens and interactions |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and install-to-home-screen |

## Not included (vs. TapCook)

- **Live store prices.** Real prices need a paid grocery API. SupperPlan uses estimates that you can correct once and it remembers them.
- **What other users liked.** That needs a server. Your own ratings shape your plans instead.
