'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Patagonia CA';
const STORE_KEY = 'patagonia';
const CURRENCY = 'CAD';

// Patagonia runs on Salesforce Commerce Cloud (SFCC), not Shopify
// They have a search endpoint that returns AJAX product data
const SEARCH_URL = 'https://www.patagonia.com/on/demandware.store/Sites-patagonia-ca-Site/en_CA/Search-Show';
const FALLBACK_URL = 'https://www.patagonia.com/c/on-sale/';

/**
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
  const page = await context.newPage();

  const interceptedProducts = [];
  const seenIds = new Set();

  // Intercept XHR responses from SFCC search
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json') && !ct.includes('text/html')) return;

    try {
      const json = await response.json();
      extractPatagoniaProducts(json, interceptedProducts, seenIds);
    } catch (_) {
      // Not JSON, ignore
    }
  });

  try {
    onProgress('Patagonia: navigating to sale page…');

    // Try the SFCC search endpoint first
    const searchParams = new URLSearchParams({
      q: 'sale',
      srule: 'best-sellers',
      start: '0',
      sz: '96',
      format: 'ajax'
    });
    const searchUrlWithParams = `${SEARCH_URL}?${searchParams.toString()}`;

    try {
      await page.goto(searchUrlWithParams, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    } catch (err) {
      onProgress('Patagonia: AJAX endpoint failed, trying fallback URL…');
      await page.goto(FALLBACK_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);
    }

    // Scroll to load more products (infinite scroll)
    await loadAllProductsScroll(page, interceptedProducts, onProgress);

    if (interceptedProducts.length > 0) {
      const deals = interceptedProducts.map(p => mapPatagoniaProduct(p)).filter(Boolean);
      onProgress(`Patagonia: found ${deals.length} deals (XHR)`);
      return deals;
    }

    // DOM fallback — SFCC typically renders product grids server-side
    onProgress('Patagonia: trying DOM scrape…');
    const rawDeals = await page.evaluate(({ storeName, storeKey }) => {
      // SFCC common selectors:
      // Product tiles: .product-tile, .product-grid-tile, [data-itemid]
      // Price: .price-sales, .sale-price, .product-sales-price
      // Original price: .price-standard, .strike-through, .price-was
      const tiles = document.querySelectorAll('.product-tile, .product-grid-tile, [class*="product-card"], [data-itemid]');

      const parsePrice = el => {
        if (!el) return null;
        const text = el.textContent || '';
        // Handle formats like "$89.00" or "C$89.00"
        const n = parseFloat(text.replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : n;
      };

      const seen = new Set();
      return [...tiles].map(tile => {
        const link = tile.querySelector('a[href*="/product/"], a.name-link, a.link');
        const url = link?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);

        const name = (
          tile.querySelector('.product-name, .product-title, [class*="product-name"]')?.textContent ||
          link?.getAttribute('title') ||
          link?.textContent ||
          ''
        ).trim();

        const imgEl = tile.querySelector('img.tile-image, img[class*="product-image"], img');
        const image = imgEl?.src || imgEl?.dataset?.src || '';

        // SFCC sale/original price structure
        const salePriceEl = tile.querySelector('.price-sales, .sale-price, [class*="sales-price"]');
        const origPriceEl = tile.querySelector('.price-standard, .strike-through, .price-was, [class*="standard-price"]');

        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);

        if (!name || !url || !price || !originalPrice || price >= originalPrice) return null;

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
          currency: 'CAD',
          tags: []
        };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = rawDeals.map(d => ({
      ...d,
      id: slugify(`patagonia-${d.name}`),
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));
    onProgress(`Patagonia: found ${tagged.length} deals (DOM)`);
    return tagged;

  } catch (error) {
    onProgress(`Patagonia: error - ${error.message}`);
    return [];
  } finally {
    await context.close();
  }
}

function extractPatagoniaProducts(json, out, seenIds) {
  // SFCC typically returns products in json.products, json.hits, or json.productData
  const products = json?.products || json?.hits || json?.productData || [];

  const arr = Array.isArray(products) ? products : Object.values(products);
  for (const p of arr) {
    const id = p?.id || p?.productId || p?.sku;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    out.push(p);
  }
}

function mapPatagoniaProduct(p) {
  try {
    const name = p.productName || p.name || p.title || '';
    if (!name) return null;

    // SFCC price structure
    const priceData = p.price || p.pricing || {};
    const price = parseFloat(priceData.sales || priceData.sale || priceData.current || 0);
    const originalPrice = parseFloat(priceData.list || priceData.standard || priceData.was || 0);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const url = p.url || p.productUrl || p.link || '';
    const fullUrl = url.startsWith('http')
      ? url
      : `https://www.patagonia.com${url.startsWith('/') ? '' : '/'}${url}`;

    const image = p.image?.url || p.imageUrl || p.images?.[0]?.url || '';

    return {
      id: slugify(`patagonia-${name}-${p.id || ''}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url: fullUrl,
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

async function loadAllProductsScroll(page, interceptedProducts, onProgress) {
  let lastHeight = 0;
  let lastCount = 0;
  let stable = 0;

  for (let i = 0; i < 20; i++) {
    const h = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    if (h === lastHeight && interceptedProducts.length === lastCount) {
      if (++stable >= 3) break;
    } else {
      stable = 0;
      lastHeight = h;
      lastCount = interceptedProducts.length;
      if (interceptedProducts.length) {
        onProgress(`Patagonia: loading… (${interceptedProducts.length} products)`);
      }
    }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
