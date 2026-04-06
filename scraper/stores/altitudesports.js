'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'Altitude Sports';
const STORE_KEY = 'altitudesports';
const CURRENCY = 'CAD';

// Altitude Sports - Canadian outdoor/activewear retailer
const SALE_URL = 'https://www.altitude-sports.com/collections/sale';

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

  // Intercept API responses that might contain product data
  page.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;

    try {
      const json = await response.json();
      extractAltitudeProducts(json, interceptedProducts, seenIds);
    } catch (_) {}
  });

  try {
    onProgress('Altitude Sports: navigating to sale page…');
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Accept cookies if present
    try {
      await page.click('button[id*="accept"], button[class*="accept"]', { timeout: 3000 });
    } catch (_) {}

    await page.waitForTimeout(3000);

    // Scroll to load more products
    await loadAllProductsScroll(page, interceptedProducts, onProgress);

    if (interceptedProducts.length > 0) {
      const deals = interceptedProducts.map(p => mapAltitudeProduct(p)).filter(Boolean);
      onProgress(`Altitude Sports: found ${deals.length} deals (API)`);
      return deals;
    }

    // DOM fallback
    onProgress('Altitude Sports: trying DOM scrape…');
    const rawDeals = await page.evaluate(({ storeName, storeKey }) => {
      // Altitude Sports uses Chakra UI with data-testid="plp-product-card"
      const cards = document.querySelectorAll('article[data-testid="plp-product-card"], article.css-nvlzz, article');

      const parsePrice = text => {
        if (!text) return null;
        const n = parseFloat(text.replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : n;
      };

      const seen = new Set();
      return [...cards].map(card => {
        // Find link
        const link = card.querySelector('a[href*="/p/"]');
        const url = link?.href || '';
        if (!url || seen.has(url)) return null;
        seen.add(url);

        // Get all text content - it contains brand, name, and prices
        const fullText = card.textContent || '';

        // Find image
        const imgEl = card.querySelector('img[data-testid="product-card-main-image"], img');
        const image = imgEl?.src || imgEl?.srcset?.split(' ')[0] || '';
        const imgAlt = imgEl?.alt || '';

        // Extract product name from alt text or structure
        // Alt format: "Product image for [Name] - [Gender]'s"
        let name = '';
        if (imgAlt.includes('Product image for ')) {
          name = imgAlt.replace('Product image for ', '').trim();
        } else {
          // Fallback: use the text content (brand + product name)
          const textParts = fullText.split('C$');
          if (textParts.length > 0) {
            name = textParts[0].replace(/^-?\d+%/, '').trim();
          }
        }

        if (!name) return null;

        // Extract prices from text
        // Format: "...C$ 127.99C$ 159.99..." (sale price, then original)
        const priceMatches = fullText.match(/C\$\s*([\d,.]+)/g);
        if (!priceMatches || priceMatches.length < 2) return null;

        const prices = priceMatches.map(p => parsePrice(p));
        const price = prices[0]; // First price is sale
        const originalPrice = prices[1]; // Second price is original

        if (!price || !originalPrice || price >= originalPrice) return null;

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
      id: slugify(`altitudesports-${d.name}`),
      priceCAD: d.price,
      originalPriceCAD: d.originalPrice,
      tags: tag({ name: d.name }),
      scrapedAt: new Date().toISOString(),
    }));
    onProgress(`Altitude Sports: found ${tagged.length} deals (DOM)`);
    return tagged;

  } catch (error) {
    onProgress(`Altitude Sports: error - ${error.message}`);
    return [];
  } finally {
    await context.close();
  }
}

function extractAltitudeProducts(json, out, seenIds) {
  // Try common product data structures
  const products = json?.products || json?.items || json?.data?.products || json?.data?.items ||
                  json?.results || json?.hits || [];

  const arr = Array.isArray(products) ? products : Object.values(products);
  for (const p of arr) {
    const id = p?.id || p?.productId || p?.sku || p?.handle || p?.objectID;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    out.push(p);
  }
}

function mapAltitudeProduct(p) {
  try {
    const name = p.name || p.title || p.productName || p.display_name || '';
    if (!name) return null;

    // Try various price field structures
    const price = parseFloat(
      p.price?.current || p.price?.sale || p.salePrice || p.currentPrice ||
      p.price || p.prices?.sale || p.special_price || p.final_price || 0
    );
    const originalPrice = parseFloat(
      p.price?.original || p.price?.list || p.comparePrice || p.originalPrice ||
      p.compareAtPrice || p.prices?.list || p.regular_price || p.list_price || 0
    );

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const handle = p.handle || p.slug || p.url_key || slugify(name);
    const url = p.url || (handle ? `https://www.altitude-sports.com/products/${handle}` : SALE_URL);
    const image = p.image?.url || p.imageUrl || p.images?.[0]?.url || p.image_url ||
                 p.featuredImage?.url || p.thumbnail || '';

    return {
      id: slugify(`altitudesports-${name}-${p.id || ''}`),
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
        onProgress(`Altitude Sports: loading… (${interceptedProducts.length} products)`);
      }
    }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
