'use strict';

const fetch = require('node-fetch');

const STORE_NAME = 'The Brick';
const STORE_KEY = 'thebrick';
const CURRENCY = 'CAD';

function ncTag(name) {
  const t = name.toLowerCase();
  if (/laptop|notebook|chromebook/.test(t)) return 'Computers';
  if (/desktop|workstation|mini pc/.test(t)) return 'Computers';
  if (/\bmonitor\b|\btv\b|television|oled|qled/.test(t)) return 'TVs & Displays';
  if (/\btablet\b|\bipad\b/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b|soundbar/.test(t)) return 'Audio';
  if (/\bcamera\b|mirrorless|dslr/.test(t)) return 'Cameras';
  if (/gaming|console|\bxbox\b|playstation|\bps5\b|nintendo|controller/.test(t)) return 'Gaming';
  if (/washer|dryer|fridge|refrigerator|dishwasher|microwave|\boven\b|\bstove\b|vacuum|air purifier|coffee maker|blender|toaster|freezer/.test(t)) return 'Appliances';
  if (/\bsofa\b|\bcouch\b|\bchair\b|\bdesk\b|\btable\b|\bshelf\b|\bbed\b|mattress|\blamp\b|\brug\b|wardrobe|dresser|nightstand|sectional|recliner|loveseat/.test(t)) return 'Furniture';
  if (/drill|saw|wrench|hammer|screwdriver|power tool|toolbox/.test(t)) return 'Tools & Home Improvement';
  if (/cookware|\bpot\b|\bpan\b|\bknife\b|bakeware|dinnerware/.test(t)) return 'Kitchen';
  return 'Appliances';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function scrape(browser, onProgress = () => {}) {
  const deals = [];
  const seen = new Set();
  let page = 1;

  onProgress('The Brick: fetching sale items via Shopify API…');

  while (page <= 10) {
    try {
      const res = await fetch(
        `https://www.thebrick.com/collections/on-sale/products.json?limit=250&page=${page}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36', 'Accept': 'application/json' }, timeout: 15000 }
      );
      const data = await res.json();
      const products = data.products || [];

      if (!products.length) break;

      for (const product of products) {
        for (const variant of product.variants) {
          if (!variant.compare_at_price) continue;
          const price = parseFloat(variant.price);
          const originalPrice = parseFloat(variant.compare_at_price);
          if (!price || !originalPrice || price >= originalPrice) continue;

          const name = product.title.replace(/\|.+$/, '').trim(); // strip French part
          if (seen.has(product.id)) continue;
          seen.add(product.id);

          const discount = Math.round(((originalPrice - price) / originalPrice) * 100);
          const image = product.images[0]?.src || '';
          const url = `https://www.thebrick.com/products/${product.handle}`;

          deals.push({
            id: slugify(`thebrick-${name}`),
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
            tags: ['Non-Clothing', ncTag(name)],
            scrapedAt: new Date().toISOString(),
          });
          break; // one variant per product
        }
      }

      onProgress(`The Brick: page ${page} — ${deals.length} deals so far`);
      if (products.length < 250) break;
      page++;
    } catch (err) {
      onProgress(`The Brick: error on page ${page} — ${err.message}`);
      break;
    }
  }

  onProgress(`The Brick: found ${deals.length} deals`);
  return deals;
}

module.exports = { scrape, STORE_KEY };
