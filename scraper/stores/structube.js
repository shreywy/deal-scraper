'use strict';

const STORE_NAME = 'Structube';
const STORE_KEY = 'structube';
const CURRENCY = 'CAD';

// Non-clothing category helper
function ncTag(name, cat = '') {
  const t = `${name} ${cat}`.toLowerCase();
  if (/laptop|notebook|ultrabook|chromebook|macbook/.test(t)) return 'Computers';
  if (/desktop|workstation|mini pc|all.in.one|all in one/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|oled|qled|4k display/.test(t)) return 'TVs & Displays';
  if (/iphone|smartphone|cell phone|mobile phone|\btablet\b|\bipad\b/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|airpod|\bspeaker\b|soundbar|subwoofer/.test(t)) return 'Audio';
  if (/\bcamera\b|mirrorless|dslr|\bdrone\b/.test(t)) return 'Cameras';
  if (/\bgaming\b|console|\bxbox\b|playstation|\bps5\b|\bps4\b|nintendo|\bswitch\b|controller|gpu|graphics card/.test(t)) return 'Gaming';
  if (/washer|dryer|fridge|refrigerator|dishwasher|microwave|\boven\b|\bstove\b|vacuum|air purifier|coffee maker|espresso|blender|toaster/.test(t)) return 'Appliances';
  if (/\bsofa\b|\bcouch\b|\bchair\b|\bdesk\b|\btable\b|\bshelf\b|bookcase|\bbed\b|mattress|\blamp\b|\brug\b|wardrobe|dresser|nightstand|bookshelf/.test(t)) return 'Furniture';
  if (/\bprinter\b|\bscanner\b|\bkeyboard\b|\bmouse\b|webcam|\brouter\b|hard drive|\bssd\b|\bram\b|\bcpu\b|motherboard|graphics card/.test(t)) return 'Computer Parts';
  if (/lego|\btoy\b|\btoys\b|action figure|doll|playset|puzzle|board game|card game|nerf|hot wheels/.test(t)) return 'Toys & Games';
  if (/book|novel|cookbook|memoir|biography|manga|textbook/.test(t)) return 'Books & Media';
  if (/skincare|shampoo|conditioner|moisturizer|serum|perfume|cologne|makeup|beauty|haircare/.test(t)) return 'Beauty & Health';
  if (/fitness|treadmill|dumbbell|kettlebell|yoga mat|exercise bike|elliptical/.test(t)) return 'Fitness';
  if (/drill|saw|wrench|hammer|screwdriver|power tool|toolbox|ladder|paint/.test(t)) return 'Tools & Home Improvement';
  if (/cookware|pot\b|\bpan\b|knife|cutting board|bakeware|dinnerware|utensil|spatula/.test(t)) return 'Kitchen';
  return 'Electronics';
}

/**
 * Scrapes deals from Structube
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  const deals = [];

  try {
    onProgress('Structube: trying XHR interception…');
    const xhrDeals = await tryXhrInterception(browser, onProgress);
    if (xhrDeals && xhrDeals.length > 0) {
      deals.push(...xhrDeals);
      onProgress(`Structube: found ${deals.length} deals via XHR`);
      return deals;
    }

    // Fallback to DOM if XHR fails
    onProgress('Structube: trying DOM scraping…');
    const domDeals = await tryDomScraping(browser, onProgress);
    if (domDeals && domDeals.length > 0) {
      deals.push(...domDeals);
      onProgress(`Structube: found ${deals.length} deals via DOM`);
      return deals;
    }

    onProgress('Structube: no deals found');
    return deals;

  } catch (error) {
    onProgress(`Structube: error — ${error.message}`);
    console.error(`[${STORE_NAME}] Scraping failed:`, error);
    return deals;
  }
}

/**
 * Strategy 1: XHR interception
 */
