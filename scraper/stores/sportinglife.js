'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Sporting Life';
const STORE_KEY = 'sportinglife';
const CURRENCY = 'CAD';

/**
 * Scrapes deals from Sporting Life
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  const deals = [];

  try {
    onProgress('Sporting Life: trying API endpoints…');

    // Strategy 1: Try Shopify products.json API
    const apiDeals = await tryShopifyApi(onProgress);
    if (apiDeals && apiDeals.length > 0) {
      deals.push(...apiDeals);
      onProgress(`Sporting Life: found ${deals.length} deals via Shopify API`);
      return deals;
    }

    // Strategy 2: Browser scraping
    onProgress('Sporting Life: trying browser scraping…');
    const browserDeals = await tryBrowserScraping(browser, onProgress);
    if (browserDeals && browserDeals.length > 0) {
      deals.push(...browserDeals);
      onProgress(`Sporting Life: found ${deals.length} deals via browser`);
      return deals;
    }

    onProgress('Sporting Life: no deals found (site may be blocking scrapers)');
    return deals;

  } catch (error) {
    onProgress(`Sporting Life: error — ${error.message}`);
    console.error(`[${STORE_NAME}] Scraping failed:`, error);
    return deals;
  }
}

/**
 * Strategy 1: Try SFCC Search API (Sporting Life uses Salesforce Commerce Cloud)
 */
async function tryShopifyApi(onProgress) {
  // Sporting Life uses SFCC (not Shopify), no direct API available
  // Skip to browser scraping
  return null;
}

/**
 * Strategy 2: Browser scraping
 */
async function tryBrowserScraping(browser, onProgress) {
  let context = null;
  let page = null;
  const deals = [];

  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });

    page = await context.newPage();

    // Navigate to sale page
    const saleUrl = 'https://www.sportinglife.ca/en-CA/sale/';

    await page.goto(saleUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    onProgress(`Sporting Life: loaded ${saleUrl}`);

    await page.waitForTimeout(5000);

    // Scroll and load more products
    let previousCount = 0;
    let stableCount = 0;
    const maxScrolls = 5;

    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);

      const currentCount = await page.$$eval(
        '[class*="product"], [data-product]',
        els => els.length
      );

      if (currentCount === previousCount) {
        stableCount++;
        if (stableCount >= 2) break;
      } else {
        stableCount = 0;
      }

      previousCount = currentCount;
    }

    // Extract product data
    const products = await page.evaluate(() => {
      const tiles = document.querySelectorAll('.product-tile');

      return Array.from(tiles).map(tile => {
        try {
          // Name
          const nameEl = tile.querySelector('.product-name');
          const name = nameEl ? nameEl.textContent.trim() : '';

          // Prices (SFCC structure)
          const salePriceEl = tile.querySelector('.price-sales');
          const salePrice = salePriceEl ? parseFloat(salePriceEl.textContent.replace(/[^0-9.]/g, '')) : null;

          const regPriceEl = tile.querySelector('.price-standard');
          const regularPrice = regPriceEl ? parseFloat(regPriceEl.textContent.replace(/[^0-9.]/g, '')) : null;

          // Image
          const imgEl = tile.querySelector('img');
          const image = imgEl ? imgEl.src : '';

          // Link
          const linkEl = tile.querySelector('a.thumb-link');
          const url = linkEl ? linkEl.href : '';

          return { name, salePrice, regularPrice, image, url };
        } catch (error) {
          return null;
        }
      }).filter(p => p && p.name && p.salePrice && p.regularPrice && p.url && p.salePrice < p.regularPrice);
    });

    // Process products into deals
    for (const product of products) {
      try {
        const discount = Math.round(((product.regularPrice - product.salePrice) / product.regularPrice) * 100);

        const deal = {
          id: slugify(`sportinglife-${product.name}`),
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name: product.name,
          url: product.url,
          image: product.image || '',
          price: product.salePrice,
          originalPrice: product.regularPrice,
          discount,
          currency: CURRENCY,
          priceCAD: product.salePrice,
          originalPriceCAD: product.regularPrice,
          tags: tag({ name: product.name }),
          scrapedAt: new Date().toISOString(),
        };

        deals.push(deal);
      } catch (error) {
        continue;
      }
    }

    await page.close();
    await context.close();
    return deals.length > 0 ? deals : null;

  } catch (error) {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    return null;
  }
}

/**
 * Create a URL-safe slug from a string
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

module.exports = { scrape, STORE_KEY };
