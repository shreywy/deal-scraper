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
│   │   ├── underarmour.js   # SFCC DOM scraper — 24 deals ✅
│   │   ├── uniqlo.js        # Browser XHR intercept — 0 (API requires secret client-id) ❌
│   │   ├── zara.js          # XHR intercept — 0 (Akamai bot block) ❌
│   │   ├── gymshark.js      # Algolia CA API — 677 CAD deals ✅
│   │   ├── nike.js          # DOM scraper — 48 deals ✅
│   │   ├── adidas.js        # Browser DOM — 0 (PerimeterX bot block) ❌
│   │   ├── youngla.js       # DOM (Shopify custom elements) — 35 USD deals ✅
│   │   ├── lululemon.js     # Playwright XHR + DOM — 0 (ERR_HTTP2, needs fix) 🔲
│   │   ├── aritzia.js       # Playwright XHR + DOM — 0 (Cloudflare block) ❌
│   │   ├── roots.js         # SFCC Playwright — 0 (ERR_HTTP2 on roots.com) 🔲
│   │   ├── northface.js     # SFCC Playwright — 0 (Access Denied, bot-blocked) ❌
│   │   ├── hm.js            # Fetch API + Playwright — 0 (Access Denied) ❌
│   │   ├── arcteryx.js      # Playwright XHR + DOM — 0 (untested) 🔲
│   │   ├── hollister.js     # HCo API + DOM — 0 (untested) 🔲
│   │   ├── abercrombie.js   # HCo API + DOM — 0 (untested) 🔲
│   │   ├── americaneagle.js # Playwright DOM — 0 (untested) 🔲
│   │   ├── aloyoga.js       # Playwright DOM — 0 (untested) 🔲
│   │   ├── vuori.js         # Next.js __NEXT_DATA__ + DOM — 0 (untested) 🔲
│   │   ├── clubmonaco.js    # Playwright XHR + DOM — 0 (untested) 🔲
│   │   ├── bananarepublic.js# GAP Inc Playwright — 0 (untested) 🔲
│   │   ├── musinsa.js       # Global API + DOM — 0 (location redirect issue) 🔲
│   │   ├── asos.js          # Public API — 0 (API 404, needs endpoint fix) 🔲
│   │   └── frankandoak.js   # Disabled — no compare_at_price ❌
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
| Nike CA | ~48 | DOM (SSR) | sale URL: `/ca/w/sale-3yaep`, price classes: `is--current-price`, `is--striked-out` |
| YoungLA | ~35 | DOM (Shopify custom elements) | USD → CAD; custom elements: `product-card`, `sale-price`, `compare-at-price` |
| Under Armour CA | ~24 | SFCC DOM | `/en-ca/c/sale/?sz=120` + outlet |

### New stores — need selector fixes 🔲
| Store | Issue | What to try next |
|-------|-------|-----------------|
| Lululemon CA | ERR_HTTP2_PROTOCOL_ERROR on `lululemon.com/en-ca/c/sale/` | Try `shop.lululemon.com/c/sale` or intercept XHR from browser session |
| Roots Canada | ERR_HTTP2 on `roots.com/ca/en/sale/?sz=120` | The URL `roots.com/ca/en/sale/?sz=120` returns 200 in fetch but HTTP2 error in Playwright — add `--disable-http2` flag or try `waitUntil: 'load'` |
| Arc'teryx | Untested | Try `arcteryx.com/ca/en/c/sale/` with longer wait |
| Hollister CA | Untested | Try `hollisterco.com/shop/ca/guys-sale` DOM or HCo API with `onSale=true` |
| Abercrombie CA | Untested | Try `abercrombie.com/shop/ca/mens-sale` DOM |
| American Eagle CA | Untested | Try `ae.com/ca/en/content/category/mens-clearance-sale` DOM |
| Alo Yoga | Untested | Try `aloyoga.com/collections/sale` with scroll |
| Vuori | Untested (Next.js) | Try `vuoriclothing.com/collections/sale` — check `__NEXT_DATA__` first |
| Club Monaco CA | Untested | Try `clubmonaco.ca/en/sale/` |
| Banana Republic CA | Untested | Try `bananarepublic.gap.com` sale page |
| Musinsa Global | Redirects to location chooser | Add cookie `country_code=US` or visit location page first to set session |
| ASOS | API 404 | `api.asos.com/product/search/v2/categories/8799/products` returns 404 — find correct endpoint by intercepting browser XHR on asos.com/men/sale/cat/?cid=8799 |

