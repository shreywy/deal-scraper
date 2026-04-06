'use strict';

// ── State ────────────────────────────────────────────────────────────────────
let allDeals = [];
let filteredDeals = [];
let cols = 4;
let currentSort = 'discount';
let config = null;

// Tile min-widths for each size step — auto-fill handles actual column count
const TILE_WIDTHS = { 1: 480, 2: 360, 3: 280, 4: 220, 5: 175, 6: 150, 7: 125, 8: 100 };
const SIZE_LABELS = { 1: 'XL', 2: 'L', 3: 'M-L', 4: 'M', 5: 'M-S', 6: 'S', 7: 'XS', 8: 'XXS' };

const FILTER_DEFAULTS = { store: 'all', gender: 'all', category: 'all', price: 'all', discount: '0' };
const filters = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('dealFilters') || 'null');
    return saved ? { ...FILTER_DEFAULTS, ...saved } : { ...FILTER_DEFAULTS };
  } catch (_) { return { ...FILTER_DEFAULTS }; }
})();

const EXCLUDE_KEYS = ['store', 'gender', 'category', 'price', 'discount'];
const excludedFilters = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('dealFiltersExcluded') || 'null');
    const base = { store: [], gender: [], category: [], price: [], discount: [] };
    if (saved) EXCLUDE_KEYS.forEach(k => { if (Array.isArray(saved[k])) base[k] = saved[k]; });
    return base;
  } catch (_) { return { store: [], gender: [], category: [], price: [], discount: [] }; }
})();

function saveFilters() {
  try {
    localStorage.setItem('dealFilters', JSON.stringify(filters));
    localStorage.setItem('dealFiltersExcluded', JSON.stringify(excludedFilters));
  } catch (_) {}
}

// Pagination
const PAGE_SIZE = 100;
let currentPage = 1;

// Strip state
let lastScrapedAt = null;
let lastDealCount = 0;
let stripLive = false;
let stripTimerInterval = null;
let refreshInProgress = false;

// Per-store scrape progress for the hover popdown
// { storeKey: { name, status: 'pending'|'done'|'error', count, error } }
let storeProgress = {};
let popdownHideTimer = null;


// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  if (localStorage.getItem('darkMode') === 'true') {
    document.documentElement.classList.add('dark');
  }

  const savedCols = parseInt(localStorage.getItem('gridCols') || '4');
  if (savedCols >= 1 && savedCols <= 8) cols = savedCols;
  applyGridSize();


  try {
    const res = await fetch('/api/config');
    config = await res.json();
    renderSettingsDrawer(config);
  } catch (_) {}

  showSkeletons(12);
  setStrip('loading', 'Loading…');

  let hasCache = false;
  try {
    const res = await fetch('/api/deals');
    if (res.status === 204) {
      clearGrid();
      setStrip('cached', 'No cache yet…');
    } else {
      const data = await res.json();
      lastScrapedAt = data.scrapedAt;
      lastDealCount = data.deals?.length || 0;
      stripLive = false;
      updateStripText();
      startStripTimer();
      loadDeals(data.deals);
      hasCache = true;
    }
  } catch (_) {
    clearGrid();
    setStrip('cached', 'Could not load cache');
  }

  // Check if a background scrape is already running (server launched it due to stale cache)
  // If so, connect to SSE to stream live progress. Do NOT auto-trigger a new scrape.
  try {
    const statusRes = await fetch('/api/status');
    const status = await statusRes.json();
    if (status.scrapeInProgress) {
      // Server is already scraping — attach to the live stream for progress
      startRefreshStream();
    } else if (!hasCache) {
      // No cache and no scrape in progress — shouldn't happen normally, but handle it
      startRefreshStream();
    }
    // Otherwise: cache is fresh, server is idle → do nothing. User can manually refresh.
  } catch (_) {
    if (!hasCache) startRefreshStream();
  }
}

// ── Strip ─────────────────────────────────────────────────────────────────────
function setStrip(state, text) {
  const strip = document.getElementById('refreshStrip');
  strip.classList.remove('live', 'outdated');
  if (state === 'live') strip.classList.add('live');
  if (state === 'outdated') strip.classList.add('outdated');
  document.getElementById('stripText').textContent = text;
}

