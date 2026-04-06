'use strict';

const fetch = require('node-fetch');

const STORE_NAME = 'Leon\'s';
const STORE_KEY = 'leons';
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
  if (/\bprinter\b|\bscanner\b|\bkeyboard\b|\bmouse\b|webcam|\brouter\b|hard drive|\bssd\b|\bram\b|\bcpu\b|motherboard/.test(t)) return 'Computer Parts';
  if (/lego|\btoy\b|\btoys\b|action figure|doll|playset|puzzle|board game|card game|nerf|hot wheels/.test(t)) return 'Toys & Games';
  if (/book|novel|cookbook|memoir|biography|manga|textbook/.test(t)) return 'Books & Media';
  if (/skincare|shampoo|conditioner|moisturizer|serum|perfume|cologne|makeup|beauty|haircare/.test(t)) return 'Beauty & Health';
  if (/fitness|treadmill|dumbbell|kettlebell|yoga mat|exercise bike|elliptical/.test(t)) return 'Fitness';
  if (/drill|saw|wrench|hammer|screwdriver|power tool|toolbox|ladder|paint/.test(t)) return 'Tools & Home Improvement';
  if (/cookware|\bpot\b|\bpan\b|knife|cutting board|bakeware|dinnerware|utensil/.test(t)) return 'Kitchen';
  return 'Electronics';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

/**
 * Scrapes deals from Leon's Furniture
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  const deals = [];

  try {
    onProgress('Leon\'s: trying Shopify API…');
    const apiDeals = await tryShopifyAPI(onProgress);
    if (apiDeals && apiDeals.length > 0) {
      deals.push(...apiDeals);
      onProgress(`Leon's: found ${deals.length} deals via Shopify API`);
      return deals;
    }

    // Fallback to DOM scraping
    onProgress('Leon\'s: trying DOM scraping…');
    const domDeals = await tryDomScraping(browser, onProgress);
    if (domDeals && domDeals.length > 0) {
      deals.push(...domDeals);
      onProgress(`Leon's: found ${deals.length} deals via DOM`);
      return deals;
    }

    onProgress('Leon\'s: no deals found');
    return deals;

  } catch (error) {
    onProgress(`Leon's: error — ${error.message}`);
    console.error(`[${STORE_NAME}] Scraping failed:`, error);
    return deals;
  }
}

/**
 * Strategy 1: Shopify API
 */
async function tryShopifyAPI(onProgress) {
  const deals = [];

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= 10) {
      const url = `https://www.leons.ca/collections/deals/products.json?limit=250&page=${page}`;

      onProgress(`Leon's API: fetching page ${page}…`);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        timeout: 15000,
      });

      if (!response.ok) {
        onProgress(`Leon's API: returned ${response.status}`);
        break;
      }

      const data = await response.json();
      const products = data.products || [];

      if (products.length === 0) {
        hasMore = false;
        break;
      }

      for (const product of products) {
        try {
          const variants = product.variants || [];
          for (const variant of variants) {
            const comparePrice = parseFloat(variant.compare_at_price);
            const price = parseFloat(variant.price);

            if (!comparePrice || !price || price >= comparePrice) continue;

            const discount = Math.round(((comparePrice - price) / comparePrice) * 100);
            if (discount <= 0) continue;

            const name = variant.title !== 'Default Title'
              ? `${product.title} - ${variant.title}`
              : product.title;

            const deal = {
              id: slugify(`leons-${name}`),
              store: STORE_NAME,
              storeKey: STORE_KEY,
              name,
              url: `https://www.leons.ca/products/${product.handle}`,
              image: product.images?.[0]?.src || variant.featured_image?.src || '',
              price: parseFloat(price.toFixed(2)),
              originalPrice: parseFloat(comparePrice.toFixed(2)),
              discount,
              currency: CURRENCY,
              priceCAD: parseFloat(price.toFixed(2)),
              originalPriceCAD: parseFloat(comparePrice.toFixed(2)),
              tags: ['Non-Clothing', ncTag(product.title, product.product_type || '')],
              scrapedAt: new Date().toISOString(),
            };

            deals.push(deal);
            break; // One variant per product
          }
        } catch (error) {
          continue;
        }
      }

      onProgress(`Leon's API: page ${page} — ${deals.length} deals so far`);
      page++;
    }

    return deals.length > 0 ? deals : null;

  } catch (error) {
    onProgress(`Leon's API: error — ${error.message}`);
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

    await page.goto('https://www.leons.ca/collections/deals', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForTimeout(2000);

    // Scroll to load more products
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);
    }

    // Extract products
    const products = await page.evaluate(() => {
      const selectors = ['.product-card', '.product-item', '[class*="product"]', '.item'];

      let cards = [];
      for (const selector of selectors) {
        cards = Array.from(document.querySelectorAll(selector)).slice(0, 200);
        if (cards.length > 0) break;
      }

      return cards.map(card => {
        try {
          const nameEl = card.querySelector('.product-name, [class*="productName"], h3, h4');
          const name = nameEl?.textContent?.trim() || '';

          const linkEl = card.querySelector('a[href*="/products/"]');
          const url = linkEl?.href || '';

          const imgEl = card.querySelector('img');
          const image = imgEl?.src || '';

          const salePriceEl = card.querySelector('[class*="salePrice"], [class*="special"], .price-sale, .price');
          const salePrice = salePriceEl ? parseFloat(salePriceEl.textContent.replace(/[^0-9.]/g, '')) : null;

          const regPriceEl = card.querySelector('[class*="regularPrice"], [class*="compare"], del, s, .was-price');
          const regularPrice = regPriceEl ? parseFloat(regPriceEl.textContent.replace(/[^0-9.]/g, '')) : null;

          const categoryEl = card.querySelector('[class*="category"], [class*="type"]');
          const category = categoryEl?.textContent?.trim() || '';

          return { name, url, image, salePrice, regularPrice, category };
        } catch (error) {
          return null;
        }
      }).filter(p => p && p.name && p.url && p.salePrice && p.regularPrice);
    });

    for (const product of products) {
      try {
        if (product.salePrice >= product.regularPrice) continue;

        const discount = Math.round(((product.regularPrice - product.salePrice) / product.regularPrice) * 100);
        if (discount <= 0) continue;

        const deal = {
          id: slugify(`leons-${product.name}`),
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

    return deals.length > 0 ? deals : null;

  } catch (error) {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

module.exports = { scrape, STORE_KEY };
