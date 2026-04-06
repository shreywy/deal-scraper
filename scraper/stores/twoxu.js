'use strict';

const { tag } = require('../tagger');
const { getUSDtoCAD } = require('../currency');

const STORE_NAME = '2XU';
const STORE_KEY = 'twoxu';
const OUTLET_COLLECTIONS = [
  'https://www.2xu.com/collections/men-outlet',
  'https://www.2xu.com/collections/women-outlet'
];

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const allDeals = [];
  const seen = new Set();
  let rate = 1.0;
  let currency = 'USD';

  for (const collectionUrl of OUTLET_COLLECTIONS) {
    const gender = collectionUrl.includes('men-outlet') ? 'Men' : 'Women';
    const page = await browser.newPage();

    try {
      onProgress(`2XU: navigating to ${gender} outlet…`);
      await page.goto(collectionUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // Detect currency from page (once, on first collection)
      if (collectionUrl === OUTLET_COLLECTIONS[0]) {
        const currencyInfo = await page.evaluate(() => {
          // Try to find currency indicators
          const metaEl = document.querySelector('meta[property="og:price:currency"]');
          if (metaEl) return metaEl.content;

          // Look for currency symbols or text in price elements
          const priceText = document.querySelector('.money, .price, [class*="price"]')?.textContent || '';
          if (priceText.includes('$') && !priceText.includes('CAD')) return 'USD';
          if (priceText.includes('CAD') || priceText.includes('CA$')) return 'CAD';
          if (priceText.includes('USD') || priceText.includes('US$')) return 'USD';

          // Check URL or domain
          if (window.location.hostname.includes('ca.2xu') || window.location.pathname.includes('/ca/') || window.location.pathname.includes('/en-ca/')) {
            return 'CAD';
          }

          return 'USD'; // default assumption
        });

        currency = currencyInfo || 'USD';

        if (currency === 'USD') {
          onProgress('2XU: fetching USD→CAD rate…');
          rate = await getUSDtoCAD();
          onProgress(`2XU: 1 USD = ${rate.toFixed(4)} CAD`);
        } else {
          onProgress('2XU: using CAD prices (no conversion needed)');
        }
      }

      // Wait for products to load
      await page.waitForTimeout(3000);

      // Scroll to lazy-load more products
      onProgress(`2XU: scrolling to load ${gender} products…`);
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1500);
      }

      onProgress(`2XU: extracting ${gender} product data from DOM…`);

      const products = await page.evaluate((detectedGender) => {
      const items = [];

      // Try multiple selector patterns for product cards
      const selectors = [
        '.product-item',
        '.grid-product',
        '[data-product]',
        '.product-card',
        '.collection-product',
        '.product'
      ];

      let productElements = [];
      for (const selector of selectors) {
        productElements = Array.from(document.querySelectorAll(selector));
        if (productElements.length > 0) break;
      }

      for (const el of productElements) {
        try {
          // Get product name
          const nameEl = el.querySelector('.product-title, .product-name, .product__title, h3, h2, [class*="title"], [class*="name"]');
          const name = nameEl?.textContent?.trim();
          if (!name) continue;

          // Get URL
          const linkEl = el.querySelector('a[href*="/products/"], a');
          const href = linkEl?.getAttribute('href');
          if (!href) continue;
          const url = href.startsWith('http') ? href : `https://www.2xu.com${href}`;

          // Get image
          const imgEl = el.querySelector('img');
          const image = imgEl?.src || imgEl?.getAttribute('data-src') || '';

          // Get prices - try multiple patterns
          const priceSelectors = [
            '.price, .product-price, .product__price, .money',
            '[class*="price"]',
            '[data-price]'
          ];

          let priceText = '';
          let originalPriceText = '';

          for (const pSelector of priceSelectors) {
            const priceEls = Array.from(el.querySelectorAll(pSelector));
            if (priceEls.length === 0) continue;

            // Look for sale/compare price patterns
            const saleEl = priceEls.find(p =>
              p.classList.contains('sale') ||
              p.classList.contains('price--sale') ||
              p.classList.contains('product-price--sale') ||
              p.classList.contains('price-item--sale') ||
              p.textContent.includes('Sale')
            );

            const compareEl = priceEls.find(p =>
              p.classList.contains('compare-at-price') ||
              p.classList.contains('price--compare') ||
              p.classList.contains('price-item--regular') ||
              p.textContent.includes('Was') ||
              p.querySelector('s, del, strike')
            );

            if (saleEl) priceText = saleEl.textContent;
            if (compareEl) originalPriceText = compareEl.textContent;

            if (priceText && originalPriceText) break;

            // If no clear sale/compare, try getting strikethrough vs non-strikethrough
            if (!priceText || !originalPriceText) {
              const strikeEl = el.querySelector('s, del, strike, .line-through, [style*="line-through"]');
              const regularEls = priceEls.filter(p => !p.querySelector('s, del, strike'));

              if (strikeEl) originalPriceText = strikeEl.textContent;
              if (regularEls.length > 0) {
                // Take first non-strikethrough price
                priceText = regularEls[0].textContent;
              }
            }

            if (priceText && originalPriceText) break;
          }

          items.push({
            name,
            url,
            image,
            priceText: priceText || '',
            originalPriceText: originalPriceText || '',
            gender: detectedGender // Use gender from collection URL
          });
        } catch (_) {}
      }

      return items;
      }, gender);

      onProgress(`2XU: ${gender} - found ${products.length} products, filtering for deals…`);

      for (const p of products) {
      try {
        // Parse prices
        const price = parsePrice(p.priceText);
        const originalPrice = parsePrice(p.originalPriceText);

        // Must have both prices and be on sale
        if (!price || !originalPrice || price >= originalPrice) continue;

        const discount = Math.round((1 - price / originalPrice) * 100);
        if (discount <= 0) continue;

        const url = p.url;
        if (seen.has(url)) continue;
        seen.add(url);

        const deal = {
          id: slugify(`twoxu-${p.name}`),
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name: p.name,
          url,
          image: p.image,
          price,
          originalPrice,
          discount,
          currency,
          priceCAD: currency === 'CAD' ? price : Math.round(price * rate * 100) / 100,
          originalPriceCAD: currency === 'CAD' ? originalPrice : Math.round(originalPrice * rate * 100) / 100,
          ...(currency === 'USD' && { exchangeRate: rate }),
          gender: p.gender,
          tags: tag({ name: p.name, gender: p.gender }),
          scrapedAt: new Date().toISOString(),
        };

        allDeals.push(deal);
      } catch (_) {}
      }

      onProgress(`2XU: ${gender} - ${allDeals.filter(d => d.gender === gender).length} deals total`);
    } catch (err) {
      onProgress(`2XU: Error on ${gender} - ${err.message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  onProgress(`2XU: total ${allDeals.length} deals found`);
  return allDeals;
}

function parsePrice(str) {
  if (!str) return null;
  const match = str.match(/[\d,]+\.?\d*/);
  if (!match) return null;
  const num = parseFloat(match[0].replace(/,/g, ''));
  return num > 0 ? num : null;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
