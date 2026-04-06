'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Jack & Jones';
const STORE_KEY = 'jackjones';
const CURRENCY = 'CAD';

/**
 * Jack & Jones Canada — Bestseller platform scraper
 * Uses browser automation to intercept API calls and scrape DOM
 *
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

  const rawProducts = [];
  const seenIds = new Set();

  // Intercept API responses
  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';

    // Look for JSON API responses
    if (!ct.includes('application/json')) return;
    if (!url.includes('jackjones.com')) return;

    try {
      const json = await response.json();

      // Check for product list data (various possible structures)
      const products = json?.products || json?.items || json?.results || json?.data?.products || [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.id || p.productId || p.code || p.sku;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          rawProducts.push(p);
        }
      }
    } catch (err) {
      // Ignore JSON parse errors
    }
  });

  const page = await context.newPage();
  const allDeals = [];
  const seen = new Set();

  try {
    onProgress('Jack & Jones: loading sale page...');

    // Try multiple sale URL patterns
    const saleUrls = [
      'https://www.jackjones.com/en-ca/jj/men/sale',
      'https://www.jackjones.com/en-ca/sale',
      'https://www.jackjones.com/jj/men/sale',
      'https://www.jackjones.com/sale',
    ];

    let loaded = false;
    for (const saleUrl of saleUrls) {
      try {
        await page.goto(saleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        onProgress(`Jack & Jones: loaded ${saleUrl}`);
        loaded = true;
        break;
      } catch (err) {
        onProgress(`Jack & Jones: ${saleUrl} failed (${err.message})`);
      }
    }

    if (!loaded) {
      onProgress('Jack & Jones: all sale URLs failed, returning 0 deals');
      return [];
    }

    // Accept cookies if present
    try {
      await page.click('button:has-text("Accept All"), button[id*="accept"]', { timeout: 3000 });
      await page.waitForTimeout(1000);
    } catch (_) {}

    // Wait for content to load
    await page.waitForTimeout(3000);

    // Scroll to load lazy content
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    onProgress(`Jack & Jones: intercepted ${rawProducts.length} products from API`);

    // Process intercepted products
    for (const p of rawProducts) {
      const deal = mapProduct(p, seen);
      if (deal) allDeals.push(deal);
    }

    // Also try DOM scraping as fallback
    const domDeals = await page.evaluate(({ storeName, storeKey }) => {
      const parsePrice = str => {
        if (!str) return null;
        const match = String(str).match(/[\d,.]+/);
        return match ? parseFloat(match[0].replace(/,/g, '')) : null;
      };

      const deals = [];

      // Try common product card selectors
      const selectors = [
        '[data-testid*="product-card"]',
        '[class*="ProductCard"]',
        '[class*="product-card"]',
        '.product-tile',
        '[class*="product-item"]',
        'article[class*="product"]',
      ];

      for (const selector of selectors) {
        const cards = document.querySelectorAll(selector);
        if (cards.length === 0) continue;

        for (const card of cards) {
          try {
            // Find product link
            const link = card.querySelector('a[href*="/product/"], a[href*="/p/"]') || card.querySelector('a');
            if (!link) continue;

            const url = link.href;
            if (!url || url === window.location.href) continue;

            // Find product name
            const nameEl = card.querySelector('[class*="name"], [class*="title"], h2, h3, h4');
            const name = nameEl?.textContent?.trim();
            if (!name || name.length < 3) continue;

            // Find prices - look for sale and original
            const priceEls = Array.from(card.querySelectorAll('[class*="price"], [class*="Price"]'));
            let price = null;
            let originalPrice = null;

            for (const el of priceEls) {
              const text = el.textContent;
              const val = parsePrice(text);
              if (!val) continue;

              const classList = el.className.toLowerCase();
              if (classList.includes('sale') || classList.includes('discount') || classList.includes('current') || classList.includes('offer')) {
                price = val;
              } else if (classList.includes('original') || classList.includes('regular') || classList.includes('compare') || classList.includes('was')) {
                originalPrice = val;
              } else if (!price) {
                // First price found, assume it's the current price
                price = val;
              } else if (!originalPrice && val > price) {
                // Second price higher than first, it's the original
                originalPrice = val;
              }
            }

            // If we don't have both prices, skip
            if (!price || !originalPrice || price >= originalPrice) continue;

            const discount = Math.round((1 - price / originalPrice) * 100);
            if (discount <= 0) continue;

            // Find image
            const img = card.querySelector('img');
            const image = img?.src || img?.getAttribute('data-src') || img?.getAttribute('srcset')?.split(' ')[0] || '';

            deals.push({
              store: storeName,
              storeKey,
              name,
              url,
              image,
              price,
              originalPrice,
              discount,
              tags: [],
            });
          } catch (_) {
            // Skip invalid cards
          }
        }

        if (deals.length > 0) break; // Found products with this selector
      }

      return deals;
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    onProgress(`Jack & Jones: found ${domDeals.length} products from DOM`);

    for (const d of domDeals) {
      if (!seen.has(d.url)) {
        seen.add(d.url);
        allDeals.push({
          ...d,
          id: slugify(`${STORE_KEY}-${d.name}`),
          currency: CURRENCY,
          priceCAD: d.price,
          originalPriceCAD: d.originalPrice,
          tags: tag({ name: d.name }),
          scrapedAt: new Date().toISOString(),
        });
      }
    }

  } catch (err) {
    onProgress(`Jack & Jones: error — ${err.message}`);
  } finally {
    await page.close();
    await context.close();
  }

  onProgress(`Jack & Jones: found ${allDeals.length} deals total`);
  return allDeals;
}

function mapProduct(p, seen) {
  try {
    // Extract product details from API response
    const name = p.name || p.title || p.displayName || p.productName || '';
    if (!name || name.length < 3) return null;

    // Extract prices
    let price = null;
    let originalPrice = null;

    // Try different price field patterns
    if (p.price) {
      if (typeof p.price === 'object') {
        price = parseFloat(p.price.current || p.price.sale || p.price.discount || p.price.offer || 0);
        originalPrice = parseFloat(p.price.original || p.price.regular || p.price.list || p.price.was || 0);
      } else {
        price = parseFloat(p.price);
      }
    }

    if (p.salePrice || p.offerPrice) price = parseFloat(p.salePrice || p.offerPrice);
    if (p.regularPrice || p.originalPrice || p.listPrice) {
      originalPrice = parseFloat(p.regularPrice || p.originalPrice || p.listPrice);
    }
    if (p.compareAtPrice) originalPrice = parseFloat(p.compareAtPrice);

    // Skip if no valid discount
    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    // Build product URL
    const productId = p.id || p.productId || p.code || p.sku || '';
    const slug = p.slug || p.url || p.path || p.handle || '';
    const url = slug.startsWith('http')
      ? slug
      : slug.startsWith('/')
      ? `https://www.jackjones.com${slug}`
      : `https://www.jackjones.com/product/${productId}`;

    if (seen.has(url)) return null;
    seen.add(url);

    // Extract image
    const image = p.image || p.imageUrl || p.thumbnail ||
      (Array.isArray(p.images) && p.images[0]?.url) ||
      (Array.isArray(p.images) && p.images[0]) ||
      (p.media && Array.isArray(p.media) && p.media[0]?.url) || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${productId}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
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
  } catch (_) {
    return null;
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
