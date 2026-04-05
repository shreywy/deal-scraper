'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Reigning Champ';
const STORE_KEY = 'reigningchamp';
const CURRENCY = 'CAD';

const COLLECTIONS = [
  { url: 'https://reigningchamp.com/collections/sale/products.json?limit=250', label: 'sale' },
  { url: 'https://reigningchamp.com/collections/outlet/products.json?limit=250', label: 'outlet' },
];

/**
 * Reigning Champ — Canadian premium basics brand (Shopify).
 * Uses Shopify products.json API first, browser XHR fallback.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Reigning Champ: trying Shopify API…');

  const seen = new Set();
  const allDeals = [];

  for (const { url, label } of COLLECTIONS) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        timeout: 15000,
      });

      if (!res.ok) {
        onProgress(`Reigning Champ: ${label} API returned ${res.status}`);
        continue;
      }

      const data = await res.json();
      const products = data?.products || [];

      for (const p of products) {
        const d = mapShopifyProduct(p, seen);
        if (d) allDeals.push(d);
      }

      onProgress(`Reigning Champ: ${allDeals.length} deals from ${label} API`);
    } catch (err) {
      onProgress(`Reigning Champ: ${label} API error — ${err.message}`);
    }
  }

  if (allDeals.length > 0) {
    onProgress(`Reigning Champ: found ${allDeals.length} deals`);
    return allDeals;
  }

  // Browser fallback
  onProgress('Reigning Champ: API returned nothing, using browser…');
  return await browserScrape(browser, seen, onProgress);
}

function mapShopifyProduct(p, seen) {
  try {
    const name = p.title || '';
    if (!name) return null;

    const url = `https://reigningchamp.com/products/${p.handle}`;
    if (seen.has(url)) return null;
    seen.add(url);

    // Find a variant with compare_at_price set
    const variant = p.variants?.find(v => v.compare_at_price && parseFloat(v.compare_at_price) > parseFloat(v.price))
      || p.variants?.[0];

    if (!variant) return null;

    const price = parseFloat(variant.price || 0);
    const originalPrice = parseFloat(variant.compare_at_price || 0);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const image = p.images?.[0]?.src || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${p.id}`),
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

async function browserScrape(browser, seen, onProgress) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
  });

  const rawProducts = [];
  const seenIds = new Set();

  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('reigningchamp.com')) return;
    try {
      const json = await response.json();
      const products = json?.products || [];
      for (const p of products) {
        if (p.id && !seenIds.has(p.id)) { seenIds.add(p.id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const page = await context.newPage();
  const allDeals = [];

  try {
    await page.goto('https://reigningchamp.com/collections/sale', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    for (const p of rawProducts) {
      const d = mapShopifyProduct(p, seen);
      if (d) allDeals.push(d);
    }

    if (allDeals.length === 0) {
      const domDeals = await page.evaluate(({ storeName, storeKey }) => {
        const parsePrice = el => {
          const n = parseFloat((el?.textContent || '').replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };
        const cards = document.querySelectorAll('[class*="product-card"], [class*="product-item"], [class*="ProductCard"]');
        const seen = new Set();
        return [...cards].map(card => {
          const link = card.querySelector('a[href]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);
          const name = card.querySelector('[class*="product-title"], [class*="product-name"], h3, h2')?.textContent?.trim() || '';
          const saleEl = card.querySelector('[class*="sale-price"], [class*="price-sale"]');
          const origEl = card.querySelector('del, s, [class*="compare-at"], [class*="was-price"]');
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
        if (!seen.has(d.url)) {
          seen.add(d.url);
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
    onProgress(`Reigning Champ: browser error — ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }

  onProgress(`Reigning Champ: found ${allDeals.length} deals`);
  return allDeals;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
