'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Polo Ralph Lauren';
const STORE_KEY = 'ralphlauren';
const CURRENCY = 'CAD';

// Try multiple sale page URLs
const SALE_URLS = [
  'https://www.ralphlauren.com/en-ca/t/men-sale',
  'https://www.ralphlauren.com/en-ca/c/men-sale',
  'https://www.ralphlauren.com/en-ca/sale/men',
];

/**
 * Polo Ralph Lauren Canada — XHR intercept + DOM fallback
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
    extraHTTPHeaders: {
      'Accept-Language': 'en-CA,en;q=0.9',
    },
  });

  const rawProducts = [];
  const seenIds = new Set();

  // Intercept API responses
  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;

    // Look for product API endpoints
    if (!url.includes('ralphlauren') && !url.includes('products') && !url.includes('search')) return;

    try {
      const json = await response.json();

      const products =
        json?.products ||
        json?.hits ||
        json?.data?.products ||
        json?.results ||
        json?.items ||
        json?.productListings ||
        [];

      for (const p of products) {
        const id = p.id || p.productId || p.sku || p.code || '';
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        rawProducts.push(p);
      }
    } catch (_) {}
  });

  onProgress('Polo Ralph Lauren: loading sale pages...');
  const page = await context.newPage();
  const allDeals = [];
  const seenUrls = new Set();

  for (const saleUrl of SALE_URLS) {
    try {
      onProgress(`Polo Ralph Lauren: trying ${saleUrl}...`);
      const response = await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });

      if (response && (response.status() === 403 || response.status() === 404 || response.status() === 503)) {
        onProgress(`Polo Ralph Lauren: ${saleUrl} returned ${response.status()}`);
        continue;
      }

      // Cookie consent
      try { await page.click('#onetrust-accept-btn-handler, [data-testid="cookie-accept"]', { timeout: 3000 }); } catch (_) {}

      await page.waitForTimeout(4000);

      // Scroll to load lazy content
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
      }

      // Process XHR products
      if (rawProducts.length > 0) {
        onProgress(`Polo Ralph Lauren: processing ${rawProducts.length} API products...`);
        for (const p of rawProducts) {
          const d = mapProduct(p, seenUrls);
          if (d) allDeals.push(d);
        }
      }

      // DOM fallback
      if (allDeals.length === 0) {
        onProgress('Polo Ralph Lauren: trying DOM scraping...');
        const domDeals = await page.evaluate(({ storeName, storeKey }) => {
          const parsePrice = el => {
            if (!el) return null;
            const n = parseFloat((el.textContent || '').replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
          };

          const cardSels = [
            '.product, .product-tile, .product-card',
            'div[class*="product"]',
            'article[class*="product"]',
            'li[class*="product"]',
          ];

          let cards = [];
          for (const sel of cardSels) {
            const found = [...document.querySelectorAll(sel)];
            if (found.length > 0) { cards = found; break; }
          }

          const seen = new Set();
          return cards.map(card => {
            const link = card.querySelector('a[href*="/p/"], a[href*="/product/"], a[href]');
            const url = link?.href || '';
            if (!url || seen.has(url)) return null;
            seen.add(url);

            const name = card.querySelector('.product-name, .pdp-link, h2, h3, [class*="name"]')?.textContent?.trim() || '';

            const salePriceEl = card.querySelector('.price .sales, .sale-price, [class*="sale"]');
            const origPriceEl = card.querySelector('.price .strike-through, .original-price, del, s, [class*="strike"]');

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
      }

      if (allDeals.length > 0) break; // Success, stop trying URLs
    } catch (err) {
      onProgress(`Polo Ralph Lauren: error on ${saleUrl} — ${err.message}`);
    }
  }

  await page.close();
  await context.close();

  onProgress(`Polo Ralph Lauren: found ${allDeals.length} deals`);
  return allDeals;
}

function mapProduct(p, seen) {
  try {
    const name = p.productName || p.name || p.title || '';
    if (!name) return null;

    const price = parseFloat(
      p.price?.sales?.value ||
      p.price?.sales ||
      p.salePrice ||
      p.price?.current ||
      p.currentPrice ||
      0
    );
    const originalPrice = parseFloat(
      p.price?.list?.value ||
      p.price?.list ||
      p.listPrice ||
      p.originalPrice ||
      p.price?.original ||
      0
    );

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const id = p.productId || p.id || p.sku || '';
    const url = p.pdpUrl || p.url || (id ? `https://www.ralphlauren.com/en-ca/p/${id}` : '');

    if (!url || seen.has(url)) return null;
    seen.add(url);

    const image =
      p.images?.[0]?.url ||
      p.images?.[0]?.link ||
      p.image?.url ||
      p.imageUrl ||
      '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${id}`),
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
    };
  } catch (_) {
    return null;
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
