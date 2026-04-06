'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Canadian Tire';
const STORE_KEY = 'canadiantire';
const CURRENCY = 'CAD';

/**
 * Scrapes deals from Canadian Tire
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  const deals = [];

  try {
    onProgress('Canadian Tire: trying API endpoints…');

    // Strategy 1: Try direct API endpoints (FGL platform like Mark's and Sport Chek)
    const apiDeals = await tryApiEndpoints(onProgress);
    if (apiDeals && apiDeals.length > 0) {
      deals.push(...apiDeals);
      onProgress(`Canadian Tire: found ${deals.length} deals via API`);
      return deals;
    }

    // Strategy 2: Browser XHR interception
    onProgress('Canadian Tire: trying XHR interception…');
    const xhrDeals = await tryXhrInterception(browser, onProgress);
    if (xhrDeals && xhrDeals.length > 0) {
      deals.push(...xhrDeals);
      onProgress(`Canadian Tire: found ${deals.length} deals via XHR`);
      return deals;
    }

    // Strategy 3: DOM scraping fallback
    onProgress('Canadian Tire: trying DOM scraping…');
    const domDeals = await tryDomScraping(browser, onProgress);
    if (domDeals && domDeals.length > 0) {
      deals.push(...domDeals);
      onProgress(`Canadian Tire: found ${deals.length} deals via DOM`);
      return deals;
    }

    onProgress('Canadian Tire: no deals found (site may be blocking scrapers)');
    return deals;

  } catch (error) {
    onProgress(`Canadian Tire: error — ${error.message}`);
    console.error(`[${STORE_NAME}] Scraping failed:`, error);
    return deals;
  }
}

/**
 * Strategy 1: Try various API endpoints (FGL platform)
 */
async function tryApiEndpoints(onProgress) {
  // Canadian Tire uses the FGL platform API (same as Mark's and Sport Chek)
  // API requires ocp-apim-subscription-key header
  const apiUrl = 'https://www.canadiantire.ca/api/v1/search/v2/search';
  const subscriptionKey = 'c01ef3612328420c9f5cd9277e815a0e';

  try {
    // Try with on sale query
    const response = await fetch(`${apiUrl}?lang=en_CA&count=96&start=0&q=on+sale`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-CA,en;q=0.9',
        'ocp-apim-subscription-key': subscriptionKey,
        'service-client': 'ctr/web',
        'basesiteid': 'CTR',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      onProgress(`Canadian Tire API: received status ${response.status}`);
      return null;
    }

    const data = await response.json();
    const deals = parseApiResponse(data);

    if (deals && deals.length > 0) {
      onProgress(`Canadian Tire API: found ${deals.length} deals (total available: ${data.resultCount || 'unknown'})`);
      return deals;
    }
  } catch (error) {
    onProgress(`Canadian Tire API: ${error.message}`);
  }

  return null;
}

/**
 * Parse API response into deal objects
 */
function parseApiResponse(data) {
  const deals = [];

  // Canadian Tire API returns products array
  const products = data.products || [];

  if (!Array.isArray(products) || products.length === 0) {
    return null;
  }

  for (const product of products) {
    try {
      // Canadian Tire API structure: currentPrice and originalPrice are at product level
      const currentPrice = product.currentPrice?.value;
      const originalPrice = product.originalPrice?.value;

      // Skip if no valid pricing or not on sale
      if (!currentPrice || !originalPrice || currentPrice >= originalPrice) {
        continue;
      }

      const discount = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);

      // Build URL
      let url = product.url || '';
      if (url && !url.startsWith('http')) {
        url = `https://www.canadiantire.ca${url}`;
      }

      // Build image URL
      let image = '';
      if (product.images && product.images.length > 0 && product.images[0].url) {
        image = product.images[0].url;
      }

      const name = product.title || product.name || '';
      if (!name || !url) continue;

      const deal = {
        id: slugify(`canadiantire-${name}-${product.code || ''}`),
        store: STORE_NAME,
        storeKey: STORE_KEY,
        name: name.trim(),
        url,
        image: image || '',
        price: parseFloat(currentPrice.toFixed(2)),
        originalPrice: parseFloat(originalPrice.toFixed(2)),
        discount,
        currency: CURRENCY,
        priceCAD: parseFloat(currentPrice.toFixed(2)),
        originalPriceCAD: parseFloat(originalPrice.toFixed(2)),
        tags: tag({ name }),
        scrapedAt: new Date().toISOString(),
      };

      deals.push(deal);
    } catch (error) {
      // Skip malformed products
      continue;
    }
  }

  return deals.length > 0 ? deals : null;
}

/**
 * Strategy 2: Browser XHR interception
 */
async function tryXhrInterception(browser, onProgress) {
  let context = null;
  let page = null;
  const deals = [];
  let capturedData = null;

  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });

    page = await context.newPage();

    // Intercept network responses
    context.on('response', async (response) => {
      try {
        const url = response.url();

        // Look for search/product APIs
        if (url.includes('/api/') && (url.includes('search') || url.includes('product'))) {
          try {
            const data = await response.json();
            if (data && data.products && Array.isArray(data.products)) {
              capturedData = data;
              onProgress(`Canadian Tire XHR: found ${data.products.length} products`);
            }
          } catch (jsonError) {
            // Not JSON or already consumed
          }
        }
      } catch (error) {
        // Ignore failed response parsing
      }
    });

    // Navigate to weekly flyer/sale page
    const saleUrl = 'https://www.canadiantire.ca/en/promotions/weekly-flyer-deals.html';

    await page.goto(saleUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    await page.waitForTimeout(3000);

    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(3000);

    // Parse captured data
    if (capturedData && capturedData.products) {
      const parsedDeals = parseApiResponse(capturedData);
      if (parsedDeals && parsedDeals.length > 0) {
        deals.push(...parsedDeals);
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
 * Strategy 3: DOM scraping
 */
async function tryDomScraping(browser, onProgress) {
  let context = null;
  let page = null;
  const deals = [];

  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });

    page = await context.newPage();

    // Navigate to weekly flyer/sale page
    const saleUrl = 'https://www.canadiantire.ca/en/promotions/weekly-flyer-deals.html';

    await page.goto(saleUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    onProgress(`Canadian Tire DOM: loaded ${saleUrl}`);

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
      const cardSelectors = [
        '[class*="product-card"]',
        '[class*="product-tile"]',
        '[data-product]',
        '.product',
      ];

      let cards = [];
      for (const selector of cardSelectors) {
        cards = Array.from(document.querySelectorAll(selector));
        if (cards.length > 0) break;
      }

      return cards.map(card => {
        try {
          const nameEl = card.querySelector('[class*="product-name"], [class*="title"], h3, h2');
          const name = nameEl ? nameEl.textContent.trim() : '';

          const salePriceEl = card.querySelector('[class*="sale"], [class*="current"], .price');
          const salePrice = salePriceEl ? parseFloat(salePriceEl.textContent.replace(/[^0-9.]/g, '')) : null;

          const regPriceEl = card.querySelector('del, s, [class*="original"], [class*="regular"]');
          const regularPrice = regPriceEl ? parseFloat(regPriceEl.textContent.replace(/[^0-9.]/g, '')) : null;

          const imgEl = card.querySelector('img');
          const image = imgEl ? imgEl.src : '';

          const linkEl = card.querySelector('a[href]');
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
          id: slugify(`canadiantire-${product.name}`),
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
