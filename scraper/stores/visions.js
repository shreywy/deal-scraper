'use strict';

// Visions Electronics Canada — Algolia-powered search
// Fetches API credentials from the clearance page HTML, then queries Algolia directly.
// No Playwright needed.

const fetch = require('node-fetch');

const STORE_NAME = 'Visions Electronics';
const STORE_KEY = 'visions';
const CURRENCY = 'CAD';

// Collection pages to scrape — each maps to an Algolia category filter
const COLLECTIONS = [
  { page: 'https://www.visions.ca/deals/clearance', filter: 'categories_without_path:"Clearance"' },
  { page: 'https://www.visions.ca/deals/openbox',   filter: 'categories_without_path:"Open Box"'  },
];

function ncTag(name) {
  const t = name.toLowerCase();
  if (/laptop|notebook|chromebook|macbook/.test(t)) return 'Computers';
  if (/desktop|workstation|mini pc|all.in.one/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|oled|qled|4k display/.test(t)) return 'TVs & Displays';
  if (/iphone|smartphone|\btablet\b|\bipad\b/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|airpod|\bspeaker\b|soundbar|subwoofer/.test(t)) return 'Audio';
  if (/\bcamera\b|mirrorless|dslr|\bdrone\b/.test(t)) return 'Cameras';
  if (/gaming|console|\bxbox\b|playstation|\bps5\b|\bps4\b|nintendo|\bswitch\b|controller/.test(t)) return 'Gaming';
  if (/washer|dryer|fridge|refrigerator|dishwasher|microwave|\boven\b|\bstove\b|vacuum|air purifier|coffee maker|blender|toaster/.test(t)) return 'Appliances';
  if (/\bprinter\b|\bscanner\b|\bkeyboard\b|\bmouse\b|\bssd\b|hard drive|\brouter\b|webcam/.test(t)) return 'Computer Parts';
  if (/smart home|security cam|thermostat|smart lock/.test(t)) return 'Smart Home';
  if (/dash cam|radar detector|gps/.test(t)) return 'Auto Electronics';
  return 'Electronics';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function parsePrice(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}

async function fetchAlgoliaCredentials() {
  const res = await fetch(COLLECTIONS[0].page, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36' },
  });
  const html = await res.text();

  const marker = "window.algoliaConfig=JSON.parse('";
  const idx = html.indexOf(marker);
  if (idx === -1) throw new Error('algoliaConfig not found in page');

  const start = idx + marker.length;
  const end = html.indexOf("');", start);
  const raw = html.slice(start, end);

  // Decode unicode escapes (\u0022 → ", \u003A → :, etc.) before regex
  const decoded = raw.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

  // Extract just the fields we need via regex
  const appId    = decoded.match(/"applicationId"\s*:\s*"([^"]+)/)?.[1];
  const apiKey   = decoded.match(/"apiKey"\s*:\s*"([^"]+)/)?.[1];
  const baseName = decoded.match(/"baseIndexName"\s*:\s*"([^"]+)/)?.[1];

  if (!appId || !apiKey || !baseName) throw new Error('Failed to extract Algolia credentials');

  // Visions uses {baseName}_products as the products index
  const indexName = baseName.endsWith('_products') ? baseName : baseName + '_products';
  return { appId, apiKey, indexName };
}

async function queryAlgolia({ appId, apiKey, indexName }, filter, page = 0) {
  const res = await fetch(`https://${appId}-dsn.algolia.net/1/indexes/${indexName}/query`, {
    method: 'POST',
    headers: {
      'X-Algolia-Application-Id': appId,
      'X-Algolia-API-Key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: '',
      hitsPerPage: 250,
      page,
      filters: filter,
      attributesToRetrieve: ['name', 'url', 'image_url', 'thumbnail_url', 'sku', 'price', 'in_stock'],
    }),
  });
  if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`);
  return res.json();
}

/**
 * @param {import('playwright').Browser} _browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(_browser, onProgress = () => {}) {
  const allDeals = [];
  const seen = new Set();

  let creds;
  try {
    creds = await fetchAlgoliaCredentials();
    onProgress(`Visions: Algolia index ${creds.indexName}`);
  } catch (err) {
    onProgress(`Visions: failed to get credentials — ${err.message}`);
    return [];
  }

  for (const { filter } of COLLECTIONS) {
    const collName = filter.includes('Clearance') ? 'clearance' : 'open box';
    onProgress(`Visions: querying ${collName}…`);

    let pg = 0;
    let nbPages = 1;

    while (pg < nbPages) {
      try {
        const data = await queryAlgolia(creds, filter, pg);
        nbPages = data.nbPages || 1;

        for (const hit of data.hits || []) {
          if (!hit.in_stock) continue;

          const priceCAD = hit.price?.CAD;
          if (!priceCAD) continue;

          const price = priceCAD.default;
          const origStr = priceCAD.default_original_formated;
          if (!price || !origStr) continue;

          const originalPrice = parsePrice(origStr);
          if (!originalPrice || price >= originalPrice) continue;

          const discount = Math.round((1 - price / originalPrice) * 100);
          if (discount <= 0) continue;

          const name = hit.name || '';
          if (!name) continue;

          const url = hit.url || '';
          if (!url || seen.has(url)) continue;
          seen.add(url);

          const image = hit.image_url || hit.thumbnail_url || '';

          allDeals.push({
            id: slugify(`visions-${hit.sku || name}`),
            store: STORE_NAME,
            storeKey: STORE_KEY,
            name,
            url,
            image,
            price: Math.round(price * 100) / 100,
            originalPrice: Math.round(originalPrice * 100) / 100,
            discount,
            currency: CURRENCY,
            priceCAD: Math.round(price * 100) / 100,
            originalPriceCAD: Math.round(originalPrice * 100) / 100,
            tags: ['Non-Clothing', ncTag(name)],
            scrapedAt: new Date().toISOString(),
          });
        }

        onProgress(`Visions: ${collName} page ${pg + 1}/${nbPages} — ${allDeals.length} deals so far`);
        pg++;
      } catch (err) {
        onProgress(`Visions: error on ${collName} page ${pg} — ${err.message}`);
        break;
      }
    }
  }

  onProgress(`Visions: total ${allDeals.length} deals`);
  return allDeals;
}

module.exports = { scrape, STORE_KEY };
