'use strict';

const STORE_NAME = 'Canada Computers';
const STORE_KEY = 'canadacomputers';
const CURRENCY = 'CAD';

/**
 * Category helper for non-clothing items
 */
function ncTag(name, cat = '') {
  const t = `${name} ${cat}`.toLowerCase();
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
 * Scrapes deals from Canada Computers
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  const deals = [];

  try {
    onProgress('Canada Computers: trying XHR interception…');

    // Strategy 1: Browser XHR interception
    const xhrDeals = await tryXhrInterception(browser, onProgress);
    if (xhrDeals && xhrDeals.length > 0) {
      deals.push(...xhrDeals);
      onProgress(`Canada Computers: found ${deals.length} deals via XHR`);
      return deals;
    }

    // Strategy 2: DOM scraping fallback
    onProgress('Canada Computers: trying DOM scraping…');
    const domDeals = await tryDomScraping(browser, onProgress);
    if (domDeals && domDeals.length > 0) {
      deals.push(...domDeals);
      onProgress(`Canada Computers: found ${deals.length} deals via DOM`);
      return deals;
    }

    onProgress('Canada Computers: no deals found');
    return deals;

  } catch (error) {
    onProgress(`Canada Computers: error — ${error.message}`);
    console.error(`[${STORE_NAME}] Scraping failed:`, error);
    return deals;
  }
}

/**
 * Strategy 1: Browser XHR interception
 */
