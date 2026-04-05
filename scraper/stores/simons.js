'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Simons';
const STORE_KEY = 'simons';
const CURRENCY = 'CAD';

/**
 * Scrapes deals from Simons
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  const deals = [];

  try {
    onProgress('Simons: trying API endpoints…');

    // Strategy 1: Try direct API endpoints
    const apiDeals = await tryApiEndpoints(onProgress);
    if (apiDeals && apiDeals.length > 0) {
      deals.push(...apiDeals);
      onProgress(`Simons: found ${deals.length} deals via API`);
      return deals;
    }

    // Strategy 2: Browser XHR interception
    onProgress('Simons: trying XHR interception…');
    const xhrDeals = await tryXhrInterception(browser, onProgress);
    if (xhrDeals && xhrDeals.length > 0) {
      deals.push(...xhrDeals);
      onProgress(`Simons: found ${deals.length} deals via XHR`);
      return deals;
    }

    // Strategy 3: DOM scraping fallback
    onProgress('Simons: trying DOM scraping…');
    const domDeals = await tryDomScraping(browser, onProgress);
    if (domDeals && domDeals.length > 0) {
      deals.push(...domDeals);
      onProgress(`Simons: found ${deals.length} deals via DOM`);
      return deals;
    }

    onProgress('Simons: no deals found');
    return deals;

  } catch (error) {
    onProgress(`Simons: error — ${error.message}`);
    console.error(`[${STORE_NAME}] Scraping failed:`, error);
    return deals;
  }
}

/**
 * Strategy 1: Try various API endpoints
 */
async function tryApiEndpoints(onProgress) {
  const endpoints = [
    'https://www.simons.ca/api/products?onSale=true&limit=100',
    'https://api.simons.ca/api/products?onSale=true&limit=100',
    'https://www.simons.ca/api/v1/products/sale?limit=100',
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'en-CA,en;q=0.9',
        },
        timeout: 10000,
      });

      if (!response.ok) continue;

      const data = await response.json();
      const deals = parseApiResponse(data);

      if (deals && deals.length > 0) {
        onProgress(`Simons API: found ${deals.length} deals from ${endpoint}`);
        return deals;
      }
    } catch (error) {
      // Try next endpoint
      continue;
    }
  }

  return null;
}

/**
 * Parse API response into deal objects
 */
