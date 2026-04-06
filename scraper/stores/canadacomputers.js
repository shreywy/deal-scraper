'use strict';

const STORE_NAME = 'Canada Computers';
const STORE_KEY = 'canadacomputers';
const CURRENCY = 'CAD';
const BASE_URL = 'https://www.canadacomputers.com/en/clearance';
const MAX_PAGES = 8; // 12 products per page = ~96 products max

/**
 * Category helper for non-clothing items
 */
function ncTag(name) {
  const t = name.toLowerCase();
  if (/laptop|notebook|ultrabook|chromebook|macbook/.test(t)) return 'Computers';
  if (/desktop|workstation|mini pc|all.in.one/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|oled|qled/.test(t)) return 'TVs & Displays';
  if (/iphone|smartphone|\btablet\b|\bipad\b/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b|soundbar/.test(t)) return 'Audio';
  if (/\bcamera\b|mirrorless|dslr/.test(t)) return 'Cameras';
  if (/\bgaming\b|console|\bxbox\b|playstation|\bps5\b|nintendo|controller|\bgpu\b|graphics card/.test(t)) return 'Gaming';
  if (/washer|dryer|fridge|dishwasher|microwave|vacuum/.test(t)) return 'Appliances';
  if (/\bprinter\b|\bkeyboard\b|\bmouse\b|\brouter\b|hard drive|\bssd\b|\bram\b|\bcpu\b|motherboard|psu|power supply|cooler/.test(t)) return 'Computer Parts';
  return 'Electronics';
}

/**
 * Parse price string to float
 */
function parsePrice(priceStr) {
  if (!priceStr) return null;
  const cleaned = priceStr.replace(/[$,\s]/g, '');
  const price = parseFloat(cleaned);
  return isNaN(price) ? null : price;
}

/**
 * Scrapes deals from Canada Computers clearance section
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  const deals = [];
  const seen = new Set(); // deduplicate by URL across pages
  let context = null;
  let page = null;

  try {
    onProgress('Canada Computers: opening clearance page...');

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-CA',
    });

    page = await context.newPage();

    // Scrape pages 1-8
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      try {
        const pageUrl = pageNum === 1 ? BASE_URL : `${BASE_URL}?p=${pageNum}`;
        onProgress(`Canada Computers: scraping page ${pageNum}...`);

        await page.goto(pageUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        // Wait for products to load
        await page.waitForTimeout(2000);

        // Extract products from page
        const products = await page.evaluate(() => {
          const items = [];
          const cards = document.querySelectorAll('article.js-product-miniature');

          cards.forEach(card => {
            try {
              // Extract title
              const titleEl = card.querySelector('.product-title a');
              if (!titleEl) return;
              const name = titleEl.textContent.trim();
              if (!name) return;

              // Extract link
              const linkEl = card.querySelector('a.product-thumbnail') || titleEl;
              const url = linkEl ? linkEl.href : '';
              if (!url) return;

              // Extract image
              const imgEl = card.querySelector('img');
              const image = imgEl ? (imgEl.src || imgEl.dataset.src || '') : '';

              // Extract sale price (current price, may have class "price" or "no-sale-price")
              const priceEl = card.querySelector('.price');
              const salePriceText = priceEl ? priceEl.textContent.trim() : '';

              // Extract regular price (original, higher price)
              const regularPriceEl = card.querySelector('.regular-price');
              const regularPriceText = regularPriceEl ? regularPriceEl.textContent.trim() : '';

              if (name && salePriceText && regularPriceText && url) {
                items.push({ name, salePriceText, regularPriceText, image, url });
              }
            } catch (err) {
              // Skip malformed items
            }
          });

          return items;
        });

        onProgress(`Canada Computers: found ${products.length} products on page ${pageNum}`);

        // Stop if page returns 0 products
        if (products.length === 0) {
          onProgress(`Canada Computers: page ${pageNum} has no products, stopping pagination`);
          break;
        }

        // Process each product
        for (const product of products) {
          try {
            const salePrice = parsePrice(product.salePriceText);
            const regularPrice = parsePrice(product.regularPriceText);

            // Only include if we have valid prices AND regularPrice > salePrice (actual discount)
            if (!salePrice || !regularPrice || regularPrice <= salePrice) {
              continue;
            }

            const discount = Math.round(((regularPrice - salePrice) / regularPrice) * 100);
            if (discount <= 0) continue;

            if (seen.has(product.url)) continue;
            seen.add(product.url);

            const deal = {
              id: slugify(`canadacomputers-${product.name}`),
              store: STORE_NAME,
              storeKey: STORE_KEY,
              name: product.name,
              url: product.url,
              image: product.image || '',
              price: parseFloat(salePrice.toFixed(2)),
              originalPrice: parseFloat(regularPrice.toFixed(2)),
              discount,
              currency: CURRENCY,
              priceCAD: parseFloat(salePrice.toFixed(2)),
              originalPriceCAD: parseFloat(regularPrice.toFixed(2)),
              tags: ['Non-Clothing', ncTag(product.name)],
              scrapedAt: new Date().toISOString(),
            };

            deals.push(deal);
          } catch (error) {
            // Skip items that fail processing
            continue;
          }
        }
      } catch (pageError) {
        onProgress(`Canada Computers: error on page ${pageNum} — ${pageError.message}`);
        // Continue to next page on error
        continue;
      }
    }

    await page.close();
    await context.close();

    onProgress(`Canada Computers: found ${deals.length} total deals`);
    return deals;

  } catch (error) {
    onProgress(`Canada Computers: error — ${error.message}`);
    console.error(`[${STORE_NAME}] Scraping failed:`, error);

    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});

    return deals;
  }
}

/**
 * Create a URL-safe slug from a string
 */
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
