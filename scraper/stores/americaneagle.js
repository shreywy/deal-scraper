'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'American Eagle';
const STORE_KEY = 'americaneagle';
const CURRENCY = 'CAD';

const SALE_PAGES = [
  { url: 'https://www.ae.com/ca/en/content/category/womens-clearance-sale', gender: 'Women' },
  { url: 'https://www.ae.com/ca/en/content/category/mens-clearance-sale', gender: 'Men' },
];

/**
 * American Eagle CA — DOM scrape of the clearance/sale pages (CAD prices).
 * AE uses React with SSR — product cards are in the DOM.
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

  const rawProducts = [];
  const seenIds = new Set();

  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('ae.com')) return;
    try {
      const json = await response.json();
      const products = json?.products || json?.data?.products || json?.results || [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.productId || p.id || p.code;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const seenUrls = new Set();
  const allDeals = [];

  for (const { url: pageUrl, gender } of SALE_PAGES) {
    onProgress(`American Eagle: loading ${gender} clearance…`);
    const page = await context.newPage();
    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      try { await page.click('#onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}
      await page.waitForTimeout(3000);

      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
        try {
          const btn = await page.$('[data-testid="load-more-btn"], button[class*="load-more"]');
          if (btn && await btn.isVisible()) { await btn.click(); await page.waitForTimeout(2000); }
        } catch (_) {}
      }

      const domDeals = await page.evaluate(({ storeName, storeKey, gender }) => {
        const parsePrice = el => {
          const n = parseFloat((el?.textContent || '').replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };
        const cards = document.querySelectorAll(
          '[data-testid="product-card"], [class*="ProductCard"], [class*="product-item"], [class*="product-card"]'
        );
        const seen = new Set();
        return [...cards].map(card => {
          const link = card.querySelector('a[href]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);
          const nameEl = card.querySelector('[data-testid="product-name"], [class*="product-name"], [class*="name"], h3, h2');
          const name = nameEl?.textContent?.trim() || '';
          const origEl = card.querySelector('del, s, [class*="original-price"], [class*="was-price"], [class*="list-price"]');
          const saleEl = card.querySelector('[class*="sale-price"], [class*="clearance"], [class*="promo-price"]');
          const imgEl = card.querySelector('img[src]');
          const originalPrice = parsePrice(origEl);
          const price = parsePrice(saleEl);
          if (!name || !price || !originalPrice || price >= originalPrice) return null;
          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;
          return { store: storeName, storeKey, name, url, image: imgEl?.src || '', price, originalPrice, discount, gender, tags: [] };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY, gender });

      for (const d of domDeals) {
        if (!seenUrls.has(d.url)) { seenUrls.add(d.url); allDeals.push(d); }
      }

      // XHR products
      for (const p of rawProducts) {
        const d = mapXHRProduct(p, gender, seenUrls);
        if (d) allDeals.push(d);
      }
    } catch (err) {
      onProgress(`American Eagle: error on ${gender} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();

  const tagged = allDeals.map(d => ({
    ...d,
    id: d.id || slugify(`${STORE_KEY}-${d.name}`),
    currency: CURRENCY,
    priceCAD: d.price,
    originalPriceCAD: d.originalPrice,
    tags: tag({ name: d.name, gender: d.gender || '' }),
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`American Eagle: found ${tagged.length} deals`);
  return tagged;
}

function mapXHRProduct(p, gender, seen) {
  try {
    const name = p.name || p.title || p.displayName || '';
    if (!name) return null;
    const price = parseFloat(p.salePrice || p.price?.sale || 0);
    const originalPrice = parseFloat(p.listPrice || p.regularPrice || p.price?.list || 0);
    if (!price || !originalPrice || price >= originalPrice) return null;
    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;
    const slug = p.slug || p.url || p.id || '';
    const url = slug.startsWith('http') ? slug : `https://www.ae.com/ca/en/p/${slug}`;
    if (seen.has(url)) return null;
    seen.add(url);
    const image = p.imageUrl || p.images?.[0]?.url || '';
    return {
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
      gender,
      tags: tag({ name, gender }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
