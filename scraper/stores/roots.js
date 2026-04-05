'use strict';

const { tag } = require('../tagger');

// Roots Canada uses Salesforce Commerce Cloud (SFCC) — same platform as Under Armour.
const STORE_NAME = 'Roots Canada';
const STORE_KEY = 'roots';
const CURRENCY = 'CAD';

const SALE_URLS = [
  'https://www.roots.com/en-ca/c/sale-sale/?sz=120',
  'https://www.roots.com/en-ca/sale?sz=120',
];

/**
 * Roots Canada — iconic Canadian brand on SFCC.
 * Uses Playwright with SFCC window state + DOM fallback.
 *
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

  const seenUrls = new Set();
  const allDeals = [];

  for (const saleUrl of SALE_URLS) {
    onProgress('Roots Canada: loading sale page…');
    const page = await context.newPage();
    try {
      let response;
      try {
        response = await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      } catch (err) {
        if (err.message.includes('Timeout') || err.message.includes('ERR_')) {
          onProgress(`Roots Canada: failed to load page - site may be down or blocking (${err.message.split('\n')[0]})`);
          await page.close();
          continue;
        }
        throw err;
      }

      // Check for server errors
      if (response && (response.status() === 500 || response.status() === 503)) {
        onProgress(`Roots Canada: server error (${response.status()}) - site may be down or blocking requests`);
        await page.close();
        continue;
      }

      try { await page.click('#onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}
      await page.waitForTimeout(3000);

      // Wait for product grid to load
      try {
        await page.waitForSelector('[data-testid="product-card"], [class*="ProductCard"], [class*="product-card"], li[class*="product"]', { timeout: 10000 });
      } catch (_) {
        onProgress('Roots Canada: no product cards found');
      }

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

        // DOM fallback - Roots uses SFCC
        const cardSels = [
          '.product',
          '.product-tile',
          'div[class*="product"]',
          '[data-testid="product-card"]',
          '[class*="ProductCard"]',
          'li[class*="product"]',
        ];
        let cards = [];
        for (const sel of cardSels) {
          const found = [...document.querySelectorAll(sel)];
          if (found.length > 0) { cards = found; break; }
        }

        const seen = new Set();
        return cards.map(card => {
          // SFCC-specific selectors
          const link = card.querySelector('a.thumb-link, a[href*="/p/"]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);

          // SFCC product name
          const nameEl = card.querySelector('.tile-body .product-name, .product-name, h2, h3, [class*="name"]');
          const name = nameEl?.textContent?.trim() || '';

          // SFCC price selectors
          const saleEl = card.querySelector('.price .sales .value, .price-sales, [class*="sale"]');
          const origEl = card.querySelector('.price .strike-through .value, .price-standard, del, s');
          const imgEl = card.querySelector('img');

          let price = parsePrice(saleEl);
          let originalPrice = parsePrice(origEl);

          if (!price || !originalPrice) {
            const priceEls = [...card.querySelectorAll('[class*="price"], [class*="Price"]')]
              .filter(el => !el.querySelector('[class*="price"]'));
            const vals = priceEls.map(el => parsePrice(el)).filter(Boolean).sort((a, b) => a - b);
            if (vals.length >= 2) { price = vals[0]; originalPrice = vals[vals.length - 1]; }
          }
          if (!name || !price || !originalPrice || price >= originalPrice) return null;
          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;
          return { store: storeName, storeKey, name, url, image: imgEl?.src || '', price, originalPrice, discount, tags: [] };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY });

      for (const d of deals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          // Extract product ID from URL
          const productId = d.url.match(/\/([^\/]+)\.html$/)?.[1] || d.url.split('/').pop() || '';
          allDeals.push({
            ...d,
            id: slugify(`${d.storeKey}-${d.name}-${productId}`),
            currency: CURRENCY,
            priceCAD: d.price,
            originalPriceCAD: d.originalPrice,
            tags: tag({ name: d.name }),
            scrapedAt: new Date().toISOString(),
          });
        }
      }
    } catch (err) {
      onProgress(`Roots Canada: error — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();
  onProgress(`Roots Canada: found ${allDeals.length} deals`);
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
      onProgress(`Roots Canada: loading more (page ${round + 1})…`);
      await page.waitForTimeout(2000);
    } catch (_) { break; }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
