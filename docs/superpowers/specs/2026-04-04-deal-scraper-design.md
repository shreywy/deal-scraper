# dealsco — Design Spec

**Date:** 2026-04-04  
**Status:** Approved — ready for implementation planning

---

## Overview

A local Node.js app that scrapes sale items from Canadian clothing retailers on launch, auto-tags them, and presents them in a clean storefront UI. The user opens the app and immediately sees deals — no manual refresh required.

---

## Architecture

**Runtime:** Local only. Node.js + Playwright backend cannot run on static hosts (GitHub Pages, Netlify, etc.).

```
[npm start]
    │
    ├─→ Express server starts on :3000
    ├─→ Scrape job triggered in background (parallel per store)
    └─→ Browser opens http://localhost:3000

[Frontend loads]
    ├─→ GET /api/deals → returns cached JSON immediately
    ├─→ Shows "cached results" banner
    ├─→ Subscribes to /api/refresh (SSE) for live progress
    └─→ When scrape completes → swaps data, banner goes green
```

### Components

| Component | Path | Responsibility |
|-----------|------|----------------|
| Scraper orchestrator | `scraper/index.js` | Runs all enabled store scrapers in parallel via Promise.all |
| Store scrapers | `scraper/stores/*.js` | One file per store (or platform group). Exports `scrape()` → Deal[] |
| Auto-tagger | `scraper/tagger.js` | Maps product name/category strings to normalized tags |
| Express server | `server/index.js` | Serves frontend, `/api/deals`, `/api/refresh` SSE |
| Frontend | `frontend/` | Static HTML/CSS/JS — no framework, no build step |
| Config | `config.json` | Enabled stores, user preferences |
| Cache | `data/deals.json` | Persisted after each successful scrape (gitignored) |

---

## Data Model

### Deal object
```json
{
  "id": "ua-hovr-phantom-3-mens-sz10",
  "store": "Under Armour",
  "storeKey": "underarmour",
  "name": "HOVR Phantom 3 Running Shoe",
  "url": "https://www.underarmour.ca/en-ca/p/...",
  "image": "https://cdn.underarmour.com/...",
  "price": 62,
  "originalPrice": 89,
  "discount": 30,
  "tags": ["Men", "Footwear", "Activewear"],
  "scrapedAt": "2026-04-04T01:00:00.000Z"
}
```

### Config schema
```json
{
  "stores": {
    "underarmour": { "enabled": true, "name": "Under Armour CA" },
    "uniqlo": { "enabled": true, "name": "Uniqlo Canada" },
    "zara": { "enabled": true, "name": "Zara Canada" }
  },
  "settings": {
    "autoRefreshOnLaunch": true,
    "openLinksInNewTab": true,
    "showDiscountBadges": true,
    "minDiscountPercent": 0
  }
}
```

---

## Scraping Strategy

Each store scraper is a self-contained module:

```js
// scraper/stores/underarmour.js
export async function scrape(browser) {
  // 1. Open page with Playwright
  // 2. Handle lazy load / pagination
  // 3. Extract raw product data
  // 4. Return normalized Deal[]
}
```

**Playwright is the default** — all three initial stores are JS-heavy SPAs. Simple HTTP fetch is a fallback only if a store exposes a clean JSON API (e.g. Uniqlo is rumoured to have one).

**Scraper adds new stores:** Each new store is implemented as a new `scraper/stores/<key>.js` file. Stores sharing a platform (Inditex group: Zara, Pull&Bear, Bershka) reuse base logic with URL/selector overrides.

### Auto-tagging

`scraper/tagger.js` maps raw product name + store category string to normalized tags:

- **Gender:** keyword match (men, women, unisex, boys, girls, kids)
- **Category:** keyword match against a dictionary:
  - shirt, tee, t-shirt → T-Shirts
  - short, shorts → Shorts
  - jacket, parka, anorak → Jackets
  - dress, skirt → Dresses
  - shoe, sneaker, runner, trainer → Footwear
  - pant, jean, trouser, legging → Pants/Bottoms
  - hoodie, sweatshirt → Hoodies
  - bag, tote, backpack, wallet → Accessories
  - bra, underwear, brief, boxer → Underwear
  - swim, bikini, board short → Swimwear
  - (fallback) → Tops / Other

---

## Frontend

**No framework, no build step.** Plain HTML + CSS + vanilla JS. Served statically by Express.

