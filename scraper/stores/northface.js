'use strict';

const { tag } = require('../tagger');

// The North Face CA uses Salesforce Commerce Cloud (SFCC) — same platform as Under Armour.
const URLS = [
  'https://www.thenorthface.com/en-ca/sale?sz=120',
  'https://www.thenorthface.com/en-ca/outlet?sz=120',
];
const STORE_NAME = 'The North Face';
const STORE_KEY = 'northface';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
    extraHTTPHeaders: { 'Accept-Language': 'en-CA,en;q=0.9' },
  });

  const allDeals = [];
  const seenUrls = new Set();

  for (const url of URLS) {
    const label = url.includes('outlet') ? 'outlet' : 'sale';
    onProgress(`The North Face: loading ${label} page…`);
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      try { await page.click('#onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}

      await page.waitForTimeout(2000);
      await loadAll(page, onProgress);

      const deals = await page.evaluate(({ storeName, storeKey }) => {
        const parsePrice = el => {
          if (!el) return null;
          const n = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };

        // Try SFCC window state first
        try {
          const sfcc = window.__STORE_STATE__ || window.__NEXT_DATA__?.props?.pageProps;
          if (sfcc) {
            const products =
              sfcc?.products?.productList ||
              sfcc?.searchResult?.products ||
              sfcc?.category?.products || [];
            if (products.length > 0) {
              return products.map(p => {
                const price = p.price?.salePriceValue || p.price?.salePrice || p.salePrice;
                const originalPrice = p.price?.listPriceValue || p.price?.listPrice || p.listPrice;
                if (!price || !originalPrice || price >= originalPrice) return null;
                const discount = Math.round((1 - price / originalPrice) * 100);
                if (discount <= 0) return null;
                const name = p.productName || p.name || '';
                const prodUrl = p.url || p.pdpUrl || '';
                const image = p.images?.[0]?.url || p.imageUrl || '';
                return { store: storeName, storeKey, name, url: prodUrl, image, price, originalPrice, discount, tags: [] };
              }).filter(Boolean);
            }
          }
        } catch (_) {}

        // DOM fallback
        const cardSels = [
          '[data-testid="product-card"]',
          '[class*="ProductCard"]',
          '[class*="product-card"]',
          'li[class*="product"]',
          'article[class*="product"]',
        ];
        let cards = [];
        for (const sel of cardSels) {
          const found = [...document.querySelectorAll(sel)];
          if (found.length > 0) { cards = found; break; }
        }

        const seen = new Set();
        return cards.map(card => {
          const link = card.querySelector('a[href]');
          const cardUrl = link?.href || '';
          if (!cardUrl || seen.has(cardUrl)) return null;
          seen.add(cardUrl);

          const nameEl = card.querySelector('h2, h3, [class*="name"], [class*="title"]');
          const salePriceEl = card.querySelector('[class*="sale"], [class*="Sale"], [class*="promo"], del ~ *, s ~ *');
          const origPriceEl = card.querySelector('del, s, strike, [class*="original"], [class*="was"]');
          const imgEl = card.querySelector('img');

          const name = nameEl?.textContent?.trim() || '';
          const price = parsePrice(salePriceEl);
          const originalPrice = parsePrice(origPriceEl);
          const image = imgEl?.src || '';

          if (!name || !price || !originalPrice || price >= originalPrice) return null;
          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;
          return { store: storeName, storeKey, name, url: cardUrl, image, price, originalPrice, discount, tags: [] };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY });

      for (const d of deals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          allDeals.push({
            ...d,
            id: slugify(`${d.storeKey}-${d.name}`),
            currency: 'CAD',
            priceCAD: d.price,
            originalPriceCAD: d.originalPrice,
            tags: tag({ name: d.name }),
            scrapedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      onProgress(`The North Face: error on ${label} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();
  onProgress(`The North Face: found ${allDeals.length} deals total`);
  return allDeals;
}

async function loadAll(page, onProgress) {
  const LOAD_MORE = [
    'button[data-testid*="load-more"]',
    'button[class*="load-more"]',
    'button[class*="LoadMore"]',
    'button[class*="show-more"]',
    '[class*="pagination"] button',
  ].join(', ');

  let round = 0;
  while (round < 20) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
    try {
      const btn = await page.$(LOAD_MORE);
      if (!btn || !(await btn.isVisible())) break;
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      round++;
      onProgress(`The North Face: loading more (page ${round + 1})…`);
      await page.waitForTimeout(2000);
    } catch (_) { break; }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
