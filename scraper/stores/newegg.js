'use strict';

const STORE_NAME = 'NewEgg CA';
const STORE_KEY = 'newegg';
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
 * Scrapes deals from NewEgg Canada
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  const deals = [];

  try {
    onProgress('NewEgg CA: trying XHR interception…');

    // Strategy 1: Browser XHR interception
    const xhrDeals = await tryXhrInterception(browser, onProgress);
    if (xhrDeals && xhrDeals.length > 0) {
      deals.push(...xhrDeals);
      onProgress(`NewEgg CA: found ${deals.length} deals via XHR`);
      return deals;
    }

    // Strategy 2: DOM scraping fallback
    onProgress('NewEgg CA: trying DOM scraping…');
    const domDeals = await tryDomScraping(browser, onProgress);
    if (domDeals && domDeals.length > 0) {
      deals.push(...domDeals);
      onProgress(`NewEgg CA: found ${deals.length} deals via DOM`);
      return deals;
    }

    onProgress('NewEgg CA: no deals found');
    return deals;

  } catch (error) {
    onProgress(`NewEgg CA: error — ${error.message}`);
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

        // Look for NewEgg API calls
        if ((url.includes('newegg.ca') && url.includes('api')) ||
            url.includes('/Product/') ||
            url.includes('/Search/')) {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('json')) {
            try {
              const data = await response.json();

              // Try different response structures
              const items = data?.SearchResult?.Items ||
                           data?.ProductList ||
                           data?.Items ||
                           data?.products ||
                           [];

              if (Array.isArray(items) && items.length > 0) {
                interceptedItems.push(...items);
                onProgress(`NewEgg CA XHR: captured ${items.length} items (total: ${interceptedItems.length})`);
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

    // Navigate to on-sale products
    await page.goto('https://www.newegg.ca/p/pl?N=4017&Order=SALESPRICE&PageSize=96', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for content to load
    await page.waitForTimeout(3000);

    // Scroll to trigger more content
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // Also try deals page
    try {
      await page.goto('https://www.newegg.ca/deals', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(3000);
    } catch (err) {
      // Deals page might not load, continue with what we have
    }

    // Process intercepted items
    if (interceptedItems.length > 0) {
      onProgress(`NewEgg CA: processing ${interceptedItems.length} intercepted items...`);

      for (const item of interceptedItems) {
        const deal = parseNeweggItem(item);
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
 * Parse NewEgg API item into deal object
 */
function parseNeweggItem(item) {
  try {
    const name = item.Title || item.title || item.name || '';
    if (!name) return null;

    // Price extraction - NewEgg uses UnitPrice and OldPrice
    const price = parseFloat(item.UnitPrice || item.price || item.FinalPrice || 0);
    const originalPrice = parseFloat(item.OldPrice || item.originalPrice || item.MSRP || 0);

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round(((originalPrice - price) / originalPrice) * 100);
    if (discount <= 0) return null;

    // URL construction
    let url = item.ProductPage || item.url || item.link || '';
    if (url && !url.startsWith('http')) {
      url = `https://www.newegg.ca${url}`;
    }
    if (!url) return null;

    // Image URL
    let image = item.Image || item.image || item.ImageUrl || item.img || '';
    if (image && !image.startsWith('http')) {
      image = `https://c1.neweggimages.com/ProductImage/${image}`;
    }

    // Category detection
    const category = item.SubCategory || item.category || item.BrandInfo?.BrandName || '';

    return {
      id: slugify(`newegg-${name}-${item.NeweggItemNumber || item.SKU || ''}`),
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

    await page.goto('https://www.newegg.ca/p/pl?N=4017&Order=SALESPRICE&PageSize=96', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForTimeout(3000);

    // Extract products from DOM
    const products = await page.evaluate(() => {
      const items = [];

      // NewEgg uses .item-cell or .item-container
      const cards = document.querySelectorAll('.item-cell, .item-container, [class*="item-"]');

      cards.forEach(card => {
        try {
          // Extract name
          const titleEl = card.querySelector('.item-title, [class*="item-title"]');
          const name = titleEl ? titleEl.textContent.trim() : '';
          if (!name) return;

          // Extract sale price
          const salePriceEl = card.querySelector('.price-current, [class*="price-current"]');
          let salePrice = null;
          if (salePriceEl) {
            const priceText = salePriceEl.textContent.trim().replace(/[^0-9.]/g, '');
            salePrice = parseFloat(priceText);
          }

          // Extract original price
          const regPriceEl = card.querySelector('.price-was, [class*="price-was"]');
          let regularPrice = null;
          if (regPriceEl) {
            const priceText = regPriceEl.textContent.trim().replace(/[^0-9.]/g, '');
            regularPrice = parseFloat(priceText);
          }

          // Extract image
          const imgEl = card.querySelector('.item-img img, img[class*="item"]');
          const image = imgEl ? imgEl.src : '';

          // Extract URL
          const linkEl = card.querySelector('a.item-title, a[href*="/Product/"]');
          const url = linkEl ? linkEl.href : '';

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
          id: slugify(`newegg-${product.name}`),
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
