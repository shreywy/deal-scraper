'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'Dickies';
const STORE_KEY = 'dickies';
const CURRENCY = 'USD';

// Dickies uses Shopify API
const SHOPIFY_URL = 'https://www.dickies.com/collections/sale/products.json?limit=250';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(_browser, onProgress = () => {}) {
  onProgress('Dickies: fetching sale products from Shopify API…');

  const exchangeRate = await getUSDtoCAD();
  onProgress(`Dickies: USD→CAD rate: ${exchangeRate.toFixed(4)}`);

  const allProducts = [];
  let page = 1;

  while (page <= 5) {
    const url = page === 1 ? SHOPIFY_URL : `${SHOPIFY_URL}&page=${page}`;

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
        timeout: 15000,
      });

      if (!res.ok) {
        onProgress(`Dickies: Shopify API returned ${res.status}, falling back to browser scrape…`);
        return await scrapeBrowser(_browser, onProgress, exchangeRate);
      }

      const data = await res.json();
      const products = data.products || [];

      if (products.length === 0) break;

      allProducts.push(...products);
      onProgress(`Dickies: fetched ${allProducts.length} products…`);

      if (products.length < 250) break;
      page++;
    } catch (err) {
      onProgress(`Dickies: Shopify API error: ${err.message}, falling back to browser scrape…`);
      return await scrapeBrowser(_browser, onProgress, exchangeRate);
    }
  }

  const seen = new Set();
  const deals = allProducts.map(p => mapShopifyProduct(p, seen, exchangeRate)).filter(Boolean);

  onProgress(`Dickies: found ${deals.length} deals`);
  return deals;
}

/**
 * Fallback browser scrape if Shopify API fails
 */
async function scrapeBrowser(browser, onProgress, exchangeRate) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-CA',
    extraHTTPHeaders: { 'Accept-Language': 'en-CA,en;q=0.9' },
  });
  const page = await context.newPage();

  try {
    onProgress('Dickies: navigating to sale page…');
    await page.goto('https://www.dickies.com/collections/sale', { waitUntil: 'domcontentloaded', timeout: 35000 });

    await page.waitForTimeout(2000);

    // Scroll to load products
    onProgress('Dickies: loading products…');
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const parsePrice = el => {
        if (!el) return null;
        const text = (el.textContent || '').replace(/[^0-9.]/g, '');
        const n = parseFloat(text);
        return isNaN(n) ? null : n;
      };

      const cards = document.querySelectorAll('[class*="product-card"], .product-item, .grid-item');
      const seen = new Set();

      return [...cards].map(card => {
        const linkEl = card.querySelector('a[href*="/products/"]');
        const url = linkEl?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);

        const nameEl = card.querySelector('[class*="product-title"], .product-name, h3');
        const name = (nameEl?.textContent || '').trim();
        if (!name) return null;

        const imgEl = card.querySelector('img');
        const image = imgEl?.src || '';

        const salePriceEl = card.querySelector('[class*="sale"], .price--sale');
        const origPriceEl = card.querySelector('[class*="compare"], .price--compare');

        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);

        if (!price || !originalPrice || price >= originalPrice) return null;

        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;

        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, currency: 'USD', tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = deals.map(d => ({
      ...d,
      id: slugify(`dickies-${d.name}`),
      priceCAD: Math.round(d.price * exchangeRate * 100) / 100,
      originalPriceCAD: Math.round(d.originalPrice * exchangeRate * 100) / 100,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
      exchangeRate,
    }));

    onProgress(`Dickies: found ${tagged.length} deals (browser)`);
    return tagged;

  } finally {
    await context.close();
  }
}

function mapShopifyProduct(p, seen, exchangeRate) {
  try {
    const name = p.title || '';
    if (!name) return null;

    const variants = p.variants || [];
    if (variants.length === 0) return null;

    // Find cheapest variant with a discount
    let bestDeal = null;
    for (const v of variants) {
      const price = parseFloat(v.price || 0);
      const compareAt = parseFloat(v.compare_at_price || 0);

      if (!price || !compareAt || price >= compareAt) continue;

      if (!bestDeal || price < bestDeal.price) {
        bestDeal = { price, originalPrice: compareAt };
      }
    }

    if (!bestDeal) return null;

    const discount = Math.round((1 - bestDeal.price / bestDeal.originalPrice) * 100);
    if (discount <= 0) return null;

    const handle = p.handle || slugify(name);
    const url = `https://www.dickies.com/products/${handle}`;
    if (seen.has(url)) return null;
    seen.add(url);

    const image = p.images?.[0]?.src || '';

    return {
      id: slugify(`dickies-${name}-${handle}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price: bestDeal.price,
      originalPrice: bestDeal.originalPrice,
      discount,
      currency: CURRENCY,
      priceCAD: Math.round(bestDeal.price * exchangeRate * 100) / 100,
      originalPriceCAD: Math.round(bestDeal.originalPrice * exchangeRate * 100) / 100,
      tags: tag({ name }),
      scrapedAt: new Date().toISOString(),
      exchangeRate,
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
