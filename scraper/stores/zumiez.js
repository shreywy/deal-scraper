'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'Zumiez';
const STORE_KEY = 'zumiez';
const CURRENCY = 'USD'; // Zumiez is US-based, convert to CAD

// Zumiez.com sale URLs (SFCC platform)
const SALE_URLS = [
  'https://www.zumiez.com/sale',
  'https://www.zumiez.com/mens-clothing-deals',
];

/**
 * Zumiez — Salesforce Commerce Cloud (SFCC) store
 * NOTE: As of April 2026, zumiez.com has intermittent redirect issues.
 * Sale URLs sometimes redirect to other retailers' sites. This scraper
 * attempts to access the sale page but may return 0 deals if redirects occur.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Zumiez: fetching USD→CAD rate...');
  const exchangeRate = await getUSDtoCAD();

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  const page = await context.newPage();
  const allDeals = [];
  const seenUrls = new Set();

  try {
    for (const saleUrl of SALE_URLS) {
      try {
        onProgress(`Zumiez: trying ${saleUrl}...`);
        const response = await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // Check if page redirected to a different domain (indicates redirect issue)
        const currentUrl = page.url();
        if (!currentUrl.includes('zumiez.com')) {
          onProgress(`Zumiez: redirected to ${currentUrl} — site may be having issues`);
          continue;
        }

        if (response && (response.status() === 403 || response.status() === 404)) {
          onProgress(`Zumiez: ${saleUrl} returned ${response.status()}`);
          continue;
        }

        // Cookie consent
        try { await page.click('#onetrust-accept-btn-handler, [class*="onetrust-accept"]', { timeout: 3000 }); } catch (_) {}

        await page.waitForTimeout(3000);

        // Scroll to load lazy content
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollBy(0, 1500));
          await page.waitForTimeout(1500);
        }

        const domDeals = await page.evaluate(({ storeName, storeKey }) => {
          const parsePrice = el => {
            if (!el) return null;
            const n = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
          };

          // SFCC-style selectors + generic fallbacks
          const cardSels = [
            '.product-tile',
            '.product',
            '.product-card',
            'div[class*="product-tile"]',
            'div[class*="ProductTile"]',
            '[data-testid="product-card"]',
            'article',
            'li[class*="product"]',
          ];

          let cards = [];
          for (const sel of cardSels) {
            const found = [...document.querySelectorAll(sel)];
            if (found.length > 0) { cards = found; break; }
          }

          const seen = new Set();
          return cards.map(card => {
            const link = card.querySelector('a[href]');
            const url = link?.href || '';
            if (!url || seen.has(url)) return null;
            seen.add(url);

            const nameEl = card.querySelector('.product-name, .product-title, h2, h3, [class*="name"], [class*="title"]');
            const name = nameEl?.textContent?.trim() || '';

            // SFCC price selectors
            const salePriceEl = card.querySelector('.price-sales, .sale-price, [class*="sale"], [class*="reduced"]');
            const origPriceEl = card.querySelector('.price-standard, .price-strike, del, s, [class*="standard"], [class*="compare"]');

            const price = parsePrice(salePriceEl);
            const originalPrice = parsePrice(origPriceEl);

            const imgEl = card.querySelector('img[src]');
            const image = imgEl?.src || '';

            if (!name || !price || !originalPrice || price >= originalPrice) return null;
            const discount = Math.round((1 - price / originalPrice) * 100);
            if (discount <= 0) return null;

            return {
              store: storeName,
              storeKey,
              name,
              url,
              image,
              price,
              originalPrice,
              discount,
              tags: [],
            };
          }).filter(Boolean);
        }, { storeName: STORE_NAME, storeKey: STORE_KEY });

        for (const d of domDeals) {
          if (!seenUrls.has(d.url)) {
            seenUrls.add(d.url);
            const priceCAD = Math.round(d.price * exchangeRate * 100) / 100;
            const originalPriceCAD = Math.round(d.originalPrice * exchangeRate * 100) / 100;

            allDeals.push({
              ...d,
              id: slugify(`${STORE_KEY}-${d.name}`),
              currency: 'CAD',
              price: priceCAD,
              originalPrice: originalPriceCAD,
              priceCAD,
              originalPriceCAD,
              exchangeRate,
              tags: tag({ name: d.name }),
              scrapedAt: new Date().toISOString(),
            });
          }
        }

        if (allDeals.length > 0) break; // Success, stop trying URLs
      } catch (err) {
        onProgress(`Zumiez: error on ${saleUrl} — ${err.message}`);
      }
    }
  } finally {
    await page.close();
    await context.close();
  }

  if (allDeals.length === 0) {
    onProgress('Zumiez: 0 deals found — site may be experiencing redirect issues');
  } else {
    onProgress(`Zumiez: found ${allDeals.length} deals`);
  }

  return allDeals;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
