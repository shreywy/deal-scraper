'use strict';

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());
const fs = require('fs');
const path = require('path');
const { getUSDtoCAD } = require('./currency');

const SCRAPERS = {
  underarmour:    require('./stores/underarmour'),
  uniqlo:         require('./stores/uniqlo'),
  zara:           require('./stores/zara'),
  gymshark:       require('./stores/gymshark'),
  youngla:        require('./stores/youngla'),
  nike:           require('./stores/nike'),
  adidas:         require('./stores/adidas'),
  // New stores
  frankandoak:    require('./stores/frankandoak'),
  roots:          require('./stores/roots'),
  aloyoga:        require('./stores/aloyoga'),
  vuori:          require('./stores/vuori'),
  northface:      require('./stores/northface'),
  lululemon:      require('./stores/lululemon'),
  hm:             require('./stores/hm'),
  aritzia:        require('./stores/aritzia'),
  arcteryx:       require('./stores/arcteryx'),
  hollister:      require('./stores/hollister'),
  abercrombie:    require('./stores/abercrombie'),
  americaneagle:  require('./stores/americaneagle'),
  musinsa:        require('./stores/musinsa'),
  clubmonaco:     require('./stores/clubmonaco'),
  bananarepublic: require('./stores/bananarepublic'),
  asos:           require('./stores/asos'),
};

const CACHE_PATH = path.join(__dirname, '../data/deals.json');
const STORE_TIMEOUT_MS = 3 * 60 * 1000; // 3 min per store before giving up

/**
 * Run all enabled store scrapers in parallel.
 *
 * @param {object} config         The parsed config.json object
 * @param {function(string):void} [onProgress]  Called with status strings
 * @param {function(string, object[]):void} [onPartial]  Called when a store finishes with (storeKey, deals)
 * @returns {Promise<object[]>}
 */
async function runAll(config, onProgress = () => {}, onPartial = () => {}) {
  const enabledStores = Object.entries(config.stores)
    .filter(([, s]) => s.enabled)
    .map(([key]) => key);

  if (enabledStores.length === 0) {
    onProgress('No stores enabled — nothing to scrape.');
    return [];
  }

  onProgress(`Starting scrape for: ${enabledStores.join(', ')}`);

  // Fetch exchange rate upfront for USD stores
  let usdToCAD = 1.38;
  try {
    usdToCAD = await getUSDtoCAD();
    onProgress(`Currency: 1 USD = ${usdToCAD.toFixed(4)} CAD`);
  } catch (_) {}

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-http2'],
  });

  const storeResults = {};
  const allDeals = [];
  const minDiscount = config.settings?.minDiscountPercent || 0;

  try {
    // Run all stores in parallel, call onPartial as each finishes
    await Promise.all(enabledStores.map(async (key) => {
      const scraper = SCRAPERS[key];
      if (!scraper) {
        onProgress(`No scraper found for "${key}" — skipping`);
        storeResults[key] = { count: 0, error: 'no scraper' };
        onPartial(key, []);
        return;
      }

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timed out after 3 minutes')), STORE_TIMEOUT_MS)
      );

      try {
        const deals = await Promise.race([
          scraper.scrape(browser, onProgress),
          timeoutPromise,
        ]);

        // Tag each deal with its storeKey for partial streaming
        const tagged = deals.map(d => ({ ...d, storeKey: key }));
        // Apply global min-discount filter
        const filtered = minDiscount > 0 ? tagged.filter(d => d.discount >= minDiscount) : tagged;

        storeResults[key] = { count: filtered.length, error: null };
        allDeals.push(...filtered);
        onProgress(`${key}: ${filtered.length} deals found`);
        onPartial(key, filtered);
      } catch (err) {
        const msg = err.message || String(err);
        storeResults[key] = { count: 0, error: msg };
        onProgress(`${key}: failed — ${msg}`);
        onPartial(key, [], msg);
      }
    }));

    // Sort by discount descending
    allDeals.sort((a, b) => b.discount - a.discount);

    // Persist to cache
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({
      scrapedAt: new Date().toISOString(),
      usdToCAD,
      storeResults,
      deals: allDeals,
    }, null, 2));

    const summary = Object.entries(storeResults)
      .map(([k, v]) => `${k}: ${v.error ? '❌ ' + v.error : v.count + ' deals'}`)
      .join(' | ');
    onProgress(`Done — ${allDeals.length} total deals | ${summary}`);
    return allDeals;

  } finally {
    await browser.close();
  }
}

/**
 * Load deals from cache. Returns null if no cache exists.
 */
function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

module.exports = { runAll, loadCache };