### Confirmed broken ❌
| Store | Reason |
|-------|--------|
| Adidas CA | PerimeterX bot block |
| Zara CA | Akamai bot block |
| Uniqlo CA | `x-fr-clientid` required, not public |
| North Face CA | Access Denied (bot block on headless) |
| H&M Canada | Access Denied (bot block) |
| Aritzia | Cloudflare "Just a moment..." (bot block) |
| Frank and Oak | No `compare_at_price` in Shopify — can't detect discounts |

## Known issues / TODO

- **New stores**: Multiple stores returning 0 — see "need selector fixes" table above. Main issues are bot-blocking (TNF, H&M, Aritzia) and wrong URLs/HTTP2 errors (Lululemon, Roots).
- **Lululemon ERR_HTTP2**: Try adding `args: ['--disable-http2']` to Chromium launch options in scraper/index.js, or use a different URL.
- **Roots ERR_HTTP2**: Same fix — the URL works in fetch but Playwright gets HTTP2 error. Try `--disable-http2`.
- **ASOS API**: The `/product/search/v2/categories/{id}/products` endpoint returns 404. Need to intercept the real API from browser session on `asos.com`.
- **Musinsa redirect**: Visit `global.musinsa.com/choose-location` first to set location cookie, then navigate to sale page.
- **Gender tagging**: FIXED — items no longer default to Unisex. Result: ~288 Men, ~389 Women, ~22 Unisex, ~84 untagged per scrape.
- **Store sidebar pills**: FIXED — pills now built from config (all enabled stores show even with 0 deals).

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
  "scrapedAt": "2026-04-05T18:00:00Z"
}
```

USD stores (YoungLA, Alo Yoga, Vuori, ASOS, Musinsa) also have `exchangeRate` field. `price` and `originalPrice` are always CAD after conversion.

## How to add a new store

1. Create `scraper/stores/<storename>.js` exporting `async function scrape(browser, onProgress)` returning deal array
2. Add store entry to `config.json`
3. Test with: `NO_OPEN=1 node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({headless:true,args:['--no-sandbox']});const d=await require('./scraper/stores/STORE').scrape(b,console.log);console.log(d.length,'deals');await b.close()})()"`
4. If Shopify: try `products.json` API first — many block it, fall back to Playwright
5. If Algolia: intercept POST body to find index name, get appId/apiKey, query directly
6. Restart server and test via SSE

## Platform notes

- **Shopify stores**: `https://store.com/collections/sale/products.json?limit=250&page=N` — often blocked (403/404); use Playwright
- **Algolia stores**: Intercept POST to `*.algolia.net`, get `x-algolia-application-id` + `x-algolia-api-key`. Filter: `compareAtPrice > 0`. Region-specific indices exist (e.g. `production_ca_products_v2` for Gymshark CA)
- **Next.js stores**: Try `window.__NEXT_DATA__?.props?.pageProps` for SSR product data (Vuori is Next.js + Netlify)
- **SFCC stores**: UA-style `?sz=120` param. URL pattern: `/en-ca/c/sale/?sz=120`. ERR_HTTP2 issue → try `--disable-http2` Chromium flag
- **HCo platform** (Hollister/Abercrombie): API at `hollisterco.com/api/ecomm/10200/products/search` and `abercrombie.com/api/ecomm/11300/products/search` with `onSale=true&country=CA`
- **GAP Inc.** (Banana Republic/Gap/Old Navy): Same platform; try XHR intercept
- **Inditex (Zara)**: XHR intercept, Akamai-blocked in headless
- **Cloudflare-protected**: Aritzia, H&M, North Face — headless Playwright gets blocked; try stealth mode or skip

## Scraper architecture

```js
// scraper/index.js key points:
// 1. All stores run in parallel via Promise.all
// 2. Each store has 3-min timeout (Promise.race)
// 3. onPartial(key, deals) called as each store finishes
// 4. server.js /api/refresh emits 'partial' SSE events per store
// 5. frontend merges partial deals into allDeals as they arrive
// 6. Chromium launch: headless:true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']
//    Consider adding '--disable-http2' to fix ERR_HTTP2 on roots.com/lululemon.com
```
