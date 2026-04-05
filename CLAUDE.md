# dealsco — Claude Context

This file gives Claude full context to pick up this project on any machine.

## What we're building

A **local Node.js app** called **dealsco** — a deal scraper that:
1. On launch, automatically runs Playwright scrapers against enabled Canadian clothing stores
2. Serves a local web UI at `http://localhost:3000`
3. Shows cached results immediately, refreshes in background via SSE
4. Displays sale items as a filterable/sortable product grid

**Cannot be hosted on GitHub Pages** — Playwright requires a real server. Architecture is Express + Playwright backend, static frontend.

## Design decisions (finalized)

- **Visual style:** Sage Frost Everforest palette — soft sage background (`#f2f5f0`), white tiles, dark green accents (`#2e4a30` / `#3d5e40`), outlined pill filters, green discount badges
- **Layout:** Fixed topbar → left sidebar (220px) → main product grid
- **Sidebar:** Sort options, grid size (− N + controls, number only — no letter label), Store/Gender/Category/Price/Discount pills. Disabled pills (grey, no click) when a filter would produce 0 results.
- **Topbar:** Logo, refresh status strip (cached→live) with hover popdown showing per-store live progress, dark mode 🌙/☀️ button, ⚙️ Settings button
- **Settings:** Full-width slide-in drawer — per-store toggles with last-scrape time + deal count
- **Dark mode:** Full Everforest dark palette (`#272e33` bg), fluid 350ms CSS variable transition
- **Product tiles:** Image, store name, product name, auto-tags, original price (strikethrough), sale price, % off badge. Click opens retailer URL in new tab.
- **Partial streaming:** As each store scrape finishes, its deals appear in the grid immediately (no waiting for all stores)
- **Filter availability:** Pills are greyed/disabled when they would return 0 results given current filter state
- **Reset button:** Appears in results bar when any filter is active

## How to run

```bash
git clone https://github.com/shreywy/deal-scraper
cd deal-scraper
npm install
npx playwright install chromium
npm start
# → http://localhost:3000
```

For dev (no auto-browser open): `NO_OPEN=1 node index.js`

## Resuming on another machine

1. `git clone https://github.com/shreywy/deal-scraper && cd deal-scraper && claude`
2. Say: "Let's continue — check CLAUDE.md for current status"

## Project structure

```
deal-scraper/
├── scraper/
│   ├── index.js          # Orchestrator — parallel scrape, partial SSE streaming, 3-min per-store timeout
│   ├── stores/
│   │   ├── underarmour.js   # SFCC DOM scraper — 24+ deals
│   │   ├── uniqlo.js        # Browser XHR intercept — currently 0 (API requires secret client-id)
│   │   ├── zara.js          # XHR intercept — currently 0 (Akamai bot block)
│   │   ├── gymshark.js      # Algolia CA API (production_ca_products_v2) — 677 CAD deals ✅
│   │   ├── nike.js          # DOM scraper (is--current-price / is--striked-out) — 72 deals ✅
│   │   ├── adidas.js        # Browser DOM — currently 0 (PerimeterX bot block)
│   │   └── youngla.js       # DOM (product-card, sale-price, compare-at-price) — 35 USD deals ✅
│   ├── tagger.js         # Auto-tags by gender + category from name keywords
│   └── currency.js       # Live USD→CAD rate from open.er-api.com (cached 1h)
├── server/
│   └── index.js          # Express: /api/deals, /api/refresh (SSE+partial), /api/status, /api/config
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── data/
│   └── deals.json        # Cached deals (gitignored)
├── config.json           # Store toggles + settings (refreshIntervalHours: 24)
├── index.js              # Entry point — starts server, opens browser (NO_OPEN=1 to skip)
└── launch.bat            # Windows double-click launcher
```

## Stores & scraper status

### Confirmed working ✅
| Store | Deals | Platform | Notes |
|-------|-------|----------|-------|
| Gymshark CA | ~677 | Algolia CA | AppId: `2DEAES0CUO`, Key: `932fd4562e8443c09e3d14fd4ab94295`, index: `production_ca_products_v2` |
| Nike CA | ~72 | DOM (SSR) | sale URL: `/ca/w/sale-3yaep`, price classes: `is--current-price`, `is--striked-out` |
| YoungLA | ~35 | DOM (Shopify custom elements) | USD → CAD; custom elements: `product-card`, `sale-price`, `compare-at-price` |
| Under Armour CA | ~24 | SFCC DOM | `/en-ca/c/sale/?sz=120` + outlet |

