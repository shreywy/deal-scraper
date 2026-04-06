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
│   │   ├── lululemon.js     # Disabled — sale pages have no original prices ❌
│   │   ├── asos.js          # Browser XHR intercept — ECONNRESET on direct fetch 🔲
│   │   ├── patagonia.js     # SFCC DOM — 36-178 deals ✅
│   │   ├── gap.js           # GAP Inc XHR — 0 (sale pages redirect currently) 🔲
│   │   ├── levis.js         # SFCC DOM — 0 (Access Denied, bot block) ❌
│   │   ├── sportchek.js     # FGL XHR intercept — 28 deals (first page only) ✅
│   │   ├── reigningchamp.js # Shopify API — 0 (store has no active sales) 🔲
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

## Stores & scraper status (as of 2026-04-05)

26 stores enabled. Total expected deals: ~3000+ on fresh scrape.

### Confirmed working ✅
| Store | ~Deals | Platform | Notes |
|-------|--------|----------|-------|
| Gymshark CA | ~677 | Algolia CA | AppId: `2DEAES0CUO`, Key: `932fd4562e8443c09e3d14fd4ab94295`, index: `production_ca_products_v2`; inStock:true filter |
| Banana Republic CA | ~620 | GAP Inc XHR intercept | `api.gap.com/commerce/search` — XHR captures product API |
| RW&CO | ~534 | Shopify API | `/collections/men-promo-upto40` and `/collections/women-promo-upto40` |
| Alphalete | ~400 | Shopify API | `collections/sale/products.json`; USD→CAD |
| Dickies | ~256 | Shopify API | `dickies.com/collections/sale/products.json`; USD→CAD |
| SSENSE | ~240 | DOM (Cloudflare stealth) | `ssense.com/en-ca/men/sale` + women; `.plp-products__product-tile` selectors |
| Hollister CA | ~180 | HCo DOM clearance page | `hollisterco.com/shop/sale/` — clearance page DOM scrape |
| Abercrombie CA | ~180 | HCo DOM clearance page | `abercrombie.com/shop/ca/mens-sale` — DOM scrape |
| Puma | ~192 | DOM (Shopify) | `us.puma.com/us/en/sale`; USD→CAD |
| Nobull | ~66 | Shopify API | `nobull.com/collections/sale/products.json`; USD→CAD |
| Marks | ~82 | FGL API | `marks.com/api/v1/search/v2/search`, key: `c01ef3612328420c9f5cd9277e815a0e` |
| Club Monaco CA | ~48 | XHR intercept + DOM | `clubmonaco.ca/en/sale/` |
| Carhartt | ~48 | DOM (SFCC) | `carhartt.com` promo pages; USD→CAD |
| MEC | ~52 | DOM (Next.js) | `mec.ca/en/products/sale`; Chakra UI product cards |
| Altitude Sports | ~48 | DOM (Chakra UI) | `altitude-sports.com/collections/sale`; `article[data-testid="plp-product-card"]` |
| Rhone | ~30 | DOM (Vue.js) | `rhone.com` sale collection; `.product-card` selectors; CAD |
| Alo Yoga | ~31 | Builder.io DOM | `aloyoga.com/collections/sale`; scroll to lazy-load; CAD (shows CAD prices to Canadian visitors) |
| Patagonia CA | ~36 | SFCC DOM | `patagonia.com/ca/shop/`; "M's"/"W's" names tagged via tagger |
| Sporting Life | ~36 | SFCC DOM | `sportinglife.ca/en-CA/sale/`; `.product-tile`, `.price-sales`, `.price-standard` |
| Sport Chek | ~28 | FGL XHR intercept | First page only (~28 of 1602 total); key: same FGL platform as Marks |
| Under Armour CA | ~24 | SFCC DOM | `/en-ca/c/sale/?sz=120` + outlet |
| Nike CA | ~24 | DOM (SSR) | `/ca/w/sale-3yaep`; `is--current-price`, `is--striked-out` |
| YoungLA | ~35 | DOM (Shopify custom elements) | USD→CAD; `product-card`, `sale-price`, `compare-at-price` |
| Uniqlo CA | 0 now | Direct API fetch | `x-fr-clientid: uq.ca.web-spa` (static); 0 deals = no active Uniqlo CA sale |
| Vans CA | ? | DOM (browse-all) | Navigates `/en-ca/men/footwear.html` etc., filters items with both prices |
| Champion | 0 now | Shopify API | `champion.com/collections/sale`; currently no active sale items |

### Confirmed broken / disabled ❌
| Store | Reason |
|-------|--------|
| Lululemon CA | Sale pages don't expose original prices — can't calculate discount |
| Zara CA | Akamai bot block |
| Aritzia | Sale page 404 / Cloudflare |
| Arc'teryx CA | Outlet site times out |
| H&M Canada | Akamai 403 — ALL requests blocked (even browser+stealth) |
| Frank and Oak | No `compare_at_price` in Shopify |
| Adidas CA | PerimeterX bot protection |
| North Face CA | Akamai bot protection |
| Musinsa Global | Location chooser blocks access |
| American Eagle CA | Aggressive bot detection — sale pages redirect regardless of browser mode |
| Roots Canada | SFCC ISML server errors |
| Levi's CA | Access Denied on sale URL |
| Vuori | Disabled per user preference |
| ASOS | ECONNRESET on direct fetch; XHR interception unreliable |
| Gap CA | Sale pages redirect to OutOfStockNoResults |
| Simons CA | All sale URLs redirect to homepage (bot-blocking) |
| Urban Outfitters CA | 403 Forbidden on all sale URLs with stealth |
| PacSun | PerimeterX bot protection |
| Lacoste CA | 0 deals — DOM selectors not matching |
| Jack & Jones CA | 0 deals — DOM selectors not matching |
| Quiksilver CA | 0 deals — Boardriders platform |
| Converse CA | 0 deals — Nike SFCC bot detection |
| Zumiez CA | Sale pages 404 — URL structure changed |
| Foot Locker CA | 0 products found — possible bot detection |
| Tommy Hilfiger CA | 0 products found — possible bot detection |
| Polo Ralph Lauren CA | 0 products found — possible bot detection |
| Calvin Klein CA | Sale pages 404 |
| Joe Fresh | Domain redirects — no longer serves Joe Fresh |
| Canadian Tire | Non-clothing store; FGL API returns 400 |

## Known issues / TODO

- **Vans CA**: browse-all approach (no dedicated sale section); deal count unknown until live test
- **Champion**: Shopify API accessible but store has no active sale currently
- **Sport Chek**: Only scrapes first page (~28 of ~1602 deals) — pagination would require 41 page loads
- **Uniqlo CA**: Fixed API scraper in place; 0 deals because Uniqlo CA has no active sales now
- **Lacoste / Jack & Jones / Quiksilver**: DOM selectors don't match — site structure investigation needed
- **Tommy Hilfiger / Calvin Klein / Ralph Lauren**: PVH Corp SFCC — URL patterns unresolved
- **Shift-click exclusion filter**: DONE — shift-click any sidebar pill to turn it red and EXCLUDE deals matching that filter; persists in localStorage

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