function updateStripText() {
  if (!lastScrapedAt) return;
  const ageMs = Date.now() - new Date(lastScrapedAt);
  const ageSecs = Math.floor(ageMs / 1000);
  const ageStr = ageSecs < 60 ? 'just now'
    : ageSecs < 3600 ? `${Math.floor(ageSecs / 60)}m ago`
    : ageSecs < 86400 ? `${Math.floor(ageSecs / 3600)}h ago`
    : `${Math.floor(ageSecs / 86400)}d ago`;

  const isOutdated = ageMs > 12 * 3600 * 1000; // >12h = outdated
  const prefix = refreshInProgress ? 'Cached' : (stripLive ? 'Up to date' : 'Cached');

  const strip = document.getElementById('refreshStrip');
  strip.classList.remove('live', 'outdated');
  if (stripLive && !isOutdated) strip.classList.add('live');
  if (isOutdated) strip.classList.add('outdated');

  const refreshing = refreshInProgress ? ' · Refreshing…' : '';
  document.getElementById('stripText').textContent =
    `${prefix} · ${lastDealCount} deals · ${ageStr}${refreshing}`;
}

function startStripTimer() {
  if (stripTimerInterval) clearInterval(stripTimerInterval);
  stripTimerInterval = setInterval(updateStripText, 30000); // every 30s
}

function manualRefresh() {
  if (refreshInProgress) return;
  // Close existing SSE and open a new one
  startRefreshStream();
}

// ── SSE Refresh Stream ────────────────────────────────────────────────────────
let currentSSE = null;

function showGridOverlay(msg) {
  const ov = document.getElementById('gridOverlay');
  document.getElementById('gridOverlayLabel').textContent = msg || 'Refreshing deals…';
  ov.style.display = 'flex';
}
function hideGridOverlay() {
  document.getElementById('gridOverlay').style.display = 'none';
}

function startRefreshStream() {
  if (currentSSE) { currentSSE.close(); currentSSE = null; }
  refreshInProgress = true;
  // Don't cover cached deals with the overlay — only show overlay when there's nothing to display
  if (allDeals.length === 0) showGridOverlay('Connecting…');
  if (lastScrapedAt) updateStripText();
  else setStrip('cached', 'Scraping…');

  // Init per-store progress from config for the popdown
  storeProgress = {};
  if (config?.stores) {
    for (const [key, s] of Object.entries(config.stores)) {
      if (s.enabled) storeProgress[key] = { name: s.name, status: 'pending', count: 0, error: null };
    }
  }

  const es = new EventSource('/api/refresh');
  currentSSE = es;

  es.addEventListener('started', e => {
    const { liveStoreProgress } = JSON.parse(e.data);
    if (liveStoreProgress) storeProgress = liveStoreProgress;
    renderScrapePopdown();
  });

  es.addEventListener('progress', e => {
    const { message, liveStoreProgress } = JSON.parse(e.data);
    document.getElementById('gridOverlayLabel').textContent = message;
    if (!lastScrapedAt) setStrip('cached', message);
    if (liveStoreProgress) { storeProgress = liveStoreProgress; renderScrapePopdown(); }
  });

  es.addEventListener('partial', e => {
    const { storeKey, deals, liveStoreProgress } = JSON.parse(e.data);
    if (liveStoreProgress) { storeProgress = liveStoreProgress; renderScrapePopdown(); }

    // Merge this store's deals into allDeals (replace old deals from same store)
    if (deals && deals.length > 0) {
      // Remove existing deals from this store (match by storeKey or store name)
      const storeName = config?.stores?.[storeKey]?.name;
      allDeals = allDeals.filter(d => {
        if (d.storeKey) return d.storeKey !== storeKey;
        if (storeName) return d.store !== storeName;
        return true;
      });
      allDeals.push(...deals);

      document.getElementById('gridOverlayLabel').textContent =
        `Found ${allDeals.length} deals so far…`;
      buildDynamicFilters();
      applyFiltersAndRender();

      // Hide skeleton overlay on first partial result
      if (allDeals.length > 0) hideGridOverlay();
    }
  });

  es.addEventListener('complete', e => {
    const { count, scrapedAt } = JSON.parse(e.data);
    lastScrapedAt = scrapedAt;
    lastDealCount = count;
    stripLive = true;
    refreshInProgress = false;
    updateStripText();
    startStripTimer();
    // Fetch final sorted list from server (already cached)
    fetch('/api/deals').then(r => r.json()).then(data => {
      hideGridOverlay();
      loadDeals(data.deals);
    }).catch(() => hideGridOverlay());
    es.close(); currentSSE = null;
    renderScrapePopdown();
  });

  es.addEventListener('error', e => {
    try {
      const { message } = JSON.parse(e.data);
      refreshInProgress = false;
      hideGridOverlay();
      setStrip('outdated', `Scrape error: ${message}`);
    } catch (_) {}
    es.close(); currentSSE = null;
  });

  es.onerror = () => {
    refreshInProgress = false;
    hideGridOverlay();
    if (lastScrapedAt) updateStripText();
    es.close(); currentSSE = null;
  };
}