### New stores (need live testing) 🔲
| Store | Platform | Approach |
|-------|----------|----------|
| Lululemon CA | Custom React | XHR intercept + DOM |
| Aritzia | Custom | XHR intercept + DOM |
| Roots Canada | SFCC | DOM (same as Under Armour) |
| The North Face CA | SFCC | DOM (same as Under Armour) |
| H&M Canada | Custom | Fetch API + browser fallback |
| Arc'teryx | Custom | XHR intercept + DOM |
| Hollister CA | HCo platform | API + DOM fallback |
| Abercrombie CA | HCo platform | API + DOM fallback |
| American Eagle CA | Custom | XHR intercept + DOM |
| Alo Yoga | Shopify (browser) | DOM (API blocked) |
| Vuori | Shopify (browser) | DOM |
| Club Monaco CA | Custom | DOM |
| Banana Republic CA | GAP Inc | DOM |
| Musinsa Global | Custom | API + DOM; USD → CAD |
| ASOS | Public API | `api.asos.com/product/search/v2`; USD → CAD |
| Frank and Oak | Shopify | Disabled — no `compare_at_price` |

### Confirmed broken ❌
| Store | Reason |
|-------|--------|
| Adidas CA | PerimeterX bot block |
| Zara CA | Akamai bot block |
| Uniqlo CA | `x-fr-clientid` required, not public |

## Known issues / TODO

- **Adidas/Zara**: Bot-blocked. Try stealth Playwright or different approach.
- **Uniqlo**: v3 API (from scrapy-pg project) is dead (404). v5 API requires secret client-id.
- **YoungLA**: Only women's sale at `/collections/sale`. Men's sale URLs 404.
- **Gender tagging**: Fixed — items with no gender keyword in name are now untagged (not forced Unisex). Frontend "Unisex" filter shows truly-unisex items + untagged items.
- **New stores**: All 15 new store scrapers need live testing to validate selectors and confirm deal counts.

## Key behaviours

- `npm start` → server starts, auto-triggers scrape via SSE on browser connect
- Frontend on load: fetches `/api/deals` (cache), shows "Cached X deals" strip
- `/api/refresh` SSE: streams `started` → `progress` → `partial` (per store) → `complete`
- `partial` events carry the store's deals array so grid populates progressively
- Hover refresh strip (while scraping) → popdown shows per-store progress
- 3-minute timeout per store prevents hung scrapers
- 20-minute global safety timeout clears `scrapeInProgress` flag

## Deal object schema

```json
{
  "id": "gymshark-crest-joggers-light-grey",
  "store": "Gymshark",
  "storeKey": "gymshark",
  "name": "Crest Joggers",
  "url": "https://www.gymshark.com/products/gymshark-crest-joggers-light-grey-marl-aw22",
  "image": "https://cdn.shopify.com/s/files/...",
  "price": 33.60,
  "originalPrice": 48,
  "discount": 30,
  "currency": "CAD",
  "priceCAD": 33.60,
  "originalPriceCAD": 48,
  "tags": ["Men", "Pants"],
  "storeKey": "gymshark",
  "scrapedAt": "2026-04-05T18:00:00Z"
}
```

USD stores (YoungLA) also have `exchangeRate` field.

## How to add a new store

1. Create `scraper/stores/<storename>.js` exporting `async function scrape(browser, onProgress)` returning deal array
2. Add store entry to `config.json`
3. Test with: `node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({headless:true});const d=await require('./scraper/stores/STORE').scrape(b,console.log);console.log(d.length,'deals');await b.close();})()"` 
4. If Shopify: try `products.json` API first
5. If Algolia: intercept POST body to find index name, get appId/apiKey, query directly
6. Restart server and test via SSE

## Platform notes

- **Shopify stores**: `https://store.com/products.json?limit=250&page=N` — may be blocked, use Playwright
- **Algolia stores**: Intercept POST to `*.algolia.net`, get `x-algolia-application-id` + `x-algolia-api-key` from request headers. Filter: `compareAtPrice > 0`. Note: some brands have region-specific indices (e.g. `production_ca_products_v2` for Gymshark CA)
- **Next.js stores**: Try `window.__NEXT_DATA__` for server-rendered product data
- **SFCC stores**: UA-style `?sz=120` param to get all products in one page
- **Inditex (Zara/Pull&Bear)**: XHR intercept, but Akamai-blocked in headless
- **GAP Inc. (BR/Gap/Old Navy)**: Same platform, try XHR intercept

## Scraper architecture

```js
// scraper/index.js key points:
// 1. All stores run in parallel via Promise.all
// 2. Each store has 3-min timeout (Promise.race)
// 3. onPartial(key, deals) called as each store finishes
// 4. server.js /api/refresh emits 'partial' SSE events per store
// 5. frontend merges partial deals into allDeals as they arrive
```
