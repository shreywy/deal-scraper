'use strict';

const STORE_NAME = 'Walmart CA';
const STORE_KEY = 'walmart';
const CURRENCY = 'CAD';

function ncTag(name, cat = '') {
  const t = `${name} ${cat}`.toLowerCase();
  if (/laptop|notebook|ultrabook|chromebook|macbook/.test(t)) return 'Computers';
  if (/desktop|workstation|mini pc|all.in.one/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|oled|qled/.test(t)) return 'TVs & Displays';
  if (/iphone|smartphone|cell phone|\btablet\b|\bipad\b/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b|soundbar/.test(t)) return 'Audio';
  if (/\bcamera\b|mirrorless|dslr/.test(t)) return 'Cameras';
  if (/\bgaming\b|console|\bxbox\b|playstation|\bps5\b|nintendo|controller|gpu/.test(t)) return 'Gaming';
  if (/washer|dryer|fridge|dishwasher|microwave|vacuum|air purifier|coffee maker/.test(t)) return 'Appliances';
  if (/\bsofa\b|\bdesk\b|\btable\b|\bchair\b|mattress|bookcase/.test(t)) return 'Furniture';
  if (/\bprinter\b|\bkeyboard\b|\bmouse\b|\brouter\b|hard drive|\bssd\b|\bram\b|\bcpu\b/.test(t)) return 'Computer Parts';
  return 'Electronics';
}

/**
 * Walmart Canada — bot-blocked
 *
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  onProgress('Walmart CA: bot-blocked (timeout on all sale pages, no GraphQL interception)');
  console.error(`[${STORE_NAME}] Bot-blocked: Sale pages timeout, GraphQL endpoints not accessible`);
  return [];
}

// The following functions are preserved for future reference if bot protection is bypassed

function mapProduct_DISABLED(p, seen) {
  try {
    const name = p.name || p.item?.name || p.title || '';
    if (!name) return null;

    // Walmart price structures vary
    const priceObj = p.price || p.priceInfo || p.item?.price || {};
    const currentPrice = parseFloat(
      priceObj.currentPrice?.price ||
      priceObj.current?.price ||
      priceObj.price ||
      0
    );

    const wasPrice = parseFloat(
      priceObj.wasPrice?.price ||
      priceObj.was?.price ||
      priceObj.comparisonPrice?.price ||
      0
    );

    if (!currentPrice || !wasPrice || currentPrice >= wasPrice) return null;

    const discount = Math.round((1 - currentPrice / wasPrice) * 100);
    if (discount <= 0) return null;

    // Build product URL
    const canonicalUrl = p.canonicalUrl || p.productPageUrl || p.seeDetails || '';
    const productId = p.usItemId || p.productId || p.id || '';
    let url = '';

    if (canonicalUrl) {
      url = canonicalUrl.startsWith('http')
        ? canonicalUrl
        : `https://www.walmart.ca${canonicalUrl}`;
    } else if (productId) {
      url = `https://www.walmart.ca/en/ip/${slugify(name)}/${productId}`;
    }

    if (!url || seen.has(url)) return null;
    seen.add(url);

    // Image
    const imageObj = p.imageInfo || p.image || {};
    const imagePath =
      imageObj.thumbnailUrl ||
      imageObj.allImages?.[0]?.url ||
      imageObj.url ||
      '';
    const image = imagePath.startsWith('http') ? imagePath : (imagePath ? `https://i5.walmartimages.ca${imagePath}` : '');

    const category = p.category?.path || p.primaryCategory || '';

    return {
      id: slugify(`${STORE_KEY}-${name}-${productId}`),
      store: STORE_NAME,
      storeKey: STORE_KEY,
      name,
      url,
      image,
      price: currentPrice,
      originalPrice: wasPrice,
      discount,
      currency: CURRENCY,
      priceCAD: currentPrice,
      originalPriceCAD: wasPrice,
      category,
      tags: ['Non-Clothing', ncTag(name, category)],
      scrapedAt: new Date().toISOString(),
    };
  } catch (_) { return null; }
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

module.exports = { scrape, STORE_KEY };
