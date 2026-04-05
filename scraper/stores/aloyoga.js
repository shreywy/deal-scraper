'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = 'Alo Yoga';
const STORE_KEY = 'aloyoga';
const CURRENCY = 'CAD';

// Alo Yoga main sale collection URL
const SALE_URL = 'https://www.aloyoga.com/collections/sale';

/**
 * Alo Yoga — shows CAD prices for Canadian visitors.
 * Uses Playwright browser to scrape Builder.io product cards.
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const rate = 1; // Site already shows CAD prices

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  const rawProducts = [];
  const seenIds = new Set();

  // Intercept XHR/API responses for product data
  context.on('response', async response => {
    const url = response.url();
    const ct = response.headers()['content-type'] || '';
    if (!ct.includes('application/json')) return;
    if (!url.includes('aloyoga.com')) return;
    try {
      const json = await response.json();
      // Shopify Storefront API or custom API response formats
      const products =
        json?.collection?.products?.edges?.map(e => e.node) ||
        json?.products?.edges?.map(e => e.node) ||
        json?.products ||
        json?.data?.products ||
        [];
      for (const p of (Array.isArray(products) ? products : [])) {
        const id = p.id || p.handle;
        if (id && !seenIds.has(id)) { seenIds.add(id); rawProducts.push(p); }
      }
    } catch (_) {}
  });

  const allDeals = [];
  const seenUrls = new Set();

  onProgress(`Alo Yoga: loading sale collection…`);
  const page = await context.newPage();

  try {
    await page.goto(SALE_URL, { waitUntil: 'domcontentloaded', timeout: 35000 });

    // Dismiss cookie banner
    try {
      await page.click('#onetrust-accept-btn-handler', { timeout: 3000 });
    } catch (_) {}

    await page.waitForTimeout(2000);

    // Scroll to load more products - Builder.io uses lazy loading
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    // Final wait for any remaining products to load
    await page.waitForTimeout(2000);

    // Extract deals from Builder.io structure
    const domDeals = await page.evaluate(({ storeName, storeKey }) => {
      const parsePrice = text => {
        const n = parseFloat((text || '').replace(/[^0-9.]/g, ''));
        return isNaN(n) ? null : n;
      };

      // Find all product links
      const productLinks = [...document.querySelectorAll('a[href*="/products/"]')];
      const seen = new Set();
      const results = [];

      for (const link of productLinks) {
        const url = link.href;
        if (!url || seen.has(url)) continue;

        // Extract product name from link text or nearby elements
        let name = '';

        // Try to find name in link's text content
        const linkText = link.textContent?.trim();
        if (linkText && !linkText.startsWith('CA$') && !linkText.startsWith('$') && linkText.length > 3) {
          name = linkText;
        }

        // Find container with prices - Builder.io uses nested divs
        let container = link;
        for (let depth = 0; depth < 10; depth++) {
          if (!container.parentElement) break;
          container = container.parentElement;

          // Look for price elements with "builder-text" class and text-decoration
          const allLinks = [...container.querySelectorAll('a')];
          const priceLinks = allLinks.filter(a => {
            const text = a.textContent || '';
            return text.includes('CA$') || text.includes('$');
          });

          if (priceLinks.length >= 2) {
            // Find strikethrough (original) and regular (sale) prices
            let salePrice = null;
            let regPrice = null;

            for (const pLink of priceLinks) {
              const hasLineThrough = pLink.style.textDecoration === 'line-through' ||
                                    pLink.getAttribute('style')?.includes('line-through');
              const priceText = pLink.textContent || '';
              const price = parsePrice(priceText);

              if (price) {
                if (hasLineThrough) {
                  regPrice = price;
                } else {
                  salePrice = salePrice || price;
                }
              }
            }

            if (salePrice && regPrice && salePrice < regPrice) {
              seen.add(url);

              // If we didn't find name in link, look in container
              if (!name) {
                const nameSpans = [...container.querySelectorAll('span.builder-text')];
                for (const span of nameSpans) {
                  const text = span.textContent?.trim() || '';
                  if (text && !text.includes('CA$') && !text.includes('$') && text.length > 5) {
                    name = text;
                    break;
                  }
                }
              }

              if (!name) {
                // Fallback to URL slug
                name = url.split('/').pop().replace(/-/g, ' ');
              }

              const imgEl = container.querySelector('img');
              const discount = Math.round((1 - salePrice / regPrice) * 100);

              if (discount > 0 && name) {
                results.push({
                  store: storeName, storeKey, name, url,
                  image: imgEl?.src || imgEl?.dataset?.src || '',
                  price: salePrice, originalPrice: regPrice, discount,
                  gender: '', tags: [],
                });
              }
              break;
            }
          }
        }
      }

      return results;
    }, { storeName: STORE_NAME, storeKey: STORE_KEY });

    for (const d of domDeals) {
      if (!seenUrls.has(d.url)) {
        seenUrls.add(d.url);
        allDeals.push(d);
      }
    }

  } catch (err) {
    onProgress(`Alo Yoga: error — ${err.message}`);
  } finally {
    await page.close();
  }

  // Process any XHR-intercepted products
  for (const p of rawProducts) {
    const d = mapShopifyProduct(p, seenUrls, rate);
    if (d) allDeals.push(d);
  }

  await context.close();

  const tagged = allDeals.map(d => ({
    ...d,
    id: d.id || slugify(`${STORE_KEY}-${d.name}`),
    currency: CURRENCY,
    priceCAD: Math.round(d.price * rate * 100) / 100,
    originalPriceCAD: Math.round(d.originalPrice * rate * 100) / 100,
    tags: tag({ name: d.name, gender: d.gender || '' }),
    scrapedAt: new Date().toISOString(),
  }));

  onProgress(`Alo Yoga: found ${tagged.length} deals`);
  return tagged;
}

function mapShopifyProduct(p, seen, rate) {
  try {
    const name = p.title || p.displayName || '';
    if (!name) return null;
    const handle = p.handle || slugify(name);
    const url = `https://www.aloyoga.com/products/${handle}`;
    if (seen.has(url)) return null;
    seen.add(url);

    // Extract variants - handle different API formats
    const variants = p.variants?.edges?.map(e => e.node) || p.variants || [];
    let priceUSD = null, origUSD = null;

    for (const v of variants) {
      // Try different price field formats
      let vPrice = parseFloat(v.priceV2?.amount || v.price?.amount || v.price || 0);
      let vCompare = parseFloat(v.compareAtPriceV2?.amount || v.compareAtPrice?.amount || v.compareAtPrice || v.compare_at_price || 0);

      // Some APIs store prices in cents
      if (vPrice > 1000) vPrice = vPrice / 100;
      if (vCompare > 1000) vCompare = vCompare / 100;

      if (vCompare > vPrice && vPrice > 0 && (priceUSD === null || vPrice < priceUSD)) {
        priceUSD = vPrice;
        origUSD = vCompare;
      }
    }

    if (!priceUSD || !origUSD || priceUSD >= origUSD) return null;

    const discount = Math.round((1 - priceUSD / origUSD) * 100);
    if (discount <= 0) return null;

    const priceCAD = Math.round(priceUSD * rate * 100) / 100;
    const originalPriceCAD = Math.round(origUSD * rate * 100) / 100;

    const images = p.images?.edges?.map(e => e.node) || p.images || [];
    const image = images[0]?.url || images[0]?.src || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${handle}`),
      store: STORE_NAME, storeKey: STORE_KEY,
      name, url, image,
      price: priceCAD, originalPrice: originalPriceCAD, discount,
      currency: CURRENCY, priceCAD, originalPriceCAD,
      tags: [], gender: '',
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
