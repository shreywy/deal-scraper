# dealsco — Claude Context

This file gives Claude full context to pick up this project on any machine.

## What we're building

A **local Node.js app** called **dealsco** — a deal scraper that:
1. On launch, automatically runs Playwright scrapers against enabled Canadian clothing stores
2. Serves a local web UI at `http://localhost:3000`
3. Shows cached results immediately with a disclaimer banner, refreshes in background
4. Displays sale items as a filterable/sortable product grid

**Cannot be hosted on GitHub Pages** — Playwright requires a real server. Architecture is Express + Playwright backend, static frontend.

## Design decisions (finalized)

- **Visual style:** Sage Frost Everforest palette — soft sage background (`#f2f5f0`), white tiles, dark green accents (`#2e4a30` / `#3d5e40`), outlined pill filters, green discount badges
- **Layout:** Fixed topbar → left sidebar (220px) → main product grid
- **Sidebar:** Sort options, grid size (− N + buttons), Gender pills, Category pills (auto-populated from scrape), Price range pills, Min. discount pills
- **Topbar:** Logo, refresh status strip (cached→live), dark mode 🌙/☀️ button, ⚙️ Settings button
- **Settings:** Full-width slide-in drawer from right — per-store toggles with last-scrape time + deal count, behaviour toggles, min. discount stepper. No "add store" button (stores added via Claude)
- **Dark mode:** Full Everforest dark palette (`#272e33` bg), fluid 350ms CSS variable transition
- **Product tiles:** Image (aspect-ratio 1:1), store name, product name, auto-tags, original price (strikethrough), sale price, % off badge. Hover lifts tile. Click opens retailer URL in new tab.
- **Animations:** All transitions use `cubic-bezier(0.4, 0, 0.2, 1)`. Tiles fade up on load. Settings drawer slides in. Filter pills animate on active.

## Mockup

The finalized design mockup is at:
`.superpowers/brainstorm/*/content/design-final.html`
Open it directly in a browser to see the full interactive design.

## Stores & platforms

| Store | Sale URL | Platform | Status |
|-------|----------|----------|--------|
| Under Armour CA | /en-ca/c/sale/ | Salesforce Commerce Cloud (SFCC) | scraper pending |
| Uniqlo Canada | /ca/en/... | Fast Retailing custom | scraper pending |
| Zara Canada | zara.com/ca/en/ | Inditex custom | scraper pending |

### Platform groupings (for reusing scrapers)
- **Inditex:** Zara, Pull&Bear, Bershka, Massimo Dutti, Stradivarius — same frontend, URL pattern changes
- **GAP Inc.:** Old Navy, Gap, Banana Republic — same platform
- **Abercrombie & Fitch:** Hollister, Abercrombie — same platform
- **SFCC cluster:** Under Armour, likely Adidas — needs confirmation
- **Fast Retailing:** Uniqlo, GU — same platform

Scraping research agents were dispatched but hit rate limits. Re-run when implementing scrapers.

## Project structure (planned)

```
deal-scraper/
├── scraper/
│   ├── index.js          # Orchestrator — runs all enabled scrapers in parallel
│   ├── stores/
│   │   ├── underarmour.js
│   │   ├── uniqlo.js
│   │   └── zara.js
│   └── tagger.js         # Auto-tag items from product name/category
├── server/
│   └── index.js          # Express: serves frontend + /api/deals + /api/refresh
├── frontend/
│   ├── index.html        # Main storefront UI
│   ├── style.css
│   └── app.js
├── data/
│   └── deals.json        # Cached deals (gitignored)
├── config.json           # Enabled stores, settings
└── docs/
    └── superpowers/specs/
        └── 2026-04-04-deal-scraper-design.md
```

## Key behaviours

- `npm start` → starts server, immediately triggers a background scrape, opens browser
- Frontend on load: fetches `/api/deals` (returns cache instantly), shows "refreshing" banner
- `/api/refresh` SSE endpoint streams scrape progress back to frontend
- When scrape completes, frontend swaps to new data, banner goes green "Up to date"
- Stores are toggled in `config.json` via the Settings drawer

## How to add a new store

1. Create `scraper/stores/<storename>.js` exporting `async function scrape()` returning array of deal objects
2. Add store entry to `config.json`
3. If the store shares a platform with an existing store, base the new scraper on that one

## Deal object schema

```json
{
  "id": "ua-hovr-phantom-3",
  "store": "Under Armour",
  "name": "HOVR Phantom 3 Running Shoe",
  "url": "https://www.underarmour.ca/...",
  "image": "https://...",
  "price": 62,
  "originalPrice": 89,
  "discount": 30,
  "tags": ["Men", "Footwear", "Activewear"],
  "scrapedAt": "2026-04-04T01:00:00Z"
}
```

## Current implementation status

### DONE ✅
- `package.json` — npm project, scripts: `npm start`, `npm run scrape`
- `config.json` — store toggles + settings
- `scraper/tagger.js` — auto-tags products by gender + category from name keywords
- `scraper/stores/underarmour.js` — Playwright DOM scraper (SFCC site, scrapes /sale/ + /outlet/, tries window.__STORE_STATE__ first then DOM)
- `scraper/stores/uniqlo.js` — tries JSON API first (`/api/commerce/v5/en/products?path=/sale`), falls back to XHR intercept, then DOM
- `scraper/stores/zara.js` — Playwright + XHR intercept (multiple sale URLs), falls back to DOM
- `scraper/index.js` — orchestrator, runs all scrapers in parallel, caches to `data/deals.json`
- `server/index.js` — Express server: `/api/deals`, `/api/refresh` (SSE), `/api/config` GET+PATCH
- `index.js` — entry point, starts server + auto-opens browser (scrape triggered by frontend SSE connection)
- `frontend/index.html` — full storefront HTML
- `frontend/style.css` — complete Sage Frost + dark mode CSS
- `frontend/app.js` — full frontend JS: SSE refresh stream, filtering, sorting, settings drawer, dark mode, grid resize

### TODO 🔲
- Test each scraper against live sites (scrapers may need selector tuning once we see real page structure)
- Test end-to-end: `npm start` → browser opens → deals load → refresh completes

### Known issues / next steps
- Scraping research agents hit rate limits mid-run — selectors in scrapers are best-guess from public knowledge. Run `npm run scrape` and check what each site actually returns, then tune selectors.
- Zara's API paths change periodically — XHR intercept is the most resilient approach
- Uniqlo API URL might need adjustment — the scraper tries the JSON API first then falls back to DOM

## How to run

```bash
git clone https://github.com/shreywy/deal-scraper
cd deal-scraper
npm install
npx playwright install chromium
npm start
# → http://localhost:3000
```

## Resuming on another machine

1. Clone: `git clone https://github.com/shreywy/deal-scraper`
2. `cd deal-scraper && claude`
3. Claude loads this CLAUDE.md automatically
4. Say: "Let's continue — test the scrapers and fix any selector issues"
