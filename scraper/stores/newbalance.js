'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'New Balance';
const STORE_KEY = 'newbalance';
const CURRENCY = 'USD';
const SALE_URL = 'https://www.newbalance.com/sale/?sz=120';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('New Balance: fetching USD→CAD rate…');
  const rate = await getUSDtoCAD();
  onProgress(`New Balance: 1 USD = ${rate.toFixed(4)} CAD`);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = await context.newPage();

  // Track XHR intercepted products
  const intercepted = [];
  const interceptedIds = new Set();

  page.on('response', async response => {
    const url = response.url();
    // SFCC Demandware API endpoints
    if (url.includes('/on/demandware.store/') || url.includes('/dw/shop/v')) {
      try {
        const json = await response.json();
        const products = json?.hits || json?.products || [];
        for (const p of products) {
          const id = p.product_id || p.id || p.masterId;
          if (id && !interceptedIds.has(id)) {
            interceptedIds.add(id);
            intercepted.push(p);
          }
        }
      } catch (_) {}
    }
  });

  try {
    onProgress('New Balance: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Dismiss any overlays
    try {
      await page.click('#onetrust-accept-btn-handler, [class*="accept-cookies"]', { timeout: 3000 });
    } catch (_) {}

    // Wait for products
    try {
      await page.waitForSelector('.product-tile, .product-card, [class*="ProductTile"]', { timeout: 15000 });
    } catch (_) {
      onProgress('New Balance: no product grid visible, proceeding anyway…');
    }

    // Scroll to trigger lazy loading (SFCC sites lazy load images)
    await scrollAndLoad(page, onProgress);

    // If we intercepted API data, use it
    if (intercepted.length > 0) {
      const deals = intercepted.map(p => mapSFCCProduct(p, rate)).filter(Boolean);
      if (deals.length > 0) {
        onProgress(`New Balance: found ${deals.length} deals (XHR)`);
        await context.close();
        return deals;
      }
    }

    // DOM scraping fallback
    onProgress('New Balance: DOM scrape…');
    const deals = await page.evaluate(({ storeName, storeKey }) => {
      const cards = document.querySelectorAll('.product-tile, .product-card, [class*="ProductTile"], [class*="product-tile"]');

      const parsePrice = el => {
        if (!el) return null;
        const text = (el.textContent || '').replace(/[^0-9.]/g, '');
        const n = parseFloat(text);
        return isNaN(n) ? null : n;
      };

      const seen = new Set();
      return [...cards].map(card => {
        const link = card.querySelector('a[href*="/pd/"]');
        const url = link?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);

        const nameEl = card.querySelector('.product-name, .pdp-name, [class*="ProductName"], h2, h3');
        const name = nameEl?.textContent?.trim() || '';

        const salePriceEl = card.querySelector('.sale-price, .price-sales, .current-price, [data-test="sale-price"], [class*="SalePrice"]');
        const origPriceEl = card.querySelector('.non-sale-price, .price-standard, .strike-through, [data-test="original-price"], s, del');

        const imgEl = card.querySelector('img.tile-image, .product-tile img, img[src]');
        const image = imgEl?.src || '';

        const price = parsePrice(salePriceEl);
        const originalPrice = parsePrice(origPriceEl);

        if (!name || !url || !price || !originalPrice || price >= originalPrice) return null;

        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) return null;

        return { store: storeName, storeKey, name, url, image, price, originalPrice, discount, currency: 'USD', tags: [] };
      }).filter(Boolean);
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    const tagged = deals.map(d => ({
      ...d,
      id: slugify(`newbalance-${d.name}`),
      priceCAD: Math.round(d.price * rate * 100) / 100,
      originalPriceCAD: Math.round(d.originalPrice * rate * 100) / 100,
      exchangeRate: rate,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));

    onProgress(`New Balance: found ${tagged.length} deals (DOM)`);
    return tagged;

  } finally {
    await context.close();
  }
}

function mapSFCCProduct(p, rate) {
  try {
    const name = p.product_name || p.name || '';
    if (!name) return null;

    const price = parseFloat(p.price || p.sale_price || 0);
    const originalPrice = parseFloat(p.list_price || p.standard_price || 0);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const id = p.product_id || p.id || p.masterId || slugify(name);
    const url = p.link || `https://www.newbalance.com/pd/${id}`;
    const image = p.image?.dis_base_link || p.image_groups?.[0]?.images?.[0]?.link || '';

    return {
      id: slugify(`newbalance-${name}-${id}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price,
      originalPrice,
      discount,
      currency: CURRENCY,
      priceCAD: Math.round(price * rate * 100) / 100,
      originalPriceCAD: Math.round(originalPrice * rate * 100) / 100,
      exchangeRate: rate,
      tags: tag({ name }),
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

async function scrollAndLoad(page, onProgress) {
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);

    // Try clicking "Load More" if it exists
    try {
      const loadMore = await page.$('button[class*="load-more"], button[class*="LoadMore"], [class*="show-more"]');
      if (loadMore) {
        const visible = await loadMore.isVisible();
        if (visible) {
          await loadMore.click();
          onProgress(`New Balance: loading more products (${i + 1})…`);
          await page.waitForTimeout(2000);
        }
      }
    } catch (_) {}
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
