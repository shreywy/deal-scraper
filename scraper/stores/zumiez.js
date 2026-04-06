'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Zumiez';
const STORE_KEY = 'zumiez';
const CURRENCY = 'CAD';

// Try Shopify API first, fallback to DOM
const SALE_URLS = [
  'https://www.zumiez.com/ca/collections/sale',
  'https://www.zumiez.com/ca/sale.html',
];

/**
 * Zumiez Canada — Shopify store
 * Try products.json API first, fallback to DOM scraping
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Zumiez: checking Shopify API...');

  // Try Shopify API first
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
  });

  const page = await context.newPage();
  const allDeals = [];
  const seenUrls = new Set();

  try {
    // Try Shopify products.json API
    const apiUrl = 'https://www.zumiez.com/ca/collections/sale/products.json?limit=250';
    const response = await page.goto(apiUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (response && response.status() === 200) {
      const json = await response.json();
      const products = json?.products || [];

      onProgress(`Zumiez: processing ${products.length} products from API...`);

      for (const p of products) {
        const name = p.title || '';
        if (!name) continue;

        const variants = p.variants || [];
        if (variants.length === 0) continue;

        // Use first variant for pricing
        const variant = variants[0];
        const price = parseFloat(variant.price);
        const originalPrice = parseFloat(variant.compare_at_price);

        if (!price || !originalPrice || price >= originalPrice) continue;

        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) continue;

        const url = `https://www.zumiez.com/ca/products/${p.handle}`;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        const image = p.images?.[0]?.src || '';

        allDeals.push({
          id: slugify(`${STORE_KEY}-${name}`),
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name,
          url,
          image,
          price,
          originalPrice,
          discount,
          currency: CURRENCY,
          priceCAD: price,
          originalPriceCAD: originalPrice,
          tags: tag({ name }),
          scrapedAt: new Date().toISOString(),
        });
      }
    }
  } catch (err) {
    onProgress(`Zumiez: API failed (${err.message}), trying DOM scraping...`);
  }

  // If API failed, try DOM scraping
  if (allDeals.length === 0) {
    for (const saleUrl of SALE_URLS) {
      try {
        onProgress(`Zumiez: trying ${saleUrl}...`);
        const response = await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        if (response && (response.status() === 403 || response.status() === 404)) {
          onProgress(`Zumiez: ${saleUrl} returned ${response.status()}`);
          continue;
        }

        // Cookie consent
        try { await page.click('[data-testid="cookie-accept"], #onetrust-accept-btn-handler', { timeout: 3000 }); } catch (_) {}

        await page.waitForTimeout(3000);

        // Scroll to load lazy content
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(1500);
        }

        const domDeals = await page.evaluate(({ storeName, storeKey }) => {
          const parsePrice = el => {
            if (!el) return null;
            const n = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
          };

          const cardSels = [
            '.product, .product-card, .product-item, .product-tile',
            'div[class*="product"]',
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
            const link = card.querySelector('a[href*="/products/"], a[href]');
            const url = link?.href || '';
            if (!url || seen.has(url)) return null;
            seen.add(url);

            const name = card.querySelector('.product-title, .product-name, h2, h3, [class*="title"]')?.textContent?.trim() || '';

            const salePriceEl = card.querySelector('.price--sale, .sale-price, [class*="sale"]');
            const origPriceEl = card.querySelector('.price--compare, .compare-price, del, s, [class*="compare"]');

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
            allDeals.push({
              ...d,
              id: slugify(`${STORE_KEY}-${d.name}`),
              currency: CURRENCY,
              priceCAD: d.price,
              originalPriceCAD: d.originalPrice,
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
  }

  await page.close();
  await context.close();

  onProgress(`Zumiez: found ${allDeals.length} deals`);
  return allDeals;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
