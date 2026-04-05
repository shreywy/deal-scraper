'use strict';

const fetch = require('node-fetch');
const { tag } = require('../tagger');

const STORE_NAME = 'Sport Chek';
const STORE_KEY = 'sportchek';
const CURRENCY = 'CAD';

/**
 * Scrapes deals from Sport Chek
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  const deals = [];
  let method = 'unknown';

  try {
    onProgress('Sport Chek: trying API endpoints…');

    // Strategy 1: Try direct API endpoints
    const apiDeals = await tryApiEndpoints(onProgress);
    if (apiDeals && apiDeals.length > 0) {
      deals.push(...apiDeals);
      onProgress(`Sport Chek: found ${deals.length} deals via API`);
      return deals;
    }

    // Strategy 2: Browser XHR interception
    onProgress('Sport Chek: trying XHR interception…');
    const xhrDeals = await tryXhrInterception(browser, onProgress);
    if (xhrDeals && xhrDeals.length > 0) {
      deals.push(...xhrDeals);
      onProgress(`Sport Chek: found ${deals.length} deals via XHR`);
      return deals;
    }

    // Strategy 3: DOM scraping fallback
    onProgress('Sport Chek: trying DOM scraping…');
    const domDeals = await tryDomScraping(browser, onProgress);
    if (domDeals && domDeals.length > 0) {
      deals.push(...domDeals);
      onProgress(`Sport Chek: found ${deals.length} deals via DOM`);
      return deals;
    }

    onProgress('Sport Chek: no deals found');
    return deals;

  } catch (error) {
    onProgress(`Sport Chek: error — ${error.message}`);
    console.error(`[${STORE_NAME}] Scraping failed:`, error);
    return deals;
  }
}

/**
 * Strategy 1: Try various API endpoints
 */
async function tryApiEndpoints(onProgress) {
  const endpoints = [
    'https://api.sportchek.ca/api/v3/products?search=sale&category=clothing&sort=sale&inSale=true&lang=en&limit=100&offset=0',
    'https://www.sportchek.ca/api/products?onSale=true&category=clothing&limit=96',
    'https://api.sportchek.ca/api/v2/products?onSale=true&limit=100',
    'https://www.sportchek.ca/api/search?q=sale&limit=100',
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
      if (!product.onSale && !product.inSale && !product.salePrice && !product.promotionalPrice) {
        continue;
      }

      const salePrice = product.salePrice || product.promotionalPrice || product.price?.sale || product.price?.current;
      const regularPrice = product.regularPrice || product.originalPrice || product.price?.regular || product.price?.original;

      if (!salePrice || !regularPrice || salePrice >= regularPrice) {
        continue;
      }

      const discount = Math.round(((regularPrice - salePrice) / regularPrice) * 100);

      // Build URL
      let url = product.url || product.link || product.productUrl;
      if (url && !url.startsWith('http')) {
        url = `https://www.sportchek.ca${url}`;
      }

      // Build image URL
      let image = product.image || product.imageUrl || product.thumbnail || product.img;
      if (image && !image.startsWith('http')) {
        image = `https://www.sportchek.ca${image}`;
      }

      const name = product.name || product.title || product.productName;
      if (!name || !url) continue;

      const deal = {
        id: slugify(name),
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
  const page = await browser.newPage();
  const deals = [];
  let capturedData = null;

  try {
    // Intercept network responses
    page.on('response', async (response) => {
      try {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';

        // Look for JSON API responses
        if (contentType.includes('application/json') &&
            (url.includes('/api/') || url.includes('/search') || url.includes('/products'))) {

          const data = await response.json();

          // Check if response contains products
          if (data.products || data.items || data.results || data.data) {
            capturedData = data;
          }
        }
      } catch (error) {
        // Ignore failed response parsing
      }
    });

    // Navigate to sale page
    await page.goto('https://www.sportchek.ca/en/sale.html', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Wait a bit for XHR to complete
    await page.waitForTimeout(3000);

    // Parse captured data
    if (capturedData) {
      const parsedDeals = parseApiResponse(capturedData);
      if (parsedDeals && parsedDeals.length > 0) {
        deals.push(...parsedDeals);
      }
    }

    await page.close();
    return deals.length > 0 ? deals : null;

  } catch (error) {
    await page.close().catch(() => {});
    return null;
  }
}

/**
 * Strategy 3: DOM scraping with scroll and load more
 */
async function tryDomScraping(browser, onProgress) {
  const page = await browser.newPage();
  const deals = [];

  try {
    await page.goto('https://www.sportchek.ca/en/sale.html', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Wait for products to load
    await page.waitForTimeout(2000);

    // Scroll and load more products
    let previousCount = 0;
    let stableCount = 0;
    const maxScrolls = 5;

    for (let i = 0; i < maxScrolls; i++) {
      // Scroll to bottom
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      // Wait for new content
      await page.waitForTimeout(2000);

      // Try to click "Load More" button if it exists
      try {
        const loadMoreSelectors = [
          'button:has-text("Load More")',
          'button:has-text("Show More")',
          '[class*="load-more"]',
          '[class*="show-more"]',
        ];

        for (const selector of loadMoreSelectors) {
          const button = await page.$(selector);
          if (button && await button.isVisible()) {
            await button.click();
            await page.waitForTimeout(2000);
            break;
          }
        }
      } catch (error) {
        // No load more button
      }

      // Check product count
      const currentCount = await page.$$eval(
        '[class*="product-card"], [class*="product-tile"], .prod-list li',
        els => els.length
      );

      if (currentCount === previousCount) {
        stableCount++;
        if (stableCount >= 2) break; // Stop if count stable for 2 iterations
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
        '.prod-list li',
        '[data-product]',
      ];

      let cards = [];
      for (const selector of cardSelectors) {
        cards = Array.from(document.querySelectorAll(selector));
        if (cards.length > 0) break;
      }

      return cards.map(card => {
        try {
          // Extract name
          const nameSelectors = ['[class*="product-name"]', 'h3', 'h2', '.name', '[class*="title"]'];
          let name = '';
          for (const sel of nameSelectors) {
            const el = card.querySelector(sel);
            if (el && el.textContent.trim()) {
              name = el.textContent.trim();
              break;
            }
          }

          // Extract sale price
          const salePriceSelectors = ['[class*="sale-price"]', '.price-sale', '[class*="promo"]', '.price-now', '.current-price'];
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
          const regPriceSelectors = ['[class*="regular-price"]', '.price-reg', 'del', 's', '.price-was', '.original-price'];
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
          const imgSelectors = ['img.product-image', 'img[class*="product"]', 'img'];
          let image = '';
          for (const sel of imgSelectors) {
            const el = card.querySelector(sel);
            if (el && el.src) {
              image = el.src;
              break;
            }
          }

          // Extract URL
          const linkSelectors = ['a[class*="product-link"]', 'a[href*="/product"]', 'a'];
          let url = '';
          for (const sel of linkSelectors) {
            const el = card.querySelector(sel);
            if (el && el.href) {
              url = el.href;
              break;
            }
          }

          return { name, salePrice, regularPrice, image, url };
        } catch (error) {
          return null;
        }
      }).filter(p => p && p.name && p.salePrice && p.regularPrice && p.url);
    });

    // Process products into deals
    for (const product of products) {
      try {
        if (product.salePrice >= product.regularPrice) continue;

        const discount = Math.round(((product.regularPrice - product.salePrice) / product.regularPrice) * 100);

        const deal = {
          id: slugify(product.name),
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
    return deals.length > 0 ? deals : null;

  } catch (error) {
    await page.close().catch(() => {});
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
