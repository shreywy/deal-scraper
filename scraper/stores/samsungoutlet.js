'use strict';

const STORE_NAME = 'Samsung Outlet';
const STORE_KEY = 'samsungoutlet';
const CURRENCY = 'CAD';

const { ncTag } = require('../tagger');

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

/**
 * Scrapes deals from Samsung Canada Certified Re-Newed
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  let context = null;
  let page = null;
  const deals = [];

  try {
    onProgress('Samsung Outlet: navigating to certified re-newed page…');

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-CA',
    });

    page = await context.newPage();

    await page.goto('https://www.samsung.com/ca/offer/certified-re-newed/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForTimeout(3000);

    // Scroll to load more products
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    onProgress('Samsung Outlet: extracting products…');

    // Extract products from DOM
    const products = await page.evaluate(() => {
      const selectors = [
        '.product-card',
        '[class*="product"]',
        '[data-product]',
        '.item',
        '[class*="ProductCard"]',
        '.pd-item',
      ];

      let cards = [];
      for (const selector of selectors) {
        cards = Array.from(document.querySelectorAll(selector)).slice(0, 300);
        if (cards.length > 0) break;
      }

      return cards.map(card => {
        try {
          // Find product name
          const nameSelectors = [
            '.product-name',
            '[class*="productName"]',
            '[class*="ProductName"]',
            'h3',
            'h4',
            'h2',
            '[class*="title"]',
            '[class*="model"]',
          ];
          let name = '';
          for (const sel of nameSelectors) {
            const el = card.querySelector(sel);
            if (el && el.textContent.trim()) {
              name = el.textContent.trim();
              break;
            }
          }

          // Find sale price
          const salePriceSelectors = [
            '[class*="salePrice"]',
            '[class*="sale-price"]',
            '[class*="currentPrice"]',
            '[class*="price-current"]',
            '[class*="special"]',
            '.price',
          ];
          let salePrice = null;
          for (const sel of salePriceSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              const text = el.textContent.trim().replace(/[^0-9.]/g, '');
              salePrice = parseFloat(text);
              if (salePrice) break;
            }
          }

          // Find regular price
          const regPriceSelectors = [
            '[class*="regularPrice"]',
            '[class*="regular-price"]',
            '[class*="wasPrice"]',
            '[class*="was-price"]',
            '[class*="price-original"]',
            'del',
            's',
            '[class*="old-price"]',
          ];
          let regularPrice = null;
          for (const sel of regPriceSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              const text = el.textContent.trim().replace(/[^0-9.]/g, '');
              regularPrice = parseFloat(text);
              if (regularPrice) break;
            }
          }

          // Find image
          const imgEl = card.querySelector('img');
          const image = imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.original || '';

          // Find URL
          const linkEl = card.querySelector('a[href*="/product/"], a[href*="/p/"], a[href*="/offer/"], a');
          const url = linkEl?.href || '';

          // Category
          const categoryEl = card.querySelector('[class*="category"], [class*="type"]');
          const category = categoryEl?.textContent?.trim() || '';

          return { name, salePrice, regularPrice, image, url, category };
        } catch (error) {
          return null;
        }
      }).filter(p => p && p.name && p.salePrice && p.regularPrice && p.url);
    });

    onProgress(`Samsung Outlet: found ${products.length} products with prices`);

    // Process products into deals
    for (const product of products) {
      try {
        if (product.salePrice >= product.regularPrice) continue;

        const discount = Math.round(((product.regularPrice - product.salePrice) / product.regularPrice) * 100);
        if (discount <= 0) continue;

        const deal = {
          id: slugify(`samsungoutlet-${product.name}`),
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name: product.name,
          url: product.url,
          image: product.image || '',
          price: parseFloat(product.salePrice.toFixed(2)),
          originalPrice: parseFloat(product.regularPrice.toFixed(2)),
          discount,
          currency: CURRENCY,
          priceCAD: parseFloat(product.salePrice.toFixed(2)),
          originalPriceCAD: parseFloat(product.regularPrice.toFixed(2)),
          tags: ['Non-Clothing', ncTag(product.name, product.category)],
          scrapedAt: new Date().toISOString(),
        };

        deals.push(deal);
      } catch (error) {
        continue;
      }
    }

    onProgress(`Samsung Outlet: found ${deals.length} deals`);
    return deals;

  } catch (error) {
    onProgress(`Samsung Outlet: error — ${error.message}`);
    console.error(`[${STORE_NAME}] Scraping failed:`, error);
    return [];
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

module.exports = { scrape, STORE_KEY };