async function tryXhrInterception(browser, onProgress) {
  let context = null;
  let page = null;
  const deals = [];
  const interceptedProducts = [];

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
        const contentType = response.headers()['content-type'] || '';

        if (contentType.includes('json') &&
            (url.includes('/api/') || url.includes('search') || url.includes('products'))) {
          try {
            const data = await response.json();

            // Check various possible data structures
            const products = data?.products || data?.items || data?.results ||
                           data?.data?.products || data?.data?.items || [];

            if (Array.isArray(products) && products.length > 0) {
              interceptedProducts.push(...products);
              onProgress(`Structube XHR: intercepted ${products.length} products (total: ${interceptedProducts.length})`);
            }
          } catch (jsonError) {
            // Not JSON or parsing failed
          }
        }
      } catch (error) {
        // Ignore response parsing errors
      }
    });

    // Navigate to sale page
    await page.goto('https://www.structube.com/en_ca/sale', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for content to load
    await page.waitForTimeout(3000);

    // Scroll to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // Scroll again
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);

    // Parse intercepted products
    if (interceptedProducts.length > 0) {
      const parsedDeals = parseProducts(interceptedProducts);
      if (parsedDeals && parsedDeals.length > 0) {
        deals.push(...parsedDeals);
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

    await page.goto('https://www.structube.com/en_ca/sale', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForTimeout(3000);

    // Scroll to load more products
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    // Extract products from DOM
    const products = await page.evaluate(() => {
      const selectors = [
        '[class*="product"]',
        '.product-tile',
        '.product-item',
        '[data-product]',
      ];

      let cards = [];
      for (const selector of selectors) {
        cards = Array.from(document.querySelectorAll(selector)).slice(0, 200);
        if (cards.length > 0) break;
      }

      return cards.map(card => {
        try {
          // Find product name
          const nameSelectors = ['.product-name', '[class*="productName"]', 'h4', 'h3', 'h2'];
          let name = '';
          for (const sel of nameSelectors) {
            const el = card.querySelector(sel);
            if (el && el.textContent.trim()) {
              name = el.textContent.trim();
              break;
            }
          }

          // Find sale price
          const salePriceSelectors = ['[class*="salePrice"]', '[class*="currentPrice"]', '.price', '[class*="special-price"]'];
          let salePrice = null;
          for (const sel of salePriceSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              const text = el.textContent.trim().replace(/[^0-9.]/g, '');
              salePrice = parseFloat(text);
              if (salePrice) break;
            }
          }

          // Find regular price
          const regPriceSelectors = ['[class*="regularPrice"]', '[class*="wasPrice"]', 'del', 's', '[class*="old-price"]'];
          let regularPrice = null;
          for (const sel of regPriceSelectors) {
            const el = card.querySelector(sel);
            if (el) {
              const text = el.textContent.trim().replace(/[^0-9.]/g, '');
              regularPrice = parseFloat(text);
              if (regularPrice) break;
            }
          }

          // Find image
          const imgSelectors = ['img', '[class*="productImage"]'];
          let image = '';
          for (const sel of imgSelectors) {
            const el = card.querySelector(sel);
            if (el && el.src) {
              image = el.src;
              break;
            }
          }

          // Find URL
          const linkSelectors = ['a[href*="/product/"]', 'a[href*="/p/"]', 'a'];
          let url = '';
          for (const sel of linkSelectors) {
            const el = card.querySelector(sel);
            if (el && el.href) {
              url = el.href;
              break;
            }
          }

          // Category
          const catSelectors = ['[class*="category"]', '[class*="classification"]'];
          let category = '';
          for (const sel of catSelectors) {
            const el = card.querySelector(sel);
            if (el && el.textContent.trim()) {
              category = el.textContent.trim();
              break;
            }
          }

          return { name, salePrice, regularPrice, image, url, category };
        } catch (error) {
          return null;
        }
      }).filter(p => p && p.name && p.salePrice && p.regularPrice && p.url);
    });

    // Process products into deals
    for (const product of products) {
      try {
        if (product.salePrice >= product.regularPrice) continue;

        const discount = Math.round(((product.regularPrice - product.salePrice) / product.regularPrice) * 100);
        if (discount <= 0) continue;

        const deal = {
          id: slugify(`structube-${product.name}`),
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
          tags: ['Non-Clothing', ncTag(product.name, product.category)],
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
 * Parse Structube products from API response
 */
function parseProducts(products) {
  const deals = [];
  const seen = new Set();

  for (const product of products) {
    try {
      const name = product.name || product.productDisplayName || product.title || '';
      if (!name) continue;

      // Extract pricing
      let salePrice = product.salePrice || product.salePriceLow ||
                      product.prices?.salePriceLow || product.prices?.sale ||
                      product.currentPrice || product.price;

      let regularPrice = product.regularPrice || product.listPriceLow ||
                        product.prices?.listPriceLow || product.prices?.regular ||
                        product.originalPrice || product.listPrice;

      if (!salePrice || !regularPrice) continue;

      salePrice = parseFloat(salePrice);
      regularPrice = parseFloat(regularPrice);

      if (salePrice >= regularPrice) continue;

      const discount = Math.round(((regularPrice - salePrice) / regularPrice) * 100);
      if (discount <= 0) continue;

      // Build URL
      let url = product.url || product.productUrl || product.link || '';
      if (url && !url.startsWith('http')) {
        url = `https://www.structube.com${url}`;
      }
      if (!url) continue;
      if (seen.has(url)) continue;
      seen.add(url);

      // Image
      let image = product.thumbnailImage || product.largeImage ||
                  product.image || product.primaryFullImageURL || '';
      if (image && !image.startsWith('http')) {
        image = `https://www.structube.com${image}`;
      }

      // Category
      const category = product.classificationName || product.categoryName ||
                      product.category || product.classification || '';

      const deal = {
        id: slugify(`structube-${name}`),
        store: STORE_NAME,
        storeKey: STORE_KEY,
        name: name.trim(),
        url,
        image: image || '',
        price: parseFloat(salePrice.toFixed(2)),
        originalPrice: parseFloat(regularPrice.toFixed(2)),
        discount,
        currency: CURRENCY,
        priceCAD: parseFloat(salePrice.toFixed(2)),
        originalPriceCAD: parseFloat(regularPrice.toFixed(2)),
        tags: ['Non-Clothing', ncTag(name, category)],
        scrapedAt: new Date().toISOString(),
      };

      deals.push(deal);
    } catch (error) {
      // Skip malformed products
      continue;
    }
  }

  return deals.length > 0 ? deals : null;
}

/**
 * Create a URL-safe slug from a string
 */
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

module.exports = { scrape, STORE_KEY };
