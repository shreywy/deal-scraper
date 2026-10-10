# dealsco — Claude Context

This file gives Claude full context to pick up this project on any machine.

## What we're building

A **local Node.js app** called **dealsco** — a deal scraper that:
1. On launch, automatically runs Playwright scrapers against enabled Canadian clothing stores
2. Serves a local web UI at `http://localhost:3030`
3. Shows cached results immediately, refreshes in background via SSE
4. Displays sale items as a filterable/sortable product grid

**Hosting:** GitHub Actions (`.github/workflows/deploy.yml`) scrapes daily and publishes the static frontend + `deals.json` to GitHub Pages: https://shreywy.github.io/deal-scraper/. The frontend detects there's no `/api` and runs in static mode (no refresh button; store toggles saved in localStorage). Locally it's still Express + Playwright with live SSE refresh.

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
# → http://localhost:3030
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
│   │   ├── sportchek.js     # FGL XHR intercept + API pagination — ~410 deals ✅
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

## Stores & scraper status (as of 2026-10-10)

~42 stores enabled, ~27k deals per run (~2 min). `config.json` `note` fields hold per-store status — check there first.

Shared helpers (prefer these for new stores):
- `scraper/shopify.js` — Shopify `products.json`, fetched **inside a browser page** (plain HTTP now gets 429 from Cloudflare). Auto-detects whether the storefront shows CAD (converts with Shopify's own rate) or USD (live-rate estimate). New Shopify store = ~10-line file listing `origin` + collection handles. Find handles via `/collections.json` in a browser.
- `scraper/gapinc.js` — Gap / Banana Republic / Old Navy via the public `api.gapcanada.ca` product-search API (plain fetch, `brand` = gap|br|on).
- Altitude Sports — Algolia index `PRODUCTS_ALS_en-CA` (public key in the scraper). Also the route to brands whose own sites block us (Under Armour, Patagonia, Columbia…). Sport Chek likewise carries Under Armour/Nike/adidas.

Blocked / disabled (don't retry without a new idea): Under Armour (CAPTCHA), Aritzia/SSENSE/MEC (Cloudflare), Patagonia (queue page), Uniqlo (Akamai), Dell (bot manager), Jack & Jones, Zumiez, Vans, Calvin Klein, plus the older list in config notes. Abercrombie/Hollister work only when the IP isn't flagged by Akamai (heavy repeated testing trips a "Client Challenge"). Converse/Reigning Champ: scrapers fine, no active sale.

Bot-defence lessons: run stores through the 6-wide pool (not all at once); replay APIs from inside the page (`page.evaluate(fetch)`) rather than Node; never try to solve CAPTCHAs.

## Known issues / TODO

- **Foot Locker**: only page 1 (48) when its search API rate-limits; pagination clicks otherwise
- **Newegg**: flaky (0–33 deals run to run)
- **"Newest" sort**: meaningless — every deal in a run shares one timestamp (per-deal `scrapedAt` is no longer saved). Needs first-seen tracking across runs if wanted.
- **Scheduled workflow**: GitHub disables cron workflows after 60 days without repo activity — re-enable from the Actions tab if the site stops updating
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

Saved `deals.json` is slimmed (`scraper/index.js` `slimDeal`): no `id`/`scrapedAt`/`gender`/`exchangeRate`, and `priceCAD`/`originalPriceCAD` only for `currency: "USD"` deals (where `price` is USD). For CAD deals `price` is CAD.

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
