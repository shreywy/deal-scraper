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
│   │   ├── underarmour.js   # SFCC DOM — ~24 deals ✅
│   │   ├── gymshark.js      # Algolia CA API — ~677 deals (inStock:true filter) ✅
│   │   ├── nike.js          # DOM (SSR) — ~24 deals ✅
│   │   ├── youngla.js       # Shopify custom elements — ~35 USD deals ✅
│   │   ├── clubmonaco.js    # XHR intercept + DOM — ~48 deals ✅
│   │   ├── hollister.js     # HCo clearance DOM — ~180 deals ✅
│   │   ├── abercrombie.js   # HCo clearance DOM — ~180 deals ✅
│   │   ├── bananarepublic.js# GAP Inc XHR — ~594 deals ✅
│   │   ├── aloyoga.js       # Builder.io DOM — ~31 USD deals ✅
│   │   ├── lululemon.js     # XHR + DOM — 0 (returned 0, may have no active sale) 🔲
│   │   ├── asos.js          # Browser XHR intercept — needs live test 🔲
│   │   ├── patagonia.js     # SFCC XHR + DOM — scraper written, untested 🔲
│   │   ├── gap.js           # GAP Inc XHR — scraper written, untested 🔲
│   │   ├── levis.js         # SFCC DOM — scraper written, untested 🔲
│   │   ├── sportchek.js     # XHR + DOM — scraper written, untested 🔲
│   │   ├── reigningchamp.js # Shopify API — 0 (no active sales on site) 🔲
│   │   ├── adidas.js        # PerimeterX blocked — disabled ❌
│   │   ├── northface.js     # Akamai blocked — disabled ❌
│   │   ├── uniqlo.js        # Requires live client-id — disabled ❌
│   │   ├── musinsa.js       # Location chooser blocks — disabled ❌
│   │   ├── americaneagle.js # Redirects to homepage — disabled ❌
│   │   ├── roots.js         # SFCC ISML errors — disabled ❌
│   │   ├── vuori.js         # Disabled per user preference ❌
│   │   ├── zara.js          # Akamai blocked — disabled ❌
│   │   ├── aritzia.js       # 404 / Cloudflare — disabled ❌
│   │   ├── arcteryx.js      # Sale page 404 — disabled ❌
│   │   ├── hm.js            # Akamai 403 — disabled ❌
│   │   └── frankandoak.js   # No compare_at_price — disabled ❌
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
| Gymshark CA | ~677 | Algolia CA | AppId: `2DEAES0CUO`, Key: `932fd4562e8443c09e3d14fd4ab94295`, index: `production_ca_products_v2`; inStock:true filter added |
| Nike CA | ~24 | DOM (SSR) | sale URL: `/ca/w/sale-3yaep`, price classes: `is--current-price`, `is--striked-out` |
| YoungLA | ~35 | DOM (Shopify custom elements) | USD → CAD; custom elements: `product-card`, `sale-price`, `compare-at-price` |
| Under Armour CA | ~24 | SFCC DOM | `/en-ca/c/sale/?sz=120` + outlet |
| Club Monaco CA | ~48 | XHR intercept + DOM | `clubmonaco.ca/en/sale/` — works with stealth browser |
| Hollister CA | ~180 | HCo DOM clearance page | `hollisterco.com/shop/sale/` — clearance page DOM scrape works |
| Abercrombie CA | ~180 | HCo DOM clearance page | `abercrombie.com/shop/ca/mens-sale` — DOM scrape works |
| Banana Republic CA | ~594 | GAP Inc XHR intercept | `bananarepublic.gap.com` — XHR intercept captures product API |
| Alo Yoga | ~31 | Builder.io DOM | `aloyoga.com/collections/sale` — Builder.io DOM, scroll to lazy-load |

### Needs live testing 🔲
| Store | Platform | Notes |
|-------|----------|-------|
| Lululemon CA | XHR + DOM | `--disable-http2` added; returned 0 last test (no active sale or blocked) |
| ASOS | Browser XHR intercept | XHR intercept implemented; needs live run to confirm product key |
| Patagonia CA | SFCC XHR + DOM | `patagonia.com/ca/shop/` — scraper written, untested |
| Gap CA | GAP Inc XHR + DOM | Same platform as Banana Republic — scraper written, untested |
| Levi's CA | SFCC DOM | `levi.com/en-CA/c/sale/` — scraper written, untested |
| Sport Chek | XHR + DOM | `sportchek.ca/en/sale.html` — scraper written, untested |
| Reigning Champ | Shopify API | Checked all 697 products — 0 have sale prices; store just has no active sales |