// ── Scrape Popdown ────────────────────────────────────────────────────────────
function renderScrapePopdown() {
  const content = document.getElementById('scrapePopdownContent');
  if (!content) return;
  const entries = Object.entries(storeProgress);
  if (entries.length === 0) { content.innerHTML = ''; return; }

  const doneCount = entries.filter(([, s]) => s.status !== 'pending').length;
  content.innerHTML =
    `<div class="sp-header">Scraping ${doneCount}/${entries.length} stores</div>` +
    entries.map(([, s]) => {
      const dotClass = s.status === 'done' ? 'done' : s.status === 'error' ? 'error' : 'pending';
      const countTxt = s.status === 'done'
        ? `<span class="sp-count">${s.count} deals</span>`
        : s.status === 'error'
        ? `<span class="sp-err" title="${escHtml(s.error || '')}">${escHtml((s.error || 'error').slice(0, 30))}</span>`
        : `<span class="sp-count" style="color:var(--text-muted)">pending…</span>`;
      return `<div class="sp-row"><div class="sp-dot ${dotClass}"></div><span class="sp-name">${escHtml(s.name || '')}</span>${countTxt}</div>`;
    }).join('');
}

function showScrapePopdown() {
  if (!refreshInProgress) return;
  clearTimeout(popdownHideTimer);
  renderScrapePopdown();
  const pd = document.getElementById('scrapePopdown');
  const strip = document.getElementById('refreshStrip');
  if (!pd || !strip) return;
  const rect = strip.getBoundingClientRect();
  pd.style.left = rect.left + 'px';
  pd.classList.add('visible');
}

function hideScrapePopdown() {
  popdownHideTimer = setTimeout(() => {
    const pd = document.getElementById('scrapePopdown');
    if (pd) pd.classList.remove('visible');
  }, 200);
}

// ── Data Loading ─────────────────────────────────────────────────────────────
function loadDeals(deals) {
  allDeals = deals || [];
  buildDynamicFilters();
  currentPage = 1;
  applyFiltersAndRender();
}

function buildDynamicFilters() {
  // Store pills — built from config (all enabled stores) so they appear even with 0 deals
  // Use storeKey as value (reliable) and store name as label (display)
  const storePills = document.getElementById('storePills');
  storePills.innerHTML = makePill('store', 'all', 'All', true);
  const configStores = config?.stores
    ? Object.entries(config.stores).filter(([, s]) => s.enabled).map(([key, s]) => ({ key, name: s.name })).sort((a, b) => a.name.localeCompare(b.name))
    : [...new Set(allDeals.map(d => ({ key: d.storeKey || d.store, name: d.store })))];
  for (const { key, name } of configStores) storePills.insertAdjacentHTML('beforeend', makePill('store', key, name));

  // Category pills
  const GENDER_TAGS = new Set(['Men', 'Women', 'Unisex', 'Kids']);
  const cats = [...new Set(allDeals.flatMap(d => d.tags).filter(t => !GENDER_TAGS.has(t)))].sort();
  const catPills = document.getElementById('categoryPills');
  catPills.innerHTML = makePill('category', 'all', 'All', true);
  for (const c of cats) catPills.insertAdjacentHTML('beforeend', makePill('category', c, c));

  // Dynamic price range pills — use CAD price for consistency
  const cadPrice = d => (d.currency === 'USD' && d.priceCAD) ? d.priceCAD : d.price;
  const PRICE_BREAKS = [25, 50, 100, 200, 500];
  const pricePills = document.getElementById('pricePills');
  pricePills.innerHTML = makePill('price', 'all', 'Any', true);
  let prev = 0;
  for (const bp of PRICE_BREAKS) {
    const count = allDeals.filter(d => cadPrice(d) > prev && cadPrice(d) <= bp).length;
    if (count > 0) {
      const label = prev === 0 ? `Under $${bp}` : `$${prev}–$${bp}`;
      pricePills.insertAdjacentHTML('beforeend', makePill('price', `${prev}-${bp}`, label));
    }
    prev = bp;
  }
  const above = allDeals.filter(d => cadPrice(d) > prev).length;
  if (above > 0) pricePills.insertAdjacentHTML('beforeend', makePill('price', `${prev}-99999`, `$${prev}+`));

  // Dynamic discount pills — only show thresholds where deals exist
  const DISC_STEPS = [10, 20, 30, 40, 50, 60, 70];
  const discPills = document.getElementById('discountPills');
  discPills.innerHTML = makePill('discount', '0', 'Any', true);
  for (const t of DISC_STEPS) {
    if (allDeals.some(d => d.discount >= t)) {
      discPills.insertAdjacentHTML('beforeend', makePill('discount', String(t), `${t}%+`));
    }
  }

  // Re-sync active states (including gender which has static HTML pills)
  syncPillActive('store', filters.store);
  syncPillActive('gender', filters.gender);
  syncPillActive('category', filters.category);
  syncPillActive('price', filters.price);
  syncPillActive('discount', filters.discount);
  syncPillExcluded();
}

