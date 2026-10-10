'use strict';

// Shared scraper for Shopify stores via the public /collections/<handle>/products.json API.
// Requests run inside a real browser page: many Shopify storefronts (behind Cloudflare) now
// answer 429 to plain HTTP clients but serve the same JSON to a browser.

const { tag } = require('./tagger');
const { getUSDtoCAD } = require('./currency');

// products.json always returns the shop's *base* currency. We read the storefront's
// Shopify.currency to see what this visitor would pay: if the shop shows CAD, convert with
// Shopify's own rate (rate is 1 when the base is CAD); otherwise keep the base (USD) prices
// and let the frontend show a live-rate CAD estimate.

/**
 * @param {object} opts
 * @param {string} opts.origin        e.g. 'https://www.volcom.com'
 * @param {Array<string|{handle:string,gender?:string}>} opts.collections
 */
async function scrapeShopify(browser, onProgress, { storeKey, storeName, origin, collections }) {
  const context = await browser.newContext({ locale: 'en-CA' });
  const page = await context.newPage();
  const deals = [];
  const seen = new Set();
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const shop = await page.evaluate(() => window.Shopify?.currency || null);
    const cadStorefront = shop?.active === 'CAD';
    const currency = cadStorefront ? 'CAD' : 'USD';
    const rate = cadStorefront ? Number(shop.rate) || 1 : await getUSDtoCAD();
    for (const c of collections) {
      const { handle, gender = '' } = typeof c === 'string' ? { handle: c } : c;
      for (let n = 1; n <= 20; n++) {
        const products = await page.evaluate(async path => {
          for (let attempt = 1; attempt <= 4; attempt++) {
            const r = await fetch(path);
            if (r.status === 429) { await new Promise(res => setTimeout(res, 3000 * attempt)); continue; } // storefront throttle
            return r.ok ? (await r.json()).products || [] : [];
          }
          return [];
        }, `/collections/${handle}/products.json?limit=250&page=${n}`);
        for (const p of products) {
          const d = mapProduct(p, { storeKey, storeName, origin, currency, rate, gender });
          if (d && !seen.has(d.url)) { seen.add(d.url); deals.push(d); }
        }
        if (products.length < 250) break;
      }
      onProgress(`${storeName}: ${deals.length} deals after ${handle}`);
    }
  } finally {
    await context.close();
  }
  return deals;
}

function mapProduct(p, { storeKey, storeName, origin, currency, rate, gender }) {
  // Cheapest discounted, available variant (fall back to any discounted one if availability isn't exposed)
  const discounted = (p.variants || [])
    .map(v => ({ price: parseFloat(v.price), orig: parseFloat(v.compare_at_price), available: v.available }))
    .filter(v => v.price > 0 && v.orig > v.price);
  const pool = discounted.some(v => v.available) ? discounted.filter(v => v.available) : discounted;
  if (!p.title || !pool.length || discounted.every(v => v.available === false)) return null;
  const best = pool.reduce((a, b) => (b.price < a.price ? b : a));
  const cad = x => Math.round(x * rate * 100) / 100;
  // CAD storefront: price/originalPrice are what a Canadian shopper sees
  const [price, originalPrice] = currency === 'CAD' ? [cad(best.price), cad(best.orig)] : [best.price, best.orig];
  return {
    id: `${storeKey}-${p.handle}`,
    store: storeName,
    storeKey,
    name: p.title,
    url: `${origin}/products/${p.handle}`,
    image: p.images?.[0]?.src || '',
    price,
    originalPrice,
    discount: Math.round((1 - best.price / best.orig) * 100),
    currency,
    priceCAD: cad(best.price),
    originalPriceCAD: cad(best.orig),
    ...(currency === 'USD' && { exchangeRate: rate }),
    tags: tag({ name: p.title, category: p.product_type || '', gender }),
    scrapedAt: new Date().toISOString(),
  };
}

module.exports = { scrapeShopify };
