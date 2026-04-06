'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'Rhone';
const STORE_KEY = 'rhone';
const CURRENCY = 'USD';
const SALE_URL = 'https://www.rhone.com/collections/sale';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Rhone: fetching USD→CAD rate…');
  const rate = await getUSDtoCAD();
  onProgress(`Rhone: 1 USD = ${rate.toFixed(4)} CAD`);

  const page = await browser.newPage();
  const allDeals = [];
  const seen = new Set();

  try {
    onProgress('Rhone: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });

    // Wait for products to load
    await page.waitForSelector('.product-item, .grid-product, [data-product], .product', { timeout: 10000 }).catch(() => null);

    // Scroll to lazy-load more products
    onProgress('Rhone: scrolling to load all products…');
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1000);
    }

    onProgress('Rhone: extracting product data from DOM…');

    const products = await page.evaluate(() => {
      const items = [];

      // Try multiple selector patterns for product cards
      const selectors = [
        '.product-item',
        '.grid-product',
        '[data-product]',
        '.product-card',
        '.product'
      ];

      let productElements = [];
      for (const selector of selectors) {
        productElements = Array.from(document.querySelectorAll(selector));
        if (productElements.length > 0) break;
      }

      for (const el of productElements) {
        try {
          // Get product name
          const nameEl = el.querySelector('.product-title, .product-name, .product__title, h3, h2, [class*="title"]');
          const name = nameEl?.textContent?.trim();
          if (!name) continue;

          // Get URL
          const linkEl = el.querySelector('a[href*="/products/"], a');
          const href = linkEl?.getAttribute('href');
          if (!href) continue;
          const url = href.startsWith('http') ? href : `https://www.rhone.com${href}`;

          // Get image
          const imgEl = el.querySelector('img');
          const image = imgEl?.src || imgEl?.getAttribute('data-src') || '';

          // Get prices - try multiple patterns
          const priceSelectors = [
            '.price, .product-price, .product__price',
            '[class*="price"]',
            '[data-price]'
          ];

          let priceText = '';
          let originalPriceText = '';

          for (const pSelector of priceSelectors) {
            const priceEls = Array.from(el.querySelectorAll(pSelector));
            if (priceEls.length === 0) continue;

            // Look for sale/compare price patterns
            const saleEl = priceEls.find(p =>
              p.classList.contains('sale') ||
              p.classList.contains('price--sale') ||
              p.classList.contains('product-price--sale') ||
              p.textContent.includes('Sale')
            );

            const compareEl = priceEls.find(p =>
              p.classList.contains('compare-at-price') ||
              p.classList.contains('price--compare') ||
              p.textContent.includes('Was') ||
              p.querySelector('s, del, strike')
            );

            if (saleEl) priceText = saleEl.textContent;
            if (compareEl) originalPriceText = compareEl.textContent;

            if (priceText && originalPriceText) break;

            // If no clear sale/compare, try getting strikethrough vs non-strikethrough
            if (!priceText || !originalPriceText) {
              const strikeEl = el.querySelector('s, del, strike, .line-through, [style*="line-through"]');
              const regularEl = priceEls.find(p => !p.querySelector('s, del, strike'));

              if (strikeEl) originalPriceText = strikeEl.textContent;
              if (regularEl && !regularEl.contains(strikeEl)) priceText = regularEl.textContent;
            }

            if (priceText && originalPriceText) break;
          }

          items.push({
            name,
            url,
            image,
            priceText: priceText || '',
            originalPriceText: originalPriceText || ''
          });
        } catch (_) {}
      }

      return items;
    });

    onProgress(`Rhone: found ${products.length} products, filtering for deals…`);

    for (const p of products) {
      try {
        // Parse prices
        const price = parsePrice(p.priceText);
        const originalPrice = parsePrice(p.originalPriceText);

        // Must have both prices and be on sale
        if (!price || !originalPrice || price >= originalPrice) continue;

        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) continue;

        const url = p.url;
        if (seen.has(url)) continue;
        seen.add(url);

        const deal = {
          id: slugify(`rhone-${p.name}`),
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name: p.name,
          url,
          image: p.image,
          price,
          originalPrice,
          discount,
          currency: CURRENCY,
          priceCAD: Math.round(price * rate * 100) / 100,
          originalPriceCAD: Math.round(originalPrice * rate * 100) / 100,
          exchangeRate: rate,
          gender: 'Men', // Rhone is primarily men's activewear
          tags: tag({ name: p.name, gender: 'Men' }),
          scrapedAt: new Date().toISOString(),
        };

        allDeals.push(deal);
      } catch (_) {}
    }

    onProgress(`Rhone: total ${allDeals.length} deals found`);
  } catch (err) {
    onProgress(`Rhone: Error - ${err.message}`);
  } finally {
    await page.close().catch(() => {});
  }

  return allDeals;
}

function parsePrice(str) {
  if (!str) return null;
  const match = str.match(/[\d,]+\.?\d*/);
  if (!match) return null;
  const num = parseFloat(match[0].replace(/,/g, ''));
  return num > 0 ? num : null;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
