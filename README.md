# 🌿 dealsco

A local deal-scraper app that automatically scrapes sale items from Canadian clothing retailers on launch, tags them (gender, category, item type), and presents them in a clean storefront UI.

## What it does

- On launch, scrapes all enabled stores for their current sale items
- Shows cached results immediately with a "refreshing" banner while the new scrape runs
- Displays items as a filterable, sortable product grid with original price crossed out, sale price, and % off badge
- Auto-tags items by category (T-Shirts, Shorts, Jackets, etc.) and gender using product name/description heuristics
- Clicking any item opens the retailer's product page in a new tab

**Live:** https://shreywy.github.io/deal-scraper/ — rebuilt daily by GitHub Actions.

## Stores

~40 Canadian retailers (Gymshark, Gap/Banana Republic/Old Navy, Sport Chek, Altitude Sports, Champion, Volcom, Reebok, The Brick, Leon's…). Per-store status lives in the `note` fields of `config.json`.

## Architecture

```
deal-scraper/
├── scraper/          # Node.js Playwright scrapers, one file per store
├── server/           # Express server — runs scrapers, serves API + frontend
├── frontend/         # Static HTML/CSS/JS storefront UI
├── data/             # Cached deals JSON (gitignored)
└── docs/             # Design specs and planning docs
```

**Hosting.** The scraper needs Node + Playwright, so it can't run *on* a static host. Instead `.github/workflows/deploy.yml` runs `npm run scrape` on a daily schedule (and on pushes) and publishes `frontend/` + `deals.json` to GitHub Pages. The frontend notices there's no server and switches to static mode. Locally, `npm start` gives the full app with live refresh.

## Running locally

```bash
npm install
npx playwright install chromium
npm start
# → opens http://localhost:3030

npm run scrape   # one-off scrape → data/deals.json
npm test         # tagger checks
```

## Design

Sage Frost Everforest-inspired UI — clean white tiles, soft sage background, outlined pill filters, slide-in settings drawer with per-store toggles. Dark mode supported.

See the design mockup in `.superpowers/brainstorm/` (open with the brainstorming server, or just view the HTML files directly in a browser).
