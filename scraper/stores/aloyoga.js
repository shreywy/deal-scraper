'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'Alo Yoga';
const STORE_KEY = 'aloyoga';
const CURRENCY = 'USD';

// Alo Yoga sale pages
const SALE_URLS = [
  { url: 'https://www.aloyoga.com/collections/sale-womens', gender: 'Women', label: "women's" },
  { url: 'https://www.aloyoga.com/collections/sale-mens', gender: 'Men', label: "men's" },
  { url: 'https://www.aloyoga.com/collections/sale', gender: '', label: 'all' },
];

/**
 * Alo Yoga — ships to Canada. USD prices converted to CAD.
 * Uses Shopify Storefront XHR interception + DOM fallback.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const rate = await getUSDtoCAD();

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  const rawProducts = [];
  const seenIds = new Set();

  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('aloyoga.com')) return;
    try {
      const json = await response.json();
      // Shopify Storefront API response format
      const products =
        json?.collection?.products?.edges?.map(e => e.node) ||
        json?.products?.edges?.map(e => e.node) ||
        json?.products ||
        [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.id || p.handle;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const seenUrls = new Set();
  const allDeals = [];

  for (const { url: saleUrl, gender, label } of SALE_URLS) {
    onProgress(`Alo Yoga: loading ${label} sale…`);
    const page = await context.newPage();
    try {
      await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      try { await page.click('#onetrust-accept-btn-handler', { timeout: 4000 }); } catch (_) {}
      await page.waitForTimeout(3000);

      for (let i = 0; i < 4; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
      }

      const domDeals = await page.evaluate(({ storeName, storeKey, defaultGender }) => {
        const parsePrice = el => {
          const n = parseFloat((el?.textContent || '').replace(/[^0-9.]/g, ''));
          return isNaN(n) ? null : n;
        };
        const cards = document.querySelectorAll(
          '[class*="product-card"], [class*="ProductCard"], [data-testid="product-card"], [class*="product-item"]'
        );
        const seen = new Set();
        return [...cards].map(card => {
          const link = card.querySelector('a[href]');
          const url = link?.href || '';
          if (!url || seen.has(url)) return null;
          seen.add(url);
          const name = card.querySelector('[class*="name"], [class*="title"], h2, h3')?.textContent?.trim() || '';
          const origEl = card.querySelector('del, s, [class*="compare"], [class*="original"], [class*="was"]');
          const saleEl = card.querySelector('[class*="sale"], [class*="Sale"], [class*="markdown"]');
          const imgEl = card.querySelector('img');
          let price = parsePrice(saleEl);
          let originalPrice = parsePrice(origEl);
          // If no explicit sale element, look for two price elements
          if (!price || !originalPrice) {
            const priceEls = [...card.querySelectorAll('[class*="price"], [class*="Price"]')]
              .filter(el => !el.querySelector('[class*="price"]')); // avoid nested containers
            const vals = priceEls.map(el => parsePrice(el)).filter(Boolean).sort((a, b) => a - b);
            if (vals.length >= 2) {
              price = vals[0];
              originalPrice = vals[vals.length - 1];
            }
          }
          if (!name || !price || !originalPrice || price >= originalPrice) return null;
          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) return null;
          return {
            store: storeName, storeKey, name, url,
            image: imgEl?.src || imgEl?.dataset?.src || '',
            price, originalPrice, discount, gender: defaultGender, tags: [],
          };
        }).filter(Boolean);
      }, { storeName: STORE_NAME, storeKey: STORE_KEY, defaultGender: gender });

      for (const d of domDeals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          allDeals.push(d);
        }
      }
    } catch (err) {
      onProgress(`Alo Yoga: error on ${label} — ${err.message}`);
    } finally {
      await page.close();
    }
    // Only need one successful collection; stop if we have deals
    if (allDeals.length > 0 && label === 'all') break;
  }

  // Also process any XHR-intercepted Shopify products
  for (const p of rawProducts) {
    const d = mapShopifyProduct(p, seenUrls, rate);
    if (d) allDeals.push(d);
  }

  await context.close();

  const tagged = allDeals.map(d => ({
    ...d,
    id: d.id || slugify(`${STORE_KEY}-${d.name}`),
    currency: CURRENCY,
    priceCAD: d.priceCAD || Math.round(d.price * rate * 100) / 100,
    originalPriceCAD: d.originalPriceCAD || Math.round(d.originalPrice * rate * 100) / 100,
    price: d.priceCAD || Math.round(d.price * rate * 100) / 100,
    originalPrice: d.originalPriceCAD || Math.round(d.originalPrice * rate * 100) / 100,
    tags: tag({ name: d.name, gender: d.gender || '' }),
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`Alo Yoga: found ${tagged.length} deals`);
  return tagged;
}

function mapShopifyProduct(p, seen, rate) {
  try {
    const name = p.title || p.displayName || '';
    if (!name) return null;
    const handle = p.handle || slugify(name);
    const url = `https://www.aloyoga.com/products/${handle}`;
    if (seen.has(url)) return null;
    seen.add(url);

    // Shopify Storefront API variant prices
    const variants = p.variants?.edges?.map(e => e.node) || p.variants || [];
    let priceUSD = null, origUSD = null;
    for (const v of variants) {
      const vPrice = parseFloat(v.priceV2?.amount || v.price?.amount || v.price || 0);
      const vCompare = parseFloat(v.compareAtPriceV2?.amount || v.compareAtPrice?.amount || v.compareAtPrice || 0);
      if (vCompare > vPrice && (priceUSD === null || vPrice < priceUSD)) {
        priceUSD = vPrice;
        origUSD = vCompare;
      }
    }
    if (!priceUSD || !origUSD || priceUSD >= origUSD) return null;
    const discount = Math.round((1 - priceUSD / origUSD) * 100);
    if (discount <= 0) return null;

    const priceCAD = Math.round(priceUSD * rate * 100) / 100;
    const originalPriceCAD = Math.round(origUSD * rate * 100) / 100;
    const images = p.images?.edges?.map(e => e.node) || p.images || [];
    const image = images[0]?.url || images[0]?.src || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${handle}`),
      store: STORE_NAME, storeKey: STORE_KEY,
      name, url, image,
      price: priceCAD, originalPrice: originalPriceCAD, discount,
      currency: CURRENCY, priceCAD, originalPriceCAD,
      tags: [], gender: '',
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
