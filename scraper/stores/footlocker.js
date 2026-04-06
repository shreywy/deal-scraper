'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Foot Locker';
const STORE_KEY = 'footlocker';
const CURRENCY = 'CAD';

const SALE_URL = 'https://www.footlocker.ca/en/category/sale.html';

/**
 * Foot Locker Canada — XHR intercept for product API
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
    if (!url.includes('footlocker') && !url.includes('products') && !url.includes('search')) return;

    try {
      const json = await response.json();

      // Common API response patterns
      const products =
        json?.data?.products ||
        json?.products ||
        json?.productListings ||
        json?.hits ||
        json?.results ||
        json?.items ||
        [];

      for (const p of products) {
        const id = p.id || p.productId || p.sku || p.code || '';
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        rawProducts.push(p);
      }
    } catch (_) {}
  });

  onProgress('Foot Locker: loading sale page...');
  const page = await context.newPage();
  const allDeals = [];
  const seenUrls = new Set();

  try {
    const response = await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    if (response && (response.status() === 403 || response.status() === 404 || response.status() === 503)) {
      onProgress(`Foot Locker: page returned ${response.status()} - possible bot block`);
      await page.close();
      await context.close();
      return [];
    }

    // Cookie consent
    try { await page.click('#onetrust-accept-btn-handler, [data-testid="cookie-accept"]', { timeout: 3000 }); } catch (_) {}

    await page.waitForTimeout(4000);

    // Scroll to trigger lazy loading
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    // Process XHR products
    onProgress(`Foot Locker: processing ${rawProducts.length} API products...`);
    for (const p of rawProducts) {
      const d = mapProduct(p, seenUrls);
      if (d) allDeals.push(d);
    }

    // DOM fallback if no XHR products
    if (allDeals.length === 0) {
      onProgress('Foot Locker: no API products, trying DOM scraping...');
      const domDeals = await page.evaluate(({ storeName, storeKey }) => {
        const parsePrice = text => {
          if (!text) return null;
          const match = text.match(/\$?([\d,]+\.?\d*)/);
          if (!match) return null;
          const n = parseFloat(match[1].replace(/,/g, ''));
          return isNaN(n) ? null : n;
        };

        const cards = [...document.querySelectorAll('.ProductCard')];

        const seen = new Set();
        return cards.map(card => {
          const link = card.querySelector('a[href*="/product/"]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);

          // Name is in .ProductName-primary
          const nameEl = card.querySelector('.ProductName-primary');
          const name = nameEl?.textContent?.trim() || '';

          // Price structure: .ProductPrice contains both sale and original prices
          const priceContainer = card.querySelector('.ProductPrice');
          if (!priceContainer) return null;

          const priceText = priceContainer.textContent || '';
          // Extract prices from text like "Price dropped from $225.00 to $168.75"
          const priceMatch = priceText.match(/from\s+\$?([\d,]+\.?\d*)\s+to\s+\$?([\d,]+\.?\d*)/);

          let price, originalPrice;
          if (priceMatch) {
            originalPrice = parseFloat(priceMatch[1].replace(/,/g, ''));
            price = parseFloat(priceMatch[2].replace(/,/g, ''));
          } else {
            // Fallback: look for line-through and sale price
            const salePriceEl = priceContainer.querySelector('[class*="sale"]');
            const origPriceEl = priceContainer.querySelector('.line-through');
            price = parsePrice(salePriceEl?.textContent);
            originalPrice = parsePrice(origPriceEl?.textContent);
          }

          if (!price || !originalPrice || price >= originalPrice) return null;
          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;

          // Image
          const imgEl = card.querySelector('img[src]');
          const image = imgEl?.src || '';

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
  } catch (err) {
    onProgress(`Foot Locker: error — ${err.message}`);
  } finally {
    await page.close();
  }

  await context.close();

  onProgress(`Foot Locker: found ${allDeals.length} deals`);
  return allDeals;
}

function mapProduct(p, seen) {
  try {
    const name = p.name || p.title || p.productName || '';
    if (!name) return null;

    const price = parseFloat(
      p.price?.sale ||
      p.salePrice ||
      p.price?.current ||
      p.currentPrice ||
      p.price ||
      0
    );
    const originalPrice = parseFloat(
      p.price?.original ||
      p.price?.list ||
      p.originalPrice ||
      p.listPrice ||
      p.msrp ||
      0
    );

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const id = p.id || p.productId || p.sku || '';
    const url = p.url || p.pdpUrl || (id ? `https://www.footlocker.ca/en/product/${id}` : '');

    if (!url || seen.has(url)) return null;
    seen.add(url);

    const image =
      p.image?.url ||
      p.image ||
      p.images?.[0]?.url ||
      p.images?.[0] ||
      p.imageUrl ||
      '';

    // Extract category/gender from API if available (for better Kids detection)
    const category = p.category || p.categoryName || p.productType || '';
    const gender = p.gender || p.ageGroup || '';

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
      tags: tag({ name, category, gender }),
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
