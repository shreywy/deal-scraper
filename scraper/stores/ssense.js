'use strict';

const { tag } = require('../tagger');

const STORE_NAME = 'SSENSE';
const STORE_KEY = 'ssense';
const CURRENCY = 'CAD';

const SALE_URLS = [
  { url: 'https://www.ssense.com/en-ca/men/sale', gender: 'Men' },
  { url: 'https://www.ssense.com/en-ca/women/sale', gender: 'Women' },
];

/**
 * SSENSE — Canadian luxury/streetwear retailer from Montreal.
 * Uses DOM scraping (Cloudflare-protected).
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

  const seenUrls = new Set();
  const allDeals = [];

  for (const { url: saleUrl, gender } of SALE_URLS) {
    onProgress(`SSENSE: loading ${gender} sale…`);
    const page = await context.newPage();
    try {
      await page.goto(saleUrl, { waitUntil: 'networkidle', timeout: 45000 });
      await page.waitForTimeout(5000);

      // Scroll to load more products
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy(0, 1500));
        await page.waitForTimeout(2000);
      }

      // Extract products from DOM
      const domDeals = await page.evaluate(({ storeName, storeKey, defaultGender }) => {
        const parsePrice = text => {
          if (!text) return null;
          const match = text.match(/\$\s*(\d+(?:,\d{3})*)/);
          return match ? parseFloat(match[1].replace(/,/g, '')) : null;
        };

        const tiles = document.querySelectorAll('.plp-products__product-tile, [class*="product-tile"]');
        const deals = [];
        const seen = new Set();

        tiles.forEach(tile => {
          try {
            // Get link - SSENSE uses /en-ca/men/ or /en-ca/women/ patterns
            const link = tile.querySelector('a[href]');
            if (!link) return;
            const url = link.href;
            if (seen.has(url)) return;
            seen.add(url);

            // Get name from description section
            const descEl = tile.querySelector('.product-tile__description, [class*="description"]');
            const brandEl = descEl?.querySelector('.s-text, [class*="brand"], [class*="designer"]');
            const nameEl = descEl?.querySelector('.s-text:not([class*="price"]):not([class*="caption"])');
            const brand = brandEl?.textContent?.trim() || '';
            const productName = nameEl?.textContent?.trim() || '';
            const name = brand && productName ? `${brand} ${productName}` : (brand || productName || '');

            if (!name) return;

            // Get prices from pricing section
            const pricingEl = tile.querySelector('.product-tile__pricing, [class*="pricing"]');
            if (!pricingEl) return;

            const allPriceEls = pricingEl.querySelectorAll('.s-text, [class*="price"]');
            let salePrice = null;
            let originalPrice = null;

            allPriceEls.forEach(el => {
              const className = el.className || '';
              const text = el.textContent?.trim() || '';
              const price = parsePrice(text);

              if (price) {
                if (className.includes('line-through') || className.includes('discount') ||
                    el.tagName === 'DEL' || el.tagName === 'S') {
                  originalPrice = price;
                } else {
                  salePrice = price;
                }
              }
            });

            if (!salePrice || !originalPrice || salePrice >= originalPrice) return;

            // Get image - SSENSE uses <picture> with <source> elements for lazy loading
            const pictureEl = tile.querySelector('picture.product-tile__image');
            const sourceEl = pictureEl?.querySelector('source');
            let image = '';

            if (sourceEl) {
              // Extract from srcset or data-srcset (lazy loading)
              const srcset = sourceEl.srcset || sourceEl.dataset?.srcset || '';
              if (srcset) {
                // srcset format: "url descriptor, url descriptor"
                // Cloudinary URLs include commas in params, so match until image extension
                const urlMatch = srcset.match(/^(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|webp|gif))/i);
                image = urlMatch ? urlMatch[1] : srcset.split(/\s/)[0]; // fallback to first space-separated token
              }
            }

            // Fallback to img src if picture/source not found
            if (!image) {
              const imgEl = tile.querySelector('img');
              image = imgEl?.src || imgEl?.dataset?.src || '';
              // Skip data: URIs (placeholders)
              if (image.startsWith('data:')) {
                image = '';
              }
            }

            const discount = Math.round((1 - salePrice / originalPrice) * 100);
            if (discount <= 0) return;

            deals.push({
              store: storeName,
              storeKey,
              name,
              url,
              image,
              price: salePrice,
              originalPrice,
              discount,
              gender: defaultGender,
              tags: [],
            });
          } catch (err) {
            console.error('Error parsing tile:', err);
          }
        });

        return deals;
      }, { storeName: STORE_NAME, storeKey: STORE_KEY, defaultGender: gender });

      for (const d of domDeals) {
        if (!seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          allDeals.push(d);
        }
      }

      onProgress(`SSENSE: ${gender} — found ${domDeals.length} deals`);
    } catch (err) {
      onProgress(`SSENSE: error — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  const tagged = allDeals.map(d => ({
    ...d,
    id: slugify(`${STORE_KEY}-${d.name}-${d.url.split('/').pop()}`),
    currency: CURRENCY,
    priceCAD: d.price,
    originalPriceCAD: d.originalPrice,
    tags: tag({ name: d.name, gender: d.gender || '' }),
    scrapedAt: new Date().toISOString(),
  }));

  await context.close();
  onProgress(`SSENSE: found ${tagged.length} total deals`);
  return tagged;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
