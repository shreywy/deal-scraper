'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { getUSDtoCAD } = require('./currency');

const SCRAPERS = {
  underarmour: require('./stores/underarmour'),
  uniqlo: require('./stores/uniqlo'),
  zara: require('./stores/zara'),
  gymshark: require('./stores/gymshark'),
  youngla: require('./stores/youngla'),
  nike: require('./stores/nike'),
  adidas: require('./stores/adidas'),
};

const CACHE_PATH = path.join(__dirname, '../data/deals.json');

/**
 * @typedef {object} Deal
 * @property {string} id
 * @property {string} store
 * @property {string} storeKey
 * @property {string} name
 * @property {string} url
 * @property {string} image
 * @property {number} price
 * @property {number} originalPrice
 * @property {number} discount
 * @property {string[]} tags
 * @property {string} scrapedAt
 */

/**
 * Run all enabled store scrapers in parallel.
 *
 * @param {object} config  The parsed config.json object
 * @param {function(string):void} [onProgress]  Called with status strings
 * @returns {Promise<Deal[]>}
 */
async function runAll(config, onProgress = () => {}) {
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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const results = await Promise.allSettled(
      enabledStores.map(key => {
        const scraper = SCRAPERS[key];
        if (!scraper) {
          onProgress(`No scraper found for "${key}" — skipping`);
          return Promise.resolve([]);
        }
        return scraper.scrape(browser, onProgress);
      })
    );

    const allDeals = [];
    const storeResults = {};

    for (let i = 0; i < results.length; i++) {
      const key = enabledStores[i];
      const r = results[i];
      if (r.status === 'fulfilled') {
        storeResults[key] = { count: r.value.length, error: null };
        allDeals.push(...r.value);
      } else {
        const msg = r.reason?.message || String(r.reason);
        storeResults[key] = { count: 0, error: msg };
        onProgress(`${key}: scrape failed — ${msg}`);
      }
    }

    // Apply global min-discount filter from config
    const minDiscount = config.settings?.minDiscountPercent || 0;
    const filtered = minDiscount > 0 ? allDeals.filter(d => d.discount >= minDiscount) : allDeals;

    // Sort by discount descending
    filtered.sort((a, b) => b.discount - a.discount);

    // Persist to cache (include per-store results for the status API)
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({
      scrapedAt: new Date().toISOString(),
      usdToCAD,
      storeResults,
      deals: filtered,
    }, null, 2));

    const summary = Object.entries(storeResults)
      .map(([k, v]) => `${k}: ${v.error ? '❌ ' + v.error : v.count + ' deals'}`)
      .join(' | ');
    onProgress(`Done — ${filtered.length} total deals | ${summary}`);
    return filtered;

  } finally {
    await browser.close();
  }
}

/**
 * Load deals from cache. Returns null if no cache exists.
 * @returns {{ scrapedAt: string, deals: Deal[] } | null}
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
