'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

// Carhartt uses Angular app on .com domain
// No working .ca site - scrapes USD prices from .com and converts to CAD

const URLS = [
  'https://www.carhartt.com/c/mens-promo-all',
  'https://www.carhartt.com/c/womens-promo-all',
];
const STORE_NAME = 'Carhartt';
const STORE_KEY = 'carhartt';

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  const allDeals = [];
  const seenUrls = new Set();

  // Get USD->CAD exchange rate
  const exchangeRate = await getUSDtoCAD();

  for (const url of URLS) {
    onProgress(`Carhartt: loading ${url.includes('womens') ? 'women\'s' : 'men\'s'} promo page…`);
    const page = await context.newPage();

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000});

      // Dismiss cookie banner
      try {
        await page.click('#onetrust-accept-btn-handler, [class*="onetrust-accept"], button:has-text("Accept")', { timeout: 4000 });
      } catch (_) {}

      // Wait for Angular to render products
      await page.waitForTimeout(6000);

      const rawDeals = await page.evaluate(() => {
        // Carhartt uses Angular - products have .price-range elements
        // Start from price elements and work up to find containers
        const priceElements = document.querySelectorAll('.price-range');

        const parsePrice = el => {
          if (!el) return null;
          const text = el.textContent || '';
          // Handle "$20.99 — $24.74" by taking first price
          const match = text.match(/\$?([\d,]+\.?\d*)/);
          if (!match) return null;
          const n = parseFloat(match[1].replace(/,/g, ''));
          return isNaN(n) ? null : n;
        };

        const seen = new Set();
        const results = [];

        for (const priceEl of priceElements) {
          // Go up to find a container with a product link AND image
          let container = priceEl;
          let link = null;
          let depth = 0;

          while (container && depth < 20) {
            link = container.querySelector('a[href*="/product/"]');
            if (link) {
              // Keep going up to find the container that has both link and image
              const img = container.querySelector('cx-media img, .product-image img');
              if (img) break;
            }
            container = container.parentElement;
            depth++;
          }

          if (!link || !container) continue;
          if (seen.has(link.href)) continue;
          seen.add(link.href);

          // Extract from this container
          const nameEl = container.querySelector('.product-name');
          // Target the main product image specifically (inside cx-media or with product-image class)
          // Avoid badges, icons, etc. by looking for larger images or specific containers
          const imgEl = container.querySelector('cx-media img.ng-star-inserted, .product-image img') ||
                        container.querySelector('img[alt*="Carhartt"]');

          // "with-strike" is the SALE price, without strike is ORIGINAL
          const salePriceEl = container.querySelector('.price-range.with-strike');
          const origPriceEl = container.querySelector('.price-range:not(.with-strike)');

          const salePrice = parsePrice(salePriceEl);
          const origPrice = parsePrice(origPriceEl);

          if (!salePrice || !origPrice || salePrice >= origPrice) continue;

          // Extract image URL - prefer src, handle srcset if needed
          let imageUrl = '';
          if (imgEl) {
            imageUrl = imgEl.src || '';
            // If src is empty but srcset exists, parse srcset to get base URL
            if (!imageUrl && imgEl.srcset) {
              const srcsetParts = imgEl.srcset.split(',')[0].trim().split(' ');
              imageUrl = srcsetParts[0];
            }
            // Ensure absolute URL
            if (imageUrl && !imageUrl.startsWith('http')) {
              imageUrl = new URL(imageUrl, 'https://www.carhartt.com').href;
            }
          }

          results.push({
            url: link.href,
            name: nameEl?.textContent?.trim() || link.getAttribute('title') || '',
            image: imageUrl,
            price: salePrice,
            originalPrice: origPrice
          });
        }

        return results;
      });

      // Convert USD to CAD and add metadata
      const deals = rawDeals.map(d => {
        const priceCAD = Math.round(d.price * exchangeRate * 100) / 100;
        const originalPriceCAD = Math.round(d.originalPrice * exchangeRate * 100) / 100;
        const discount = Math.round((1 - priceCAD / originalPriceCAD) * 100);

        return {
          id: slugify(`carhartt-${d.name}`),
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name: d.name,
          url: d.url,
          image: d.image,
          price: priceCAD,
          originalPrice: originalPriceCAD,
          discount,
          currency: 'CAD',
          priceCAD,
          originalPriceCAD,
          exchangeRate,
          tags: tag({ name: d.name }),
          scrapedAt: new Date().toISOString(),
        };
      });

      for (const d of deals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          allDeals.push(d);
        }
      }

      onProgress(`Carhartt: found ${deals.length} deals from ${url}`);

    } catch (err) {
      onProgress(`Carhartt: error on ${url} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();
  onProgress(`Carhartt: found ${allDeals.length} deals total`);
  return allDeals;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
