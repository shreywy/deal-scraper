'use strict';

const STORE_NAME = 'Microsoft CA';
const STORE_KEY = 'microsoft';
const CURRENCY = 'CAD';

// Non-clothing category helper
function ncTag(name, cat = '') {
  const t = `${name} ${cat}`.toLowerCase();
  if (/laptop|notebook|chromebook|surface pro|surface laptop/.test(t)) return 'Computers';
  if (/desktop|workstation|all.in.one|mini pc/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|oled/.test(t)) return 'TVs & Displays';
  if (/\btablet\b|smartphone|iphone|\bipad\b/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b|soundbar/.test(t)) return 'Audio';
  if (/\bcamera\b|mirrorless|dslr/.test(t)) return 'Cameras';
  if (/gaming|xbox|playstation|nintendo|controller|gpu|graphics/.test(t)) return 'Gaming';
  if (/washer|dryer|fridge|refrigerator|dishwasher|microwave|vacuum|air purifier|blender|coffee|kettle/.test(t)) return 'Appliances';
  if (/\bsofa\b|\bcouch\b|\bchair\b|\bdesk\b|\btable\b|\bbed\b|mattress|shelf|bookcase|lamp|rug|curtain|pillow|duvet/.test(t)) return 'Furniture';
  if (/\bprinter\b|\bkeyboard\b|\bmouse\b|\brouter\b|hard drive|\bssd\b|\bram\b/.test(t)) return 'Computer Parts';
  if (/book|novel|toy|\bpuzzle\b|game board|lego/.test(t)) return 'Books & Toys';
  if (/beauty|skincare|makeup|shampoo|vitamin|supplement|health/.test(t)) return 'Health & Beauty';
  return 'Electronics';
}

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Microsoft CA: sale page loads but products not accessible via DOM (React SPA with no exposed product data)');
  console.error(`[${STORE_NAME}] Sale page loads (200 OK) but products are rendered dynamically and not scrapable`);
  return [];
}

// The following functions are preserved for future reference if the sale page structure changes

function mapProduct_DISABLED(p) {
  try {
    const name = p.name || p.title || p.Title || p.productName || p.ProductName || '';
    if (!name) return null;

    const price = parseFloat(
      p.price?.current || p.price?.sale || p.salePrice || p.currentPrice ||
      p.Price || p.SalePrice || p.price || p.prices?.sale || 0
    );
    const originalPrice = parseFloat(
      p.price?.original || p.price?.list || p.comparePrice || p.originalPrice ||
      p.OriginalPrice || p.ListPrice || p.compareAtPrice || p.prices?.list || 0
    );

    if (!price || !originalPrice || price >= originalPrice) return null;

    const discount = Math.round((1 - price / originalPrice) * 100);
    if (discount <= 0) return null;

    const handle = p.handle || p.slug || p.Slug || slugify(name);
    const url = p.url || p.Url || p.ProductUrl || (handle ? `https://www.microsoft.com/en-ca/p/${handle}` : 'https://www.microsoft.com/en-ca/store/b/sale');
    const image = p.image?.url || p.imageUrl || p.ImageUrl || p.images?.[0]?.url || p.featuredImage?.url || '';
    const category = p.category || p.Category || p.productType || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${p.id || p.ProductId || ''}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price,
      originalPrice,
      discount,
      currency: CURRENCY,
      priceCAD: price,
      originalPriceCAD: originalPrice,
      tags: ['Non-Clothing', ncTag(name, category)],
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

async function loadAllProductsScroll_DISABLED(page, interceptedProducts, onProgress) {
  let lastHeight = 0;
  let lastCount = 0;
  let stable = 0;

  for (let i = 0; i < 20; i++) {
    const h = await page.evaluate(() => document.body.scrollHeight);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);

    if (h === lastHeight && interceptedProducts.length === lastCount) {
      if (++stable >= 3) break;
    } else {
      stable = 0;
      lastHeight = h;
      lastCount = interceptedProducts.length;
      if (interceptedProducts.length) {
        onProgress(`Microsoft CA: loading... (${interceptedProducts.length} products)`);
      }
    }
  }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
