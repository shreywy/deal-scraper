'use strict';

const STORE_NAME = 'Indigo';
const STORE_KEY = 'indigo';
const CURRENCY = 'CAD';

/**
 * Non-clothing category helper
 */
function ncTag(name, cat = '') {
  const t = `${name} ${cat}`.toLowerCase();
  if (/laptop|notebook|chromebook/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|oled|qled|frame tv/.test(t)) return 'TVs & Displays';
  if (/smartphone|galaxy s|galaxy a|\btablet\b|galaxy tab/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b|soundbar|galaxy buds/.test(t)) return 'Audio';
  if (/washer|dryer|fridge|refrigerator|dishwasher|microwave|vacuum|air purifier/.test(t)) return 'Appliances';
  if (/\bcamera\b|mirrorless/.test(t)) return 'Cameras';
  if (/gaming|console|controller/.test(t)) return 'Gaming';
  if (/book|novel|toy|\bgame\b|\bpuzzle\b|lego|craft|stationery/.test(t)) return 'Books & Toys';
  if (/\bwatch\b|smartwatch|galaxy watch/.test(t)) return 'Electronics';
  return 'Electronics';
}

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const allDeals = [];
  const seenUrls = new Set();
  let context = null;
  let page = null;

  try {
    // Shopify API is blocked - use Playwright DOM scraping
    onProgress('Indigo: using DOM scraping (Shopify API blocked)');

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      locale: 'en-CA',
    });

    page = await context.newPage();

    await page.goto('https://www.indigo.ca/en-ca/sale/', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.waitForTimeout(5000);

    // Scroll to load more products
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(1500);
    }

    onProgress('Indigo: extracting products from page...');

    const products = await page.evaluate(() => {
      const items = [];
      const tiles = Array.from(document.querySelectorAll('.product-tile'));

      tiles.forEach(tile => {
        try {
          const name = tile.getAttribute('data-cnstrc-item-name') || '';
          if (!name) return;

          const salePrice = parseFloat(tile.getAttribute('data-cnstrc-item-price') || '0');
          if (!salePrice) return;

          // Try to find original price in DOM
          const regularPriceEl = tile.querySelector('.strikethrough') || tile.querySelector('[class*="was-price"]');
          if (!regularPriceEl) return; // Skip if no original price

          const regularPriceText = regularPriceEl.textContent.trim().replace(/[^0-9.]/g, '');
          const regularPrice = parseFloat(regularPriceText);

          if (!regularPrice || salePrice >= regularPrice) return;

          const url = tile.querySelector('a')?.href || '';
          const image = tile.querySelector('img')?.src || '';

          items.push({ name, salePrice, regularPrice, url, image });
        } catch (err) {
          // Skip malformed tiles
        }
      });

      return items;
    });

    onProgress(`Indigo: found ${products.length} products with prices`);

    // Convert to deal objects
    for (const product of products) {
      try {
        const discount = Math.round((1 - product.salePrice / product.regularPrice) * 100);
        if (discount <= 0) continue;

        const url = product.url || '';
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        const deal = {
          id: slugify(`${STORE_KEY}-${product.name}`),
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name: product.name,
          url,
          image: product.image,
          price: parseFloat(product.salePrice.toFixed(2)),
          originalPrice: parseFloat(product.regularPrice.toFixed(2)),
          discount,
          currency: CURRENCY,
          priceCAD: parseFloat(product.salePrice.toFixed(2)),
          originalPriceCAD: parseFloat(product.regularPrice.toFixed(2)),
          tags: ['Non-Clothing', ncTag(product.name, '')],
          scrapedAt: new Date().toISOString(),
        };

        allDeals.push(deal);
      } catch (err) {
        continue;
      }
    }

    await page.close();
    await context.close();

  } catch (err) {
    onProgress(`Indigo: error — ${err.message}`);
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }

  onProgress(`Indigo: found ${allDeals.length} deals`);
  return allDeals;
}


function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
