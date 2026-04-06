'use strict';

const STORE_NAME = 'Dyson CA';
const STORE_KEY = 'dyson';
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
 * Scrapes deals from Dyson Canada
 * @param {Object} browser - Playwright browser instance
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of deal objects
 */
async function scrape(browser, onProgress = () => {}) {
  let context = null;
  let page = null;
  const deals = [];

  try {
    onProgress('Dyson CA: navigating to sale page…');

    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-CA',
    });

    page = await context.newPage();

    const urls = [
      'https://www.dyson.ca/en_CA/sale',
      'https://www.dyson.ca/en_CA/outlet',
    ];

    for (const url of urls) {
      try {
        onProgress(`Dyson CA: loading ${url}…`);

        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        await page.waitForTimeout(3000);

        // Scroll to load more products
        for (let i = 0; i < 3; i++) {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.waitForTimeout(2000);
        }

        onProgress(`Dyson CA: extracting products from ${url}…`);

        // Extract products from DOM
        const products = await page.evaluate(() => {
          const selectors = [
            '[class*="product"]',
            '[data-product]',
            '.product-card',
            '.product-item',
            '[class*="ProductCard"]',
          ];

          let cards = [];
          for (const selector of selectors) {
            cards = Array.from(document.querySelectorAll(selector)).slice(0, 200);
            if (cards.length > 0) break;
          }

          return cards.map(card => {
            try {
              // Find product name
              const nameSelectors = [
                '.product-name',
                '[class*="productName"]',
                '[class*="ProductName"]',
                'h3',
                'h4',
                'h2',
                '[class*="title"]',
              ];
              let name = '';
              for (const sel of nameSelectors) {
                const el = card.querySelector(sel);
                if (el && el.textContent.trim()) {
                  name = el.textContent.trim();
                  break;
                }
              }

              // Find sale price
              const salePriceSelectors = [
                '[class*="salePrice"]',
                '[class*="sale-price"]',
                '[class*="currentPrice"]',
                '[class*="special"]',
                '.price',
              ];
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
              const regPriceSelectors = [
                '[class*="regularPrice"]',
                '[class*="regular-price"]',
                '[class*="wasPrice"]',
                '[class*="was-price"]',
                'del',
                's',
                '[class*="old-price"]',
              ];
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
              const imgEl = card.querySelector('img');
              const image = imgEl?.src || imgEl?.dataset?.src || '';

              // Find URL
              const linkEl = card.querySelector('a[href*="/product/"], a[href*="/p/"], a');
              const url = linkEl?.href || '';

              // Category
              const categoryEl = card.querySelector('[class*="category"], [class*="type"]');
              const category = categoryEl?.textContent?.trim() || '';

              return { name, salePrice, regularPrice, image, url, category };
            } catch (error) {
              return null;
            }
          }).filter(p => p && p.name && p.salePrice && p.regularPrice && p.url);
        });

        onProgress(`Dyson CA: found ${products.length} products with prices from ${url}`);

        // Process products into deals
        for (const product of products) {
          try {
            if (product.salePrice >= product.regularPrice) continue;

            const discount = Math.round(((product.regularPrice - product.salePrice) / product.regularPrice) * 100);
            if (discount <= 0) continue;

            const deal = {
              id: slugify(`dyson-${product.name}`),
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

      } catch (error) {
        onProgress(`Dyson CA: ${url} failed — ${error.message}`);
        continue;
      }
    }

    onProgress(`Dyson CA: found ${deals.length} total deals`);
    return deals;

  } catch (error) {
    onProgress(`Dyson CA: error — ${error.message}`);
    console.error(`[${STORE_NAME}] Scraping failed:`, error);
    return [];
  } finally {
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

module.exports = { scrape, STORE_KEY };