function makePill(filter, value, label, active = false) {
  const isExcluded = excludedFilters[filter]?.includes(value);
  const cls = `pill${active ? ' active' : ''}${isExcluded ? ' excluded' : ''}`;
  return `<div class="${cls}" data-filter="${filter}" data-value="${escHtml(value)}" onclick="togglePill(this, event)">${escHtml(label)}</div>`;
}

function syncPillActive(filter, value) {
  document.querySelectorAll(`[data-filter="${filter}"]`).forEach(p => {
    p.classList.toggle('active', p.dataset.value === value);
  });
}

function syncPillExcluded() {
  document.querySelectorAll('.pill.excluded').forEach(p => p.classList.remove('excluded'));
  for (const [filter, excluded] of Object.entries(excludedFilters)) {
    if (!excluded.length) continue;
    document.querySelectorAll(`[data-filter="${filter}"]`).forEach(p => {
      if (excluded.includes(p.dataset.value)) {
        p.classList.add('excluded');
        p.classList.remove('active');
      }
    });
  }
}

// ── Filtering & Sorting ───────────────────────────────────────────────────────
function applyFiltersAndRender() {
  let deals = [...allDeals];

  if (filters.store !== 'all') deals = deals.filter(d => (d.storeKey || d.store) === filters.store);
  if (filters.gender !== 'all') {
    const GENDER_TAGS = ['Men', 'Women', 'Kids'];
    deals = deals.filter(d => {
      if (filters.gender === 'Unisex') {
        // Unisex pill: truly Unisex items + items with no gender tag (unknown)
        return d.tags.includes('Unisex') || !GENDER_TAGS.some(g => d.tags.includes(g));
      }
      // Men/Women: include exact match + Unisex + no-gender-tag items (gender-neutral products)
      return d.tags.includes(filters.gender)
        || d.tags.includes('Unisex')
        || !GENDER_TAGS.some(g => d.tags.includes(g));
    });
  }
  if (filters.category !== 'all') deals = deals.filter(d => d.tags.includes(filters.category));
  if (filters.price !== 'all') {
    const [lo, hi] = filters.price.split('-').map(Number);
    // Use priceCAD for USD items so price filter works consistently in CAD
    deals = deals.filter(d => {
      const p = d.currency === 'USD' && d.priceCAD ? d.priceCAD : d.price;
      return p >= lo && p <= hi;
    });
  }
  const minDiscount = parseInt(filters.discount) || 0;
  if (minDiscount > 0) deals = deals.filter(d => d.discount >= minDiscount);

  // Apply exclusion filters (shift-clicked red pills)
  const cadP = d => (d.currency === 'USD' && d.priceCAD) ? d.priceCAD : d.price;
  const GENDER_TAGS_EX = ['Men', 'Women', 'Kids'];
  for (const [key, excluded] of Object.entries(excludedFilters)) {
    for (const val of excluded) {
      if (key === 'store')    deals = deals.filter(d => (d.storeKey || d.store) !== val);
      if (key === 'gender')   deals = deals.filter(d => val === 'Unisex'
        ? !(d.tags.includes('Unisex') || !GENDER_TAGS_EX.some(g => d.tags.includes(g)))
        : !d.tags.includes(val));
      if (key === 'category') deals = deals.filter(d => !d.tags.includes(val));
      if (key === 'price') {
        const [lo, hi] = val.split('-').map(Number);
        deals = deals.filter(d => { const p = cadP(d); return !(p >= lo && p <= (hi || Infinity)); });
      }
      if (key === 'discount') {
        const minD = parseInt(val) || 0;
        if (minD > 0) deals = deals.filter(d => d.discount < minD);
      }
    }
  }

  deals.sort((a, b) => {
    if (currentSort === 'discount') return b.discount - a.discount;
    if (currentSort === 'price-asc') return a.price - b.price;
    if (currentSort === 'price-desc') return b.price - a.price;
    if (currentSort === 'newest') return new Date(b.scrapedAt) - new Date(a.scrapedAt);
    return 0;
  });

  filteredDeals = deals;
  currentPage = 1;
  renderGrid();
  renderResultsBar();
  renderPagination();
  updatePillAvailability();
}