### Layout

```
┌─────────────────────────────────────────────────────┐
│ TOPBAR: 🌿 dealsco | [refresh strip] | 🌙 ⚙️ Settings │
├────────────┬────────────────────────────────────────┤
│  SIDEBAR   │  MAIN                                  │
│  Sort by   │  [results bar + active filter chips]   │
│  Grid: − 3+│                                        │
│  Gender    │  ┌────┐ ┌────┐ ┌────┐                 │
│  Category  │  │tile│ │tile│ │tile│                 │
│  Price     │  └────┘ └────┘ └────┘                 │
│  Discount  │  ...                                   │
└────────────┴────────────────────────────────────────┘
```

### Topbar elements

- **Logo:** 🌿 dealsco (links to top)
- **Refresh strip:** Pill showing scrape status. Amber "Showing cached results · Refreshing…" → transitions to green "Up to date · Last refreshed just now" when complete
- **Dark mode button:** Circle button, 🌙/☀️ icon swap with rotate animation, toggles `html.dark` class. All CSS vars transition at 350ms.
- **Settings button:** Pill button "⚙️ Settings", opens slide-in drawer from right with blurred overlay

### Settings drawer

Full-height right drawer (340px). Sections:
1. **Active Stores** — toggle per store, shows last scrape time + deal count, status dot (green/amber)
2. **Behaviour** — auto-refresh on launch, open links in new tab, show % badges
3. **Global Filters** — min. discount stepper (0–70%, step 10)

### Sidebar filters

All sections use outlined pill buttons (border, rounded-full). Active state: filled dark green.

- **Sort:** radio-style rows (% Off highest, Price ↑, Price ↓, Newest)
- **Grid size:** `−` `[N]` `+` buttons, range 2–6 columns, grid CSS transition
- **Gender:** All / Men / Women / Unisex
- **Category:** All + auto-populated from tags found in current scrape result
- **Price range:** Any / Under $25 / $25–$50 / $50–$100 / $100+
- **Min. discount:** Any / 20%+ / 30%+ / 40%+ / 50%+

Active filters show as removable chips in the results bar.

### Product tile

- Aspect-ratio 1:1 image (from retailer CDN)
- Store name (small caps, muted)
- Product name (bold, truncated)
- Tags (small green pills)
- Price row: **$XX** ~~$YY~~ `−30%` badge
- Hover: lift + shadow, image scales 1.05×
- Click: `window.open(url, '_blank')`

### Color palette

| Token | Light | Dark |
|-------|-------|------|
| `--bg` | `#f2f5f0` | `#272e33` |
| `--surface` | `#ffffff` | `#2e383c` |
| `--border` | `#e2ece0` | `#3d4f52` |
| `--green-dark` | `#2e4a30` | `#a7c080` |
| `--green-mid` | `#3d5e40` | `#83c092` |
| `--green-light` | `#eef3ec` | `#323d35` |
| `--text-primary` | `#2d3a2e` | `#d3c6aa` |
| `--text-muted` | `#9aad9b` | `#6a7e72` |
| `--badge-bg` | `#e2f0e2` | `#2d3d30` |
| `--badge-text` | `#235025` | `#a7c080` |

---

## Server API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serves `frontend/index.html` |
| `/api/deals` | GET | Returns cached `data/deals.json`. 200 with data, 204 if no cache yet |
| `/api/refresh` | GET | SSE stream. Triggers scrape if not already running. Emits `progress`, `store-done`, `complete` events |
| `/api/config` | GET | Returns `config.json` |
| `/api/config` | PATCH | Updates `config.json` (store toggles, settings) |

---

## Platform Groups (for future store expansion)

| Platform | Confirmed Stores | Potential Additions |
|----------|-----------------|---------------------|
| Inditex | Zara CA | Pull&Bear, Bershka, Massimo Dutti, Stradivarius |
| Fast Retailing | Uniqlo CA | GU |
| Salesforce Commerce Cloud | Under Armour CA | Adidas CA (TBC) |
| GAP Inc. | — | Old Navy CA, Gap CA, Banana Republic CA |
| Abercrombie & Fitch Co. | — | Hollister CA, Abercrombie CA |

---

## Out of scope (v1)

- User accounts / saved items
- Price history / alerts
- Mobile app
- Any hosting beyond local
- Scheduling/cron (launch = refresh)