function parseApiResponse(data) {
  const deals = [];

  // Try different response structures
  const products = data.products || data.items || data.results || data.data || [];

  if (!Array.isArray(products) || products.length === 0) {
    return null;
  }

  for (const product of products) {
    try {
      // Skip if not on sale
      const salePrice = product.salePrice || product.promotionalPrice || product.price?.sale || product.price?.current;
      const regularPrice = product.regularPrice || product.originalPrice || product.price?.regular || product.price?.original;

      if (!salePrice || !regularPrice || salePrice >= regularPrice) {
        continue;
      }

      const discount = Math.round(((regularPrice - salePrice) / regularPrice) * 100);

      // Build URL
      let url = product.url || product.link || product.productUrl;
      if (url && !url.startsWith('http')) {
        url = `https://www.simons.ca${url}`;
      }

      // Build image URL
      let image = product.image || product.imageUrl || product.thumbnail || product.img;
      if (image && !image.startsWith('http')) {
        image = `https://www.simons.ca${image}`;
      }

      const name = product.name || product.title || product.productName;
      if (!name || !url) continue;

      const deal = {
        id: slugify(`simons-${name}`),
        store: STORE_NAME,
        storeKey: STORE_KEY,
        name: name.trim(),
        url,
        image: image || '',
        price: parseFloat(salePrice),
        originalPrice: parseFloat(regularPrice),
        discount,
        currency: CURRENCY,
        priceCAD: parseFloat(salePrice),
        originalPriceCAD: parseFloat(regularPrice),
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

        // Look for API calls
        if ((url.includes('/api/') || url.includes('.json') || url.includes('graphql')) &&
            url.includes('simons.ca')) {
          try {
            const data = await response.json();

            // Check for products in various structures
            if (data.products && Array.isArray(data.products)) {
              capturedData = data;
              onProgress(`Simons XHR: found ${data.products.length} products`);
            } else if (data.data && data.data.products) {
              capturedData = data.data;
              onProgress(`Simons XHR: found ${data.data.products.length} products`);
            }
          } catch (jsonError) {
            // Not JSON or already consumed
          }
        }
      } catch (error) {
        // Ignore failed response parsing
      }
    });

    // Navigate to sale pages
    const saleUrls = [
      'https://www.simons.ca/en/men/sale',
      'https://www.simons.ca/en/sale',
      'https://www.simons.ca/en/women/sale',
    ];

    for (const saleUrl of saleUrls) {
      try {
        await page.goto(saleUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        onProgress(`Simons XHR: navigated to ${saleUrl}`);

        await page.waitForTimeout(4000);

        // Scroll to trigger lazy loading
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(3000);

        // If we captured data, we can stop
        if (capturedData && capturedData.products) {
          break;
        }
      } catch (e) {
        onProgress(`Simons XHR: error on ${saleUrl} - ${e.message}`);
        continue;
      }
    }

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

    // Navigate to men's sale page
    await page.goto('https://www.simons.ca/en/men/sale', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    onProgress('Simons DOM: page loaded, waiting for content…');

    // Wait longer for SPA to render
    await page.waitForTimeout(6000);

    // Scroll to load more products
    let previousCount = 0;
    let stableCount = 0;
    const maxScrolls = 5;

    for (let i = 0; i < maxScrolls; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);

      // Try to click "Load More" if it exists
      try {
        const loadMoreButton = await page.$('button:has-text("Load More"), button:has-text("Show More"), [class*="load-more"]');
        if (loadMoreButton && await loadMoreButton.isVisible()) {
          await loadMoreButton.click();
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        // No load more button
      }

      const currentCount = await page.$$eval(
        '[class*="product"], [class*="Product"], [data-product]',
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

    onProgress(`Simons DOM: found ${previousCount} potential product elements`);

    // Extract product data
    const products = await page.evaluate(() => {
      const cardSelectors = [
        '[class*="ProductCard"]',
        '[class*="product-card"]',
        '[class*="product-tile"]',
        '[data-product]',
        'article',
        '.product',
      ];

      let cards = [];
      for (const selector of cardSelectors) {
        cards = Array.from(document.querySelectorAll(selector));
        if (cards.length > 10) break; // Found a good selector
      }

      return cards.map(card => {
        try {
          // Extract name
          const nameSelectors = ['[class*="product-name"]', '[class*="ProductName"]', '[class*="title"]', 'h3', 'h2', 'h4'];
          let name = '';
          for (const sel of nameSelectors) {
            const el = card.querySelector(sel);
            if (el && el.textContent.trim()) {
              name = el.textContent.trim();
              break;
            }
          }

          // Extract sale price
          const salePriceSelectors = [
            '[class*="sale-price"]',
            '[class*="SalePrice"]',
            '[class*="current-price"]',
            '[class*="promotional"]',
            '.price-now',
            '.price'
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

          // Extract regular price
          const regPriceSelectors = [
            '[class*="regular-price"]',
            '[class*="RegularPrice"]',
            '[class*="original-price"]',
            'del',
            's',
            '.price-was',
            '[class*="compare"]'
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

          // Extract image
          const imgEl = card.querySelector('img');
          const image = imgEl ? (imgEl.src || imgEl.dataset.src || '') : '';

          // Extract URL
          const linkEl = card.querySelector('a[href]');
          const url = linkEl ? linkEl.href : '';

          return { name, salePrice, regularPrice, image, url };
        } catch (error) {
          return null;
        }
      }).filter(p => p && p.name && p.salePrice && p.regularPrice && p.url && p.salePrice < p.regularPrice);
    });

    onProgress(`Simons DOM: extracted ${products.length} products with valid pricing`);

    // Process products into deals
    for (const product of products) {
      try {
        const discount = Math.round(((product.regularPrice - product.salePrice) / product.regularPrice) * 100);

        const deal = {
          id: slugify(`simons-${product.name}`),
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