// Returns deals matching all active filters EXCEPT the given key (for availability check)
function dealsExcluding(excludeKey) {
  const cadPrice = d => (d.currency === 'USD' && d.priceCAD) ? d.priceCAD : d.price;
  let d = [...allDeals];
  if (excludeKey !== 'store'    && filters.store !== 'all')    d = d.filter(x => (x.storeKey || x.store) === filters.store);
  if (excludeKey !== 'gender' && filters.gender !== 'all') {
    const GENDER_TAGS = ['Men', 'Women', 'Kids'];
    d = d.filter(x => {
      if (filters.gender === 'Unisex') return x.tags.includes('Unisex') || !GENDER_TAGS.some(g => x.tags.includes(g));
      return x.tags.includes(filters.gender) || x.tags.includes('Unisex') || !GENDER_TAGS.some(g => x.tags.includes(g));
    });
  }
  if (excludeKey !== 'category' && filters.category !== 'all') d = d.filter(x => x.tags.includes(filters.category));
  if (excludeKey !== 'price'    && filters.price !== 'all') {
    const [lo, hi] = filters.price.split('-').map(Number);
    d = d.filter(x => { const p = cadPrice(x); return p >= lo && p <= hi; });
  }
  if (excludeKey !== 'discount') {
    const md = parseInt(filters.discount) || 0;
    if (md > 0) d = d.filter(x => x.discount >= md);
  }
  // Apply all exclusion filters
  const GENDER_TAGS_EX = ['Men', 'Women', 'Kids'];
  for (const [key, excluded] of Object.entries(excludedFilters)) {
    for (const val of excluded) {
      if (key === 'store')    d = d.filter(x => (x.storeKey || x.store) !== val);
      if (key === 'gender')   d = d.filter(x => val === 'Unisex'
        ? !(x.tags.includes('Unisex') || !GENDER_TAGS_EX.some(g => x.tags.includes(g)))
        : !x.tags.includes(val));
      if (key === 'category') d = d.filter(x => !x.tags.includes(val));
      if (key === 'price') {
        const [lo, hi] = val.split('-').map(Number);
        d = d.filter(x => { const p = cadPrice(x); return !(p >= lo && p <= (hi || Infinity)); });
      }
      if (key === 'discount') {
        const minD = parseInt(val) || 0;
        if (minD > 0) d = d.filter(x => x.discount < minD);
      }
    }
  }
  return d;
}

