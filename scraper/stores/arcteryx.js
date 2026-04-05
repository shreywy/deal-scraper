'use strict';

const { tag } = require('../tagger');

const STORE_NAME = "Arc'teryx";
const STORE_KEY = 'arcteryx';
const CURRENCY = 'CAD';

const SALE_URLS = [
  'https://arcteryx.com/ca/en/c/sale/',
  'https://arcteryx.com/ca/en/c/outlet/',
];

/**
 * Arc'teryx Canada — premium outdoor / lifestyle brand.
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
    if (!url.includes('arcteryx.com')) return;
    try {
      const json = await response.json();
      extractProducts(json, rawProducts, seenIds);
    } catch (_) {}
  });

  const seenUrls = new Set();
  const allDeals = [];

  for (const saleUrl of SALE_URLS) {
    const label = saleUrl.includes('outlet') ? 'outlet' : 'sale';
    onProgress(`Arc'teryx: loading ${label} page…`);
    const page = await context.newPage();
    try {
      await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      try { await page.click('#onetrust-accept-btn-handler, [class*="cookie"] button', { timeout: 4000 }); } catch (_) {}
      await page.waitForTimeout(3000);

      for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
        try {
          const btn = await page.$('button[class*="load-more"], button[class*="loadMore"], [data-testid*="load-more"]');
          if (btn && await btn.isVisible()) { await btn.click(); await page.waitForTimeout(2000); }
        } catch (_) {}
      }

      const domDeals = await page.evaluate(({ storeName, storeKey }) => {
        const parsePrice = el => {
          const n = parseFloat((el?.textContent || '').replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };
        const cards = document.querySelectorAll(
          '[class*="ProductCard"], [class*="product-card"], [data-testid*="product-card"], [class*="ProductTile"]'
        );
        const seen = new Set();
        return [...cards].map(card => {
          const link = card.querySelector('a[href]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);
          const nameEl = card.querySelector('[class*="name"], [class*="title"], h2, h3');
          const name = nameEl?.textContent?.trim() || '';
          // Arc'teryx shows original price crossed out, sale price highlighted
          const origPriceEl = card.querySelector('del, s, [class*="original"], [class*="was"], [class*="compare"]');
          const salePriceEl = card.querySelector('[class*="sale"], [class*="Sale"], [class*="markdown"], [class*="promo"]');
          const imgEl = card.querySelector('img');
          let price = parsePrice(salePriceEl);
          let originalPrice = parsePrice(origPriceEl);
          // If no explicit sale element, check for two price elements
          if (!price || !originalPrice) {
            const priceEls = [...card.querySelectorAll('[class*="price"], [class*="Price"]')];
            if (priceEls.length >= 2) {
              const vals = priceEls.map(el => parsePrice(el)).filter(Boolean);
              if (vals.length >= 2) {
                price = Math.min(...vals);
                originalPrice = Math.max(...vals);
              }
            }
          }
          if (!name || !price || !originalPrice || price >= originalPrice) return null;
          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;
          return { store: storeName, storeKey, name, url, image: imgEl?.src || '', price, originalPrice, discount, tags: [] };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY });

      for (const d of domDeals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          allDeals.push(d);
        }
      }
    } catch (err) {
      onProgress(`Arc'teryx: error on ${label} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  // XHR products
  for (const p of rawProducts) {
    const d = mapProduct(p);
    if (d && !seenUrls.has(d.url)) {
      seenUrls.add(d.url);
      allDeals.push(d);
    }
  }

  const tagged = allDeals.map(d => ({
    ...d,
    id: d.id || slugify(`${STORE_KEY}-${d.name}`),
    currency: CURRENCY,
    priceCAD: d.price,
    originalPriceCAD: d.originalPrice,
    tags: tag({ name: d.name }),
    scrapedAt: new Date().toISOString(),
  }));

  await context.close();
  onProgress(`Arc'teryx: found ${tagged.length} deals`);
  return tagged;
}

function extractProducts(json, out, seenIds) {
  const candidates = [json?.products, json?.items, json?.data?.products, json?.results];
  for (const list of candidates) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      const id = p?.id || p?.productId || p?.sku;
      if (!id || seenIds.has(id)) continue;
      seenIds.add(id);
      out.push(p);
    }
  }
}

function mapProduct(p) {
  try {
    const name = p.displayName || p.name || p.title || '';
    if (!name) return null;
    const price = parseFloat(p.salePrice || p.price?.sale || 0);
    const originalPrice = parseFloat(p.listPrice || p.regularPrice || p.price?.list || 0);
    if (!price || !originalPrice || price >= originalPrice) return null;
    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;
    const slug = p.slug || p.handle || p.id || '';
    const url = p.url || (slug ? `https://arcteryx.com/ca/en/p/${slug}` : '');
    if (!url) return null;
    const image = p.images?.[0]?.url || p.image || '';
    return {
      id: slugify(`${STORE_KEY}-${name}-${slug}`),
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