async function tryXhrInterception(browser, onProgress) {
  let context = null;
  let page = null;
  const deals = [];
  const interceptedItems = [];

  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-CA',
    });

    page = await context.newPage();

    // Intercept API responses
    page.on('response', async (response) => {
      try {
        const url = response.url();

        // Look for Canada Computers API calls
        if (url.includes('canadacomputers.com') &&
            (url.includes('api') || url.includes('search') || url.includes('product'))) {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json')) {
            try {
              const data = await response.json();

              // Try different response structures
              const items = data?.products ||
                           data?.items ||
                           data?.results ||
                           data?.data ||
                           [];

              if (Array.isArray(items) && items.length > 0) {
                interceptedItems.push(...items);
                onProgress(`Canada Computers XHR: captured ${items.length} items (total: ${interceptedItems.length})`);
              }
            } catch (jsonError) {
              // Not JSON or parsing failed
            }
          }
        }
      } catch (error) {
        // Ignore response parsing errors
      }
    });

    // Try multiple deal URLs
    const urls = [
      'https://www.canadacomputers.com/deals.php',
      'https://www.canadacomputers.com/deals',
      'https://www.canadacomputers.com/search.php?on_sale=1&show=96',
    ];

    for (const url of urls) {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        await page.waitForTimeout(2000);

        // Scroll to trigger more content
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(2000);

        // If we found items, no need to try other URLs
        if (interceptedItems.length > 0) break;
      } catch (err) {
        // Try next URL
        continue;
      }
    }

    // Process intercepted items
    if (interceptedItems.length > 0) {
      onProgress(`Canada Computers: processing ${interceptedItems.length} intercepted items...`);

      for (const item of interceptedItems) {
        const deal = parseCanadaComputersItem(item);
        if (deal) deals.push(deal);
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
 * Parse Canada Computers API item into deal object
 */
function parseCanadaComputersItem(item) {
  try {
    const name = item.name || item.title || item.product_name || item.productName || '';
    if (!name) return null;

    // Price extraction
    const price = parseFloat(item.price || item.sale_price || item.special_price || item.salePrice || 0);
    const originalPrice = parseFloat(item.regular_price || item.originalPrice || item.regularPrice || item.msrp || 0);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round(((originalPrice - price) / originalPrice) * 100);
    if (discount <= 0) return null;

    // URL construction
    let url = item.url || item.link || item.product_url || item.productUrl || '';
    if (url && !url.startsWith('http')) {
      url = `https://www.canadacomputers.com${url}`;
    }
    if (!url) return null;

    // Image URL
    let image = item.image || item.img || item.image_url || item.imageUrl || item.thumbnail || '';
    if (image && !image.startsWith('http')) {
      image = `https://www.canadacomputers.com${image}`;
    }

    // Category detection
    const category = item.category || item.category_name || item.categoryName || '';

    return {
      id: slugify(`canadacomputers-${name}-${item.sku || item.id || ''}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name: name.trim(),
      url,
      image: image || '',
      price: parseFloat(price.toFixed(2)),
      originalPrice: parseFloat(originalPrice.toFixed(2)),
      discount,
      currency: CURRENCY,
      priceCAD: parseFloat(price.toFixed(2)),
      originalPriceCAD: parseFloat(originalPrice.toFixed(2)),
      tags: ['Non-Clothing', ncTag(name, category)],
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    return null;
  }
}

/**
 * Strategy 2: DOM scraping fallback
 */
async function tryDomScraping(browser, onProgress) {
  let context = null;
  let page = null;
  const deals = [];

  try {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-CA',
    });

    page = await context.newPage();

    await page.goto('https://www.canadacomputers.com/deals.php', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForTimeout(3000);

    // Scroll to load more products
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    // Extract products from DOM
    const products = await page.evaluate(() => {
      const items = [];

      // Canada Computers uses various selectors
      const selectors = [
        '.product-wrapper',
        '.item-product',
        '[class*="product-"]',
        'div[id^="product"]',
        '.productTemplate',
      ];

      let cards = [];
      for (const selector of selectors) {
        cards = Array.from(document.querySelectorAll(selector));
        if (cards.length > 0) break;
      }

      cards.forEach(card => {
        try {
          // Extract name
          const titleSelectors = [
            '.product-title a',
            'h3 a',
            '.productName',
            '[class*="product-name"]',
            'a.productTemplate_title',
          ];
          let name = '';
          for (const sel of titleSelectors) {
            const el = card.querySelector(sel);
            if (el && el.textContent.trim()) {
              name = el.textContent.trim();
              break;
            }
          }
          if (!name) return;

          // Extract sale price
          const salePriceSelectors = [
            '.price-wrapper .price',
            '.sales-price',
            '.special-price',
            '[class*="sale-price"]',
            '.pq-hprice',
          ];
          let salePrice = null;
          for (const sel of salePriceSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              const priceText = el.textContent.trim().replace(/[^0-9.]/g, '');
              salePrice = parseFloat(priceText);
              if (salePrice) break;
            }
          }

          // Extract original price
          const regPriceSelectors = [
            '.regular-price',
            '.price-wrapper del',
            '.was-price',
            '[class*="regular-price"]',
            's',
            'del',
          ];
          let regularPrice = null;
          for (const sel of regPriceSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              const priceText = el.textContent.trim().replace(/[^0-9.]/g, '');
              regularPrice = parseFloat(priceText);
              if (regularPrice) break;
            }
          }

          // Extract image
          const imgSelectors = [
            '.product-image img',
            'img.product-img',
            'img[class*="product"]',
            'img',
          ];
          let image = '';
          for (const sel of imgSelectors) {
            const el = card.querySelector(sel);
            if (el && el.src) {
              image = el.src;
              break;
            }
          }

          // Extract URL
          const linkSelectors = [
            'a.product-link',
            'a.productTemplate_title',
            'a[href*="product_info"]',
            'a',
          ];
          let url = '';
          for (const sel of linkSelectors) {
            const el = card.querySelector(sel);
            if (el && el.href) {
              url = el.href;
              break;
            }
          }

          if (name && salePrice && regularPrice && url && salePrice < regularPrice) {
            items.push({ name, salePrice, regularPrice, image, url });
          }
        } catch (err) {
          // Skip malformed items
        }
      });

      return items;
    });

    // Convert to deal objects
    for (const product of products) {
      try {
        const discount = Math.round(((product.regularPrice - product.salePrice) / product.regularPrice) * 100);

        const deal = {
          id: slugify(`canadacomputers-${product.name}`),
          store: STORE_NAME,
          storeKey: STORE_KEY,
          name: product.name,
          url: product.url,
          image: product.image || '',
          price: parseFloat(product.salePrice.toFixed(2)),
          originalPrice: parseFloat(product.regularPrice.toFixed(2)),
          discount,
          currency: CURRENCY,
          priceCAD: parseFloat(product.salePrice.toFixed(2)),
          originalPriceCAD: parseFloat(product.regularPrice.toFixed(2)),
          tags: ['Non-Clothing', ncTag(product.name)],
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
function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
