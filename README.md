# 🌿 dealsco

A local deal-scraper app that automatically scrapes sale items from Canadian clothing retailers on launch, tags them (gender, category, item type), and presents them in a clean storefront UI.

## What it does

- On launch, scrapes all enabled stores for their current sale items
- Shows cached results immediately with a "refreshing" banner while the new scrape runs
- Displays items as a filterable, sortable product grid with original price crossed out, sale price, and % off badge
- Auto-tags items by category (T-Shirts, Shorts, Jackets, etc.) and gender using product name/description heuristics
- Clicking any item opens the retailer's product page in a new tab

## Stores (initial)

| Store | URL | Platform |
|-------|-----|----------|
| Under Armour CA | underarmour.ca | Salesforce Commerce Cloud |
| Uniqlo Canada | uniqlo.com/ca | Fast Retailing custom |
| Zara Canada | zara.com/ca | Inditex custom |

Additional stores are added manually by editing scraper configs — each store may need a custom scraper. Stores sharing platforms (e.g. all Inditex brands: Zara, Pull&Bear, Bershka) can reuse the same scraper with a URL swap.

## Architecture

```
deal-scraper/
├── scraper/          # Node.js Playwright scrapers, one file per store
├── server/           # Express server — runs scrapers, serves API + frontend
├── frontend/         # Static HTML/CSS/JS storefront UI
├── data/             # Cached deals JSON (gitignored)
└── docs/             # Design specs and planning docs
```

**This is a local app.** The scraper runs Node.js + Playwright and cannot be hosted on GitHub Pages or any static host. You run it locally with `npm start`.

## Running locally

```bash
npm install
npx playwright install chromium
npm start
# → opens http://localhost:3000
```

## Status

> Currently in design/planning phase. See `docs/superpowers/specs/` for the full design spec.

## Design

Sage Frost Everforest-inspired UI — clean white tiles, soft sage background, outlined pill filters, slide-in settings drawer with per-store toggles. Dark mode supported.

See the design mockup in `.superpowers/brainstorm/` (open with the brainstorming server, or just view the HTML files directly in a browser).
