'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Club Monaco';
const STORE_KEY = 'clubmonaco';
const CURRENCY = 'CAD';

const SALE_URLS = [
  { url: 'https://www.clubmonaco.ca/en/sale/', gender: '' },
];

/**
 * Club Monaco CA — Canadian brand (Ralph Lauren subsidiary).
 * Uses XHR interception + DOM fallback.
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
    if (!url.includes('clubmonaco') && !url.includes('ralphlauren')) return;
    try {
      const json = await response.json();
      const products = json?.products || json?.data?.products || json?.results || json?.items || [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.id || p.productId || p.code;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const seenUrls = new Set();
  const allDeals = [];

  for (const { url: saleUrl } of SALE_URLS) {
    onProgress('Club Monaco: loading sale page…');
    const page = await context.newPage();
    try {
      await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      try { await page.click('#onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}
      await page.waitForTimeout(3000);

      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
        try {
          const btn = await page.$('[data-testid*="load-more"], button[class*="load-more"], button[class*="LoadMore"]');
          if (btn && await btn.isVisible()) { await btn.click(); await page.waitForTimeout(2000); }
        } catch (_) {}
      }

      // XHR products
      for (const p of rawProducts) {
        const d = mapXHRProduct(p, seenUrls);
        if (d) allDeals.push(d);
      }

      if (allDeals.length === 0) {
        const domDeals = await page.evaluate(({ storeName, storeKey }) => {
          const parsePrice = el => {
            const n = parseFloat((el?.textContent || '').replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
          };
          const cards = document.querySelectorAll(
            '[class*="product-card"], [class*="ProductCard"], [class*="product-item"], [class*="tile"]'
          );
          const seen = new Set();
          return [...cards].map(card => {
            const link = card.querySelector('a[href]');
            const url = link?.href || '';
            if (!url || seen.has(url)) return null;
            seen.add(url);
            const nameEl = card.querySelector('[class*="name"], [class*="title"], h2, h3');
            const name = nameEl?.textContent?.trim() || '';
            const origEl = card.querySelector('del, s, [class*="original"], [class*="was"], [class*="compare"]');
            const saleEl = card.querySelector('[class*="sale"], [class*="markdown"], [class*="promo"]');
            const imgEl = card.querySelector('img');
            const price = parsePrice(saleEl);
            const originalPrice = parsePrice(origEl);
            if (!name || !price || !originalPrice || price >= originalPrice) return null;
            const discount = Math.round((1 - price / originalPrice) * 100);
            if (discount <= 0) return null;
            return { store: storeName, storeKey, name, url, image: imgEl?.src || '', price, originalPrice, discount, tags: [] };
          }).filter(Boolean);
        }, { storeName: STORE_NAME, storeKey: STORE_KEY });

        for (const d of domDeals) {
          if (!seenUrls.has(d.url)) { seenUrls.add(d.url); allDeals.push(d); }
        }
      }
    } catch (err) {
      onProgress(`Club Monaco: error — ${err.message}`);
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
    tags: tag({ name: d.name }),
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`Club Monaco: found ${tagged.length} deals`);
  return tagged;
}

function mapXHRProduct(p, seen) {
  try {
    const name = p.name || p.displayName || p.title || '';
    if (!name) return null;
    const price = parseFloat(p.salePrice || p.price?.sale || 0);
    const originalPrice = parseFloat(p.regularPrice || p.price?.list || p.listPrice || 0);
    if (!price || !originalPrice || price >= originalPrice) return null;
    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;
    const slug = p.slug || p.url || p.handle || p.id || '';
    const url = slug.startsWith('http') ? slug : `https://www.clubmonaco.ca/en/p/${slug}`;
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
      tags: tag({ name }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
