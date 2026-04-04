'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRAPERS = {
  underarmour: require('./stores/underarmour'),
  uniqlo: require('./stores/uniqlo'),
  zara: require('./stores/zara'),
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
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'fulfilled') {
        allDeals.push(...r.value);
      } else {
        onProgress(`${enabledStores[i]}: scrape failed — ${r.reason?.message || r.reason}`);
      }
    }

    // Apply global min-discount filter from config
    const minDiscount = config.settings?.minDiscountPercent || 0;
    const filtered = minDiscount > 0 ? allDeals.filter(d => d.discount >= minDiscount) : allDeals;

    // Sort by discount descending
    filtered.sort((a, b) => b.discount - a.discount);

    // Persist to cache
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ scrapedAt: new Date().toISOString(), deals: filtered }, null, 2));

    onProgress(`Done — ${filtered.length} deals cached (${allDeals.length} total, ${allDeals.length - filtered.length} below min discount)`);
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