### Confirmed broken / disabled ❌
| Store | Reason |
|-------|--------|
| Zara CA | Akamai bot block — redirects to homepage |
| Aritzia | Sale page 404 / Cloudflare — disabled |
| Arc'teryx CA | Sale page 404 (moved to outlet.arcteryx.com) — disabled |
| H&M Canada | Akamai 403 even with stealth — disabled |
| Frank and Oak | No `compare_at_price` in Shopify — can't detect discounts |
| Adidas CA | PerimeterX bot protection — disabled |
| North Face CA | Akamai bot protection — disabled |
| Uniqlo CA | Requires dynamic client-id from browser session — disabled |
| Musinsa Global | Location chooser blocks automated access — disabled |
| American Eagle CA | Sale pages redirect to homepage (bot detection) — disabled |
| Roots Canada | SFCC ISML errors on sale pages — disabled |
| Vuori | Disabled per user preference |

## Known issues / TODO

- **YoungLA timeout**: Occasionally times out when run concurrently with many other stores. Retry usually works.
- **ASOS**: XHR interception implemented — needs live testing to confirm products array key.
- **Untested stores**: Patagonia, Gap, Levi's, Sport Chek scrapers written but not live-tested — run `npm start` and check /api/status.
- **Lululemon**: Returned 0 last test — may have no active sale, or still being blocked. Try again.
- **Gymshark price accuracy**: Algolia index can lag behind actual site prices. inStock:true filter now excludes OOS items.
- **Gender tagging**: FIXED — items no longer default to Unisex.
- **Store sidebar pills**: FIXED — pills use storeKey (short key from config), matching deals by storeKey field.
- **Filter persistence**: FIXED — filters saved to localStorage, survive page refresh.
- **Grid overlay during scrape**: FIXED — overlay only shows when zero cached deals exist.

## Key behaviours

- `npm start` → server starts; checks if cache is >12h old or missing → auto-scrapes in background
- Frontend on load: fetches `/api/deals` (cache), shows "Cached X deals" strip
- If server already scraping, frontend connects to live SSE stream
- `/api/refresh` SSE: streams `started` → `progress` → `partial` (per store) → `complete`
- `partial` events carry the store's deals array so grid populates progressively
- Multi-client SSE: all connected browsers receive scrape events simultaneously
- Hover refresh strip (while scraping) → popdown shows per-store progress
- 3-minute timeout per store prevents hung scrapers
- 20-minute global safety timeout clears `scrapeInProgress` flag
- `process.unhandledRejection` handler suppresses playwright-extra CDP noise after browser close

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

USD stores (YoungLA, Alo Yoga, ASOS) also have `exchangeRate` field. `price` and `originalPrice` are always CAD after conversion.

## How to add a new store

1. Create `scraper/stores/<storename>.js` exporting `async function scrape(browser, onProgress)` returning deal array
2. Add store entry to `config.json`
3. Test with: `NO_OPEN=1 node -e "const {chromium}=require('playwright-extra');const S=require('puppeteer-extra-plugin-stealth');chromium.use(S());(async()=>{const b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-http2']});const d=await require('./scraper/stores/STORE').scrape(b,console.log);console.log(d.length,'deals');await b.close()})()"`
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
// 1. Uses playwright-extra + puppeteer-extra-plugin-stealth (bypasses PerimeterX/basic bot blocks)
// 2. Chromium launch: headless:true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-http2']
//    --disable-http2 fixes ERR_HTTP2_PROTOCOL_ERROR on Lululemon and Roots
// 3. All stores run in parallel via Promise.all
// 4. Each store has 3-min timeout (Promise.race)
// 5. onPartial(key, deals, errorMsg) called as each store finishes
// 6. server.js broadcasts 'partial' SSE events to all connected clients
// 7. frontend merges partial deals into allDeals as they arrive

// To test a single store:
// cd deal-scraper && node -e "const {chromium}=require('playwright-extra');const S=require('puppeteer-extra-plugin-stealth');chromium.use(S());(async()=>{const b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-http2']});const d=await require('./scraper/stores/STORE').scrape(b,console.log);console.log(d.length,'deals');await b.close()})()"
```