function updatePillAvailability() {
  // For each filter group, disable pills that would produce 0 results
  const cadPrice = d => (d.currency === 'USD' && d.priceCAD) ? d.priceCAD : d.price;

  const checks = {
    store:    (d, v) => (d.storeKey || d.store) === v,
    gender: (d, v) => {
      const GENDER_TAGS = ['Men', 'Women', 'Kids'];
      if (v === 'Unisex') return d.tags.includes('Unisex') || !GENDER_TAGS.some(g => d.tags.includes(g));
      return d.tags.includes(v) || d.tags.includes('Unisex') || !GENDER_TAGS.some(g => d.tags.includes(g));
    },
    category: (d, v) => d.tags.includes(v),
    price: (d, v) => {
      const [lo, hi] = v.split('-').map(Number);
      const p = cadPrice(d);
      return p >= lo && p <= hi;
    },
    discount: (d, v) => d.discount >= parseInt(v),
  };

  for (const filterKey of ['store', 'gender', 'category', 'price', 'discount']) {
    const base = dealsExcluding(filterKey);
    document.querySelectorAll(`[data-filter="${filterKey}"]`).forEach(pill => {
      const val = pill.dataset.value;
      // Never disable excluded pills — they must stay clickable to allow un-exclusion
      if (pill.classList.contains('excluded')) { pill.classList.remove('pill-disabled'); return; }
      if (val === 'all' || val === '0') { pill.classList.remove('pill-disabled'); return; }
      const hasDeals = base.some(d => checks[filterKey](d, val));
      pill.classList.toggle('pill-disabled', !hasDeals);
    });
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('grid');
  const empty = document.getElementById('emptyState');

  if (filteredDeals.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageDeals = filteredDeals.slice(start, start + PAGE_SIZE);

  grid.innerHTML = pageDeals.map((d, i) => {
    const isUSD = d.currency === 'USD';
    const displayPrice = isUSD && d.priceCAD ? d.priceCAD : d.price;
    const displayOrig = isUSD && d.originalPriceCAD ? d.originalPriceCAD : d.originalPrice;
    const priceLabel = isUSD
      ? `~$${displayPrice.toFixed(2)} <span class="price-cad-note">CAD</span>`
      : `$${displayPrice.toFixed(2)}`;
    const origLabel = isUSD
      ? `~$${displayOrig.toFixed(2)}`
      : `$${displayOrig.toFixed(2)}`;
    const usdNote = isUSD
      ? `<span class="usd-badge">USD $${d.price.toFixed(2)}</span>`
      : '';

    return `
    <a class="tile" href="${escHtml(d.url)}" target="_blank" rel="noopener"
       data-idx="${start + i}" style="animation-delay:${Math.min(i * 0.03, 0.3)}s">
      <div class="tile-img">
        ${d.image
          ? `<img src="${escHtml(d.image)}" alt="${escHtml(d.name)}" loading="lazy" onerror="this.parentNode.innerHTML='<span class=\\'img-fallback\\'>🛍️</span>'">`
          : `<span class="img-fallback">🛍️</span>`}
      </div>
      <div class="tile-body">
        <div class="tile-store">${escHtml(d.store)}${usdNote}</div>
        <div class="tile-name" title="${escHtml(d.name)}">${escHtml(d.name)}</div>
        <div class="tile-tags">${d.tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join('')}</div>
        <div class="tile-price-row">
          <span class="price-now">${priceLabel}</span>
          <span class="price-orig">${origLabel}</span>
          <span class="discount-badge">−${d.discount}%</span>
        </div>
      </div>
    </a>`;
  }).join('');
}

function renderResultsBar() {
  const total = filteredDeals.length;
  if (allDeals.length === 0) {
    document.getElementById('resultsCount').textContent = '';
    document.getElementById('activeFilters').innerHTML = '';
    return;
  }
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, total);
  let text = `${total} deal${total !== 1 ? 's' : ''}`;
  if (allDeals.length !== total) text += ` of ${allDeals.length}`;
  if (total > PAGE_SIZE) text += ` · showing ${start}–${end}`;
  document.getElementById('resultsCount').textContent = text;

  const chips = [];
  let hasActiveFilter = false;
  for (const [key, val] of Object.entries(filters)) {
    if (val === 'all' || val === '0') continue;
    hasActiveFilter = true;
    const label = key === 'price' ? `$${val.replace(/-99999$/, '+').replace('-', '–')}` : key === 'discount' ? `${val}%+` : val;
    chips.push(`<div class="active-tag">${escHtml(label)} <span class="active-tag-x" onclick="clearFilter('${key}')">×</span></div>`);
  }
  for (const [key, excluded] of Object.entries(excludedFilters)) {
    for (const val of excluded) {
      hasActiveFilter = true;
      const label = key === 'price' ? `$${val.replace(/-99999$/, '+').replace('-', '–')}` : key === 'discount' ? `${val}%+` : val;
      chips.push(`<div class="active-tag excluded-tag">not: ${escHtml(label)} <span class="active-tag-x" onclick="clearExcluded('${key}','${val}')">×</span></div>`);
    }
  }
  if (hasActiveFilter) {
    chips.push(`<div class="reset-btn" onclick="resetAllFilters()">Reset all</div>`);
  }
  document.getElementById('activeFilters').innerHTML = chips.join('');
}

function resetAllFilters() {
  Object.assign(filters, FILTER_DEFAULTS);
  for (const k of Object.keys(excludedFilters)) excludedFilters[k] = [];
  ['store', 'gender', 'category', 'price', 'discount'].forEach(k => syncPillActive(k, filters[k]));
  syncPillExcluded();
  currentPage = 1;
  saveFilters();
  applyFiltersAndRender();
}

function renderPagination() {
  const total = filteredDeals.length;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pg = document.getElementById('pagination');

  if (pageCount <= 1) { pg.innerHTML = ''; return; }

  const prevDis = currentPage === 1 ? ' disabled' : '';
  const nextDis = currentPage === pageCount ? ' disabled' : '';
  let html = `<button class="pg-btn"${prevDis} onclick="goPage(${currentPage - 1})">← Prev</button>`;
  html += `<span class="pg-info">Page ${currentPage} of ${pageCount}</span>`;

  // Up to 5 page number buttons around current page
  const lo = Math.max(1, currentPage - 2);
  const hi = Math.min(pageCount, currentPage + 2);
  if (lo > 1) html += `<button class="pg-btn" onclick="goPage(1)">1</button>${lo > 2 ? '<span class="pg-info">…</span>' : ''}`;
  for (let p = lo; p <= hi; p++) {
    html += `<button class="pg-btn${p === currentPage ? ' active' : ''}" onclick="goPage(${p})">${p}</button>`;
  }
  if (hi < pageCount) html += `${hi < pageCount - 1 ? '<span class="pg-info">…</span>' : ''}<button class="pg-btn" onclick="goPage(${pageCount})">${pageCount}</button>`;

  html += `<button class="pg-btn"${nextDis} onclick="goPage(${currentPage + 1})">Next →</button>`;
  pg.innerHTML = html;
}

function goPage(p) {
  currentPage = p;
  renderGrid();
  renderResultsBar();
  renderPagination();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showSkeletons(n) {
  const grid = document.getElementById('grid');
  grid.innerHTML = Array.from({ length: n }, () => `
    <div class="tile tile-skel">
      <div class="tile-img skel-img skeleton"></div>
      <div class="tile-body">
        <div class="skel-line skeleton med"></div>
        <div class="skel-line skeleton short" style="margin-top:4px"></div>
        <div class="skel-line skeleton price"></div>
      </div>
    </div>
  `).join('');
}

function clearGrid() { document.getElementById('grid').innerHTML = ''; }

// ── Hover Preview ─────────────────────────────────────────────────────────────
// ── Settings Drawer ───────────────────────────────────────────────────────────
async function renderSettingsDrawer(cfg) {
  const body = document.getElementById('drawerBody');
  const stores = cfg.stores || {};
  const settings = cfg.settings || {};

  // Fetch last scrape status for per-store counts
  let status = {};
  try {
    const r = await fetch('/api/status');
    status = await r.json();
  } catch (_) {}

  const storeRows = Object.entries(stores).map(([key, s]) => {
    const sr = status.storeResults?.[key];
    const statusText = sr
      ? (sr.error ? `⚠ ${sr.error.slice(0, 40)}` : `${sr.count} deals`)
      : 'not scraped yet';
    const dotClass = sr ? (sr.error ? 'warn' : 'ok') : '';
    return `
    <div class="ds-row">
      <div class="ds-row-text">
        <div class="ds-name">${escHtml(s.name)}</div>
        <div class="ds-sub"><span class="store-status"><span class="status-dot ${dotClass}"></span>${escHtml(statusText)}</span></div>
      </div>
      <div class="toggle ${s.enabled ? 'on' : ''}" onclick="toggleStore('${key}', this)"></div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="ds-section">
      <div class="ds-label">Active Stores</div>
      ${storeRows}
    </div>
    <div class="ds-section">
      <div class="ds-label">Behaviour</div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Auto-refresh on launch</div>
          <div class="ds-sub">Scrape all enabled stores on startup</div>
        </div>
        <div class="toggle ${settings.autoRefreshOnLaunch !== false ? 'on' : ''}" onclick="toggleSetting('autoRefreshOnLaunch', this)"></div>
      </div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Show % off badges</div>
          <div class="ds-sub">Display discount percentage on tiles</div>
        </div>
        <div class="toggle ${settings.showDiscountBadges !== false ? 'on' : ''}" onclick="toggleSetting('showDiscountBadges', this)"></div>
      </div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Auto-convert USD to CAD</div>
          <div class="ds-sub">Show ~CAD price for USD stores${status.usdToCAD ? ` · Rate: 1 USD = ${status.usdToCAD.toFixed(4)} CAD` : ''}</div>
        </div>
        <div class="toggle ${settings.autoCurrencyConvert !== false ? 'on' : ''}" onclick="toggleSetting('autoCurrencyConvert', this)"></div>
      </div>
    </div>
    <div class="ds-section">
      <div class="ds-label">Global Filters</div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Min. discount threshold</div>
          <div class="ds-sub">Hide items below this % off (applied at scrape time)</div>
        </div>
        <div class="stepper">
          <div class="stepper-btn" onclick="stepSetting('minDiscountPercent', -10)">−</div>
          <div class="stepper-val" id="discountStepVal">${settings.minDiscountPercent || 0}%</div>
          <div class="stepper-btn" onclick="stepSetting('minDiscountPercent', 10)">+</div>
        </div>
      </div>
    </div>
    <div class="ds-section">
      <div class="ds-label">Scheduling</div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Auto-scrape interval</div>
          <div class="ds-sub">Automatically refresh deals while app is running</div>
        </div>
        <div class="stepper">
          <div class="stepper-btn" onclick="stepSetting('refreshIntervalHours', -1)">−</div>
          <div class="stepper-val" id="intervalStepVal" style="min-width:48px">${settings.refreshIntervalHours || 6}h</div>
          <div class="stepper-btn" onclick="stepSetting('refreshIntervalHours', 1)">+</div>
        </div>
      </div>
    </div>
  `;
}

async function toggleStore(key, el) {
  el.classList.toggle('on');
  const enabled = el.classList.contains('on');
  await patchConfig({ stores: { [key]: { enabled } } });
  if (config?.stores?.[key]) config.stores[key].enabled = enabled;
}

async function toggleSetting(key, el) {
  el.classList.toggle('on');
  const value = el.classList.contains('on');
  await patchConfig({ settings: { [key]: value } });
  if (config?.settings) config.settings[key] = value;
}

async function stepSetting(key, delta) {
  if (!config) return;
  const current = config.settings?.[key] ?? 0;
  let next;
  if (key === 'minDiscountPercent') {
    next = Math.max(0, Math.min(70, current + delta));
    const el = document.getElementById('discountStepVal');
    if (el) el.textContent = `${next}%`;
  } else if (key === 'refreshIntervalHours') {
    next = Math.max(1, Math.min(168, current + delta));
    const el = document.getElementById('intervalStepVal');
    if (el) el.textContent = `${next}h`;
  } else {
    next = current + delta;
  }
  config.settings[key] = next;
  await patchConfig({ settings: { [key]: next } });
}

async function patchConfig(patch) {
  try {
    await fetch('/api/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch (_) {}
}

// ── Controls ─────────────────────────────────────────────────────────────────
function changeGrid(d) {
  cols = Math.max(1, Math.min(8, cols + d));
  applyGridSize();
  localStorage.setItem('gridCols', cols);
}

function applyGridSize() {
  const minW = TILE_WIDTHS[cols] || 220;
  document.getElementById('grid').style.setProperty('--tile-min', `${minW}px`);
  document.getElementById('gsVal').textContent = cols;
}

function setSort(el) {
  document.querySelectorAll('.sort-row').forEach(r => r.classList.remove('active'));
  el.classList.add('active');
  currentSort = el.dataset.sort;
  currentPage = 1;
  applyFiltersAndRender();
}

function togglePill(el, event) {
  if (el.classList.contains('pill-disabled')) return;
  const group = el.closest('.pill-group');
  const filterKey = el.dataset.filter;
  const value = el.dataset.value;

  // Shift-click: toggle exclusion (turn red)
  if (event && event.shiftKey) {
    if (value === 'all' || value === '0') return; // Can't exclude "all"
    const excluded = excludedFilters[filterKey];
    const idx = excluded.indexOf(value);
    if (idx >= 0) {
      excluded.splice(idx, 1); // Remove exclusion
    } else {
      excluded.push(value); // Add exclusion
      // Remove include filter if same value was active
      if (filters[filterKey] === value) {
        filters[filterKey] = filterKey === 'discount' ? '0' : 'all';
        group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
        const allPill = group.querySelector('[data-value="all"], [data-value="0"]');
        if (allPill) allPill.classList.add('active');
      }
    }
    currentPage = 1;
    saveFilters();
    applyFiltersAndRender();
    syncPillExcluded();
    return;
  }

  // Normal click: include filter
  // Remove any exclusion for this value if it was excluded
  const excIdx = excludedFilters[filterKey]?.indexOf(value);
  if (excIdx >= 0) excludedFilters[filterKey].splice(excIdx, 1);

  group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));

  if (value === 'all' || value === '0') {
    el.classList.add('active');
    filters[filterKey] = filterKey === 'discount' ? '0' : 'all';
  } else {
    const allPill = group.querySelector('[data-value="all"], [data-value="0"]');
    if (allPill) allPill.classList.remove('active');
    el.classList.add('active');
    filters[filterKey] = value;
  }
  currentPage = 1;
  saveFilters();
  applyFiltersAndRender();
  syncPillExcluded();
}

function clearFilter(key) {
  filters[key] = key === 'discount' ? '0' : 'all';
  syncPillActive(key, filters[key]);
  currentPage = 1;
  saveFilters();
  applyFiltersAndRender();
}

function clearExcluded(key, val) {
  if (!excludedFilters[key]) return;
  const idx = excludedFilters[key].indexOf(val);
  if (idx >= 0) excludedFilters[key].splice(idx, 1);
  syncPillExcluded();
  currentPage = 1;
  saveFilters();
  applyFiltersAndRender();
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function toggleDrawer() {
  document.getElementById('drawer').classList.contains('open') ? closeDrawer() : openDrawer();
}
function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('overlay').classList.add('open');
  document.getElementById('menuBtn').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('menuBtn').classList.remove('open');
}

// ── Dark mode ─────────────────────────────────────────────────────────────────
function toggleDark() {
  document.documentElement.classList.toggle('dark');
  localStorage.setItem('darkMode', document.documentElement.classList.contains('dark'));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
