'use strict';

const { tag } = require('../tagger');

// Columbia Sportswear uses Salesforce Commerce Cloud (SFCC)
// SFCC supports ?sz=N to request N products per page

const URL = 'https://www.columbia.com/ca/en/c/sale/?sz=120';
const STORE_NAME = 'Columbia CA';
const STORE_KEY = 'columbia';

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

  // Intercept XHR responses from SFCC
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json') && !ct.includes('text/html')) return;

    try {
      const json = await response.json();
      extractColumbiaProducts(json, interceptedProducts, seenIds);
    } catch (_) {
      // Not JSON, ignore
    }
  });

  try {
    onProgress('Columbia: navigating to sale page…');
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Dismiss cookie banner
    try {
      await page.click('#onetrust-accept-btn-handler, [class*="onetrust-accept"], button:has-text("Accept")', { timeout: 4000 });
    } catch (_) {}

    await page.waitForTimeout(3000);

    // Scroll to load more products
    await loadAllProductsScroll(page, interceptedProducts, onProgress);

    if (interceptedProducts.length > 0) {
      const deals = interceptedProducts.map(p => mapColumbiaProduct(p)).filter(Boolean);
      onProgress(`Columbia: found ${deals.length} deals (XHR)`);
      await context.close();
      return deals;
    }

    // DOM fallback
    onProgress('Columbia: trying DOM scrape…');
    const rawDeals = await page.evaluate(({ storeName, storeKey }) => {
      const tiles = document.querySelectorAll('.product-tile, .product-grid-tile, [class*="product-card"], [data-itemid]');

      const parsePrice = el => {
        if (!el) return null;
        const text = el.textContent || '';
        const n = parseFloat(text.replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : n;
      };

      const seen = new Set();
      return [...tiles].map(tile => {
        const link = tile.querySelector('a[href*="/product/"], a.name-link, a.link, a[href]');
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
        const salePriceEl = tile.querySelector('.price-sales, .sale-price, [class*="sales-price"], [class*="sale-price"]');
        const origPriceEl = tile.querySelector('.price-standard, .strike-through, .price-was, [class*="standard-price"], s, del, strike');

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
      id: slugify(`columbia-${d.name}`),
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));
    onProgress(`Columbia: found ${tagged.length} deals (DOM)`);
    return tagged;

  } catch (error) {
    onProgress(`Columbia: error - ${error.message}`);
    return [];
  } finally {
    await context.close();
  }
}

function extractColumbiaProducts(json, out, seenIds) {
  const products = json?.products || json?.hits || json?.productData || [];

  const arr = Array.isArray(products) ? products : Object.values(products);
  for (const p of arr) {
    const id = p?.id || p?.productId || p?.sku;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    out.push(p);
  }
}

function mapColumbiaProduct(p) {
  try {
    const name = p.productName || p.name || p.title || '';
    if (!name) return null;

    const priceData = p.price || p.pricing || {};
    const price = parseFloat(priceData.sales || priceData.sale || priceData.current || 0);
    const originalPrice = parseFloat(priceData.list || priceData.standard || priceData.was || 0);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const url = p.url || p.productUrl || p.link || '';
    const fullUrl = url.startsWith('http')
      ? url
      : `https://www.columbia.com${url.startsWith('/') ? '' : '/'}${url}`;

    const image = p.image?.url || p.imageUrl || p.images?.[0]?.url || '';

    return {
      id: slugify(`columbia-${name}-${p.id || ''}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url: fullUrl,
      image,
      price,
      originalPrice,
      discount,
      currency: 'CAD',
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
        onProgress(`Columbia: loading… (${interceptedProducts.length} products)`);
      }
    }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
