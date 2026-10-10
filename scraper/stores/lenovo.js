'use strict';

// Lenovo Canada — doorbusters deals page
// Uses XHR intercept to capture openapi.lenovo.com product query API,
// then paginates via page.evaluate (same session, CORS allowed from lenovo.com origin).

const STORE_NAME = 'Lenovo CA';
const STORE_KEY = 'lenovo';
const DEALS_URL = 'https://www.lenovo.com/ca/en/d/deals/doorbusters/?sortBy=Recommended';

function ncTag(name) {
  const t = name.toLowerCase();
  if (/laptop|notebook|ultrabook|thinkpad|ideapad|yoga|legion|chromebook/.test(t)) return 'Computers';
  if (/desktop|workstation|mini pc|all.in.one|all in one|tiny|tower/.test(t)) return 'Computers';
  if (/\bmonitor\b|television|\btv\b|display/.test(t)) return 'TVs & Displays';
  if (/\btablet\b|\bipad\b/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b/.test(t)) return 'Audio';
  if (/\bkeyboard\b|\bmouse\b|\bssd\b|\bram\b|hard drive|\bdock\b|docking|adapter|charger|cable/.test(t)) return 'Computer Parts';
  if (/printer|scanner/.test(t)) return 'Computer Parts';
  if (/gaming|geforce|radeon|gpu|graphics/.test(t)) return 'Gaming';
  return 'Electronics';
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function mapProduct(p) {
  const name = p.productName || '';
  if (!name) return null;

  const price = parseFloat(p.instantSavingPrice || p.finalPrice || 0);
  const originalPrice = parseFloat(p.webPrice || 0);
  if (!price || !originalPrice || price >= originalPrice) return null;

  const discount = parseInt(p.instantSavingSavePercentage || p.savePercent || 0, 10) ||
    Math.round((1 - price / originalPrice) * 100);
  if (discount <= 0) return null;

  // Skip items not purchasable or out of stock
  if (p.purchaseFlag === false || p.inventoryStatus === 0) return null;

  const relUrl = p.url || '';
  const productUrl = relUrl.startsWith('http') ? relUrl : `https://www.lenovo.com${relUrl}`;
  if (!productUrl || productUrl === 'https://www.lenovo.com') return null;

  let image = p.media?.thumbnail?.imageAddress || '';
  if (image.startsWith('//')) image = 'https:' + image;

  return {
    id: slugify(`lenovo-${p.productCode || name}`),
    store: STORE_NAME,
    storeKey: STORE_KEY,
    name,
    url: productUrl,
    image,
    price: Math.round(price * 100) / 100,
    originalPrice: Math.round(originalPrice * 100) / 100,
    discount,
    currency: 'CAD',
    priceCAD: Math.round(price * 100) / 100,
    originalPriceCAD: Math.round(originalPrice * 100) / 100,
    tags: ['Non-Clothing', ncTag(name)],
    scrapedAt: new Date().toISOString(),
  };
}

/**
 * @param {import('playwright').Browser} browser
 * @param {function(string):void} [onProgress]
 * @returns {Promise<import('../index').Deal[]>}
 */
async function scrape(browser, onProgress = () => {}) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-CA',
    extraHTTPHeaders: { 'Accept-Language': 'en-CA,en;q=0.9' },
  });

  const page = await context.newPage();
  const allProducts = [];
  let pageFilterId = null;
  let pageCount = 1;

  // Intercept the first product/query/get response to get page 1 data + pagination info
  const firstResponse = new Promise(resolve => {
    page.on('response', async resp => {
      if (resp.url().includes('product/query/get') && !pageFilterId) {
        try {
          const u = new URL(resp.url());
          pageFilterId = u.searchParams.get('pageFilterId');
          const data = await resp.json();
          const d = data?.data;
          if (d) {
            pageCount = d.pageCount || 1;
            const groups = d.data || [];
            const products = groups.flatMap(g => g.products || []);
            allProducts.push(...products);
          }
          resolve();
        } catch (_) { resolve(); }
      }
    });
  });

  try {
    onProgress('Lenovo: loading doorbusters page…');
    await page.goto(DEALS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await Promise.race([firstResponse, page.waitForTimeout(10000)]);

    if (!pageFilterId) {
      onProgress('Lenovo: no API response intercepted');
      await context.close();
      return [];
    }

    onProgress(`Lenovo: page 1 — ${allProducts.length} products, ${pageCount} pages total`);

    // Fetch remaining pages via browser-context fetch (CORS allowed from lenovo.com origin)
    for (let pg = 2; pg <= pageCount; pg++) {
      try {
        const products = await page.evaluate(async ({ pfId, pg: pageNum }) => {
          const params = {
            classificationGroupIds: '400001',
            pageFilterId: pfId,
            facets: [],
            page: String(pageNum),
            pageSize: 20,
            groupCode: '',
            init: false,
            sorts: ['bestSelling'],
            version: 'v2',
            enablePreselect: false,
            subseriesCode: '',
          };
          const url = `https://openapi.lenovo.com/ca/en/ofp/search/dlp/product/query/get/_tsc?pageFilterId=${pfId}&subSeriesCode=&loyalty=false&params=${encodeURIComponent(JSON.stringify(params))}`;
          const res = await fetch(url);
          const data = await res.json();
          const groups = data?.data?.data || [];
          return groups.flatMap(g => g.products || []);
        }, { pfId: pageFilterId, pg });

        allProducts.push(...products);
        onProgress(`Lenovo: page ${pg} — ${allProducts.length} products so far`);
      } catch (err) {
        onProgress(`Lenovo: error on page ${pg} — ${err.message}`);
      }
    }

    const deals = allProducts.map(mapProduct).filter(Boolean);
    // Deduplicate by id
    const seen = new Set();
    const deduped = deals.filter(d => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });

    onProgress(`Lenovo: ${deduped.length} deals found`);
    return deduped;

  } catch (err) {
    onProgress(`Lenovo: error — ${err.message}`);
    return [];
  } finally {
    await context.close();
  }
}

module.exports = { scrape, STORE_KEY };
