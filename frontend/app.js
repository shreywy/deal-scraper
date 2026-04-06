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

const FILTER_DEFAULTS = {
  store: [],      // [] = show all stores
  gender: [],     // [] = show all genders
  category: [],   // [] = show all categories
  priceMin: 0,
  priceMax: 500,  // 500 means "no upper limit"
  discount: 0     // 0 means "any"
};

// Migration helper: convert old string format to new array/number format
function migrateFilterValue(key, value) {
  if (key === 'store' || key === 'gender' || key === 'category') {
    if (Array.isArray(value)) return value;
    if (!value || value === 'all') return [];
    return [value]; // single value string → single-item array
  }
  if (key === 'price') {
    // Old format was 'all' or '0-100' string, now we have priceMin/priceMax
    return undefined; // Will be handled separately
  }
  if (key === 'discount') {
    if (typeof value === 'number') return value;
    return parseInt(value) || 0;
  }
  return value;
}

const filters = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('dealFilters') || 'null');
    if (!saved) return { ...FILTER_DEFAULTS };

    // Migrate old format to new
    const migrated = { ...FILTER_DEFAULTS };
    for (const key of ['store', 'gender', 'category']) {
      if (saved[key] !== undefined) {
        migrated[key] = migrateFilterValue(key, saved[key]);
      }
    }
    // Handle old price format
    if (saved.price && saved.price !== 'all') {
      const parts = saved.price.split('-').map(Number);
      if (parts.length === 2) {
        migrated.priceMin = parts[0];
        migrated.priceMax = parts[1] === 99999 ? 500 : parts[1];
      }
    } else if (saved.priceMin !== undefined && saved.priceMax !== undefined) {
      migrated.priceMin = saved.priceMin;
      migrated.priceMax = saved.priceMax;
    }
    // Handle discount
    if (saved.discount !== undefined) {
      migrated.discount = migrateFilterValue('discount', saved.discount);
    }
    return migrated;
  } catch (_) { return { ...FILTER_DEFAULTS }; }
})();

const EXCLUDE_KEYS = ['store', 'gender', 'category'];
const excludedFilters = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem('dealFiltersExcluded') || 'null');
    const base = { store: [], gender: [], category: [] };
    if (saved) EXCLUDE_KEYS.forEach(k => { if (Array.isArray(saved[k])) base[k] = saved[k]; });
    return base;
  } catch (_) { return { store: [], gender: [], category: [] }; }
})();

function saveFilters() {
  try {
    localStorage.setItem('dealFilters', JSON.stringify(filters));
    localStorage.setItem('dealFiltersExcluded', JSON.stringify(excludedFilters));
  } catch (_) {}
}

// Tabs
let currentTab = 'clothing'; // 'clothing' | 'non-clothing'

// Drawer tabs
let drawerTab = 'clothing'; // 'clothing' | 'non-clothing'

// Non-clothing category navigation state
let selectedNcCategory = ''; // empty = all categories

// Pagination
const PAGE_SIZE = 100;
let currentPage = 1;

// Search
let searchQuery = '';
let searchDebounce = null;
let searchIsFuzzy = false;

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


// ── Fuzzy Search Helpers ─────────────────────────────────────────────────────
// Levenshtein distance for fuzzy string matching
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// Check if a query word fuzzy-matches any word in a target string
function fuzzyMatchWord(queryWord, targetStr) {
  if (queryWord.length < 3) return false; // don't fuzzy match very short words
  const maxDist = queryWord.length <= 4 ? 1 : 2; // 1 typo for short words, 2 for longer
  const words = targetStr.toLowerCase().split(/\s+/);
  return words.some(w => {
    if (Math.abs(w.length - queryWord.length) > maxDist) return false;
    return levenshtein(queryWord, w) <= maxDist;
  });
}

// Compute fuzzy score for a deal
function fuzzyScore(deal, queryWords) {
  const name = (deal.name || '').toLowerCase();
  const store = (deal.store || '').toLowerCase();
  const tags = (deal.tags || []).join(' ').toLowerCase();

  // All query words must fuzzy-match somewhere
  const allMatch = queryWords.every(qw =>
    name.includes(qw) || fuzzyMatchWord(qw, name) ||
    store.includes(qw) || fuzzyMatchWord(qw, store) ||
    tags.includes(qw) || fuzzyMatchWord(qw, tags)
  );
  if (!allMatch) return 0;

  // Score by where the best match is
  const nameMatch = queryWords.some(qw => name.includes(qw) || fuzzyMatchWord(qw, name));
  const storeMatch = queryWords.some(qw => store.includes(qw) || fuzzyMatchWord(qw, store));
  return nameMatch ? 2 : storeMatch ? 1 : 0; // lower than exact (exact = 3,2,1)
}


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

  // Initialize sliders
  initSliders();

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

// ── Non-Clothing Category Navigation ─────────────────────────────────────────
const NC_CATEGORY_MAP = {
  'Electronics': { icon: '⚡', label: 'Electronics' },
  'Computers': { icon: '💻', label: 'Computers' },
  'TVs & Displays': { icon: '📺', label: 'TVs & Displays' },
  'Phones & Tablets': { icon: '📱', label: 'Phones & Tablets' },
  'Audio': { icon: '🔊', label: 'Audio' },
  'Cameras': { icon: '📷', label: 'Cameras' },
  'Gaming': { icon: '🎮', label: 'Gaming' },
  'Appliances': { icon: '🏠', label: 'Appliances' },
  'Furniture': { icon: '🛋️', label: 'Furniture' },
  'Computer Parts': { icon: '💾', label: 'PC Parts' },
  'Toys & Games': { icon: '🧸', label: 'Toys & Games' },
  'Books & Toys': { icon: '🧸', label: 'Toys & Games' }, // lego.js compatibility
  'Books & Media': { icon: '📚', label: 'Books & Media' },
  'Beauty & Health': { icon: '💄', label: 'Beauty & Health' },
  'Fitness': { icon: '💪', label: 'Fitness' },
  'Tools & Home Improvement': { icon: '🔧', label: 'Tools & Home' },
  'Kitchen': { icon: '🍳', label: 'Kitchen' },
  'Home & Furniture': { icon: '🛋️', label: 'Furniture' }, // legacy compat
  'Tools': { icon: '🔧', label: 'Tools' }, // legacy compat
};

function buildNcCategoryNav(deals) {
  const navContainer = document.getElementById('ncCategoryNav');
  const scrollContainer = document.getElementById('ncCategoryScroll');

  if (!navContainer || !scrollContainer) return;

  // Count deals per category
  const categoryCounts = {};
  deals.forEach(d => {
    d.tags.forEach(tag => {
      if (NC_CATEGORY_MAP[tag]) {
        categoryCounts[tag] = (categoryCounts[tag] || 0) + 1;
      }
    });
  });

  // Build category tiles (only show categories with deals)
  const tiles = [];

  // "All" tile
  const allCount = deals.length;
  const allActive = selectedNcCategory === '';
  tiles.push(`
    <div class="nc-cat-tile ${allActive ? 'active' : ''}" onclick="selectNcCategory('')">
      <span class="nc-cat-icon">🌿</span>
      <span>All</span>
      <span class="nc-cat-count">${allCount}</span>
    </div>
  `);

  // Category tiles (sorted by deal count descending, then alphabetically)
  const categories = Object.keys(categoryCounts).sort((a, b) => categoryCounts[b] - categoryCounts[a] || a.localeCompare(b));
  for (const cat of categories) {
    const { icon, label } = NC_CATEGORY_MAP[cat];
    const count = categoryCounts[cat];
    const isActive = selectedNcCategory === cat;
    tiles.push(`
      <div class="nc-cat-tile ${isActive ? 'active' : ''}" onclick="selectNcCategory('${escHtml(cat)}')">
        <span class="nc-cat-icon">${icon}</span>
        <span>${escHtml(label)}</span>
        <span class="nc-cat-count">${count}</span>
      </div>
    `);
  }

  scrollContainer.innerHTML = tiles.join('');
}

function selectNcCategory(cat) {
  // Toggle category: clicking the active category deselects it
  if (selectedNcCategory === cat) {
    selectedNcCategory = '';
    filters.category = [];
  } else {
    selectedNcCategory = cat;
    filters.category = cat ? [cat] : [];
  }

  // Sync sidebar category pills
  syncPillActive('category', filters.category);

  currentPage = 1;
  saveFilters();
  applyFiltersAndRender();
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tabClothing')?.classList.toggle('active', tab === 'clothing');
  document.getElementById('tabNonClothing')?.classList.toggle('active', tab === 'non-clothing');

  // Show/hide non-clothing category nav
  const navContainer = document.getElementById('ncCategoryNav');
  if (navContainer) {
    navContainer.style.display = tab === 'non-clothing' ? 'block' : 'none';
  }

  // Reset category + store filters when switching tabs to avoid cross-tab bleed
  filters.category = [];
  filters.store = [];
  selectedNcCategory = '';

  currentPage = 1;
  updateSidebarForTab(tab);
  applyFiltersAndRender();
}

function updateSidebarForTab(tab) {
  const genderSection = document.getElementById('filterGender');

  if (tab === 'non-clothing') {
    // Hide gender filter
    if (genderSection) genderSection.classList.add('nc-hide');

    // Sync selectedNcCategory with current filters
    if (filters.category.length === 1) {
      selectedNcCategory = filters.category[0];
    } else {
      selectedNcCategory = '';
    }

    // Rebuild category pills for non-clothing
    const NC_CATEGORIES = ['Electronics', 'Computers', 'TVs & Displays', 'Phones & Tablets', 'Audio', 'Gaming', 'Cameras', 'Appliances', 'Furniture', 'Computer Parts', 'Toys & Games', 'Books & Toys', 'Books & Media', 'Kitchen', 'Fitness', 'Tools & Home Improvement', 'Beauty & Health', 'Home & Furniture', 'Tools'];
    const ncDeals = allDeals.filter(d => d.tags.includes('Non-Clothing'));
    const availableCats = NC_CATEGORIES.filter(cat =>
      ncDeals.some(d => d.tags.includes(cat))
    );

    const catPills = document.getElementById('categoryPills');
    catPills.innerHTML = makePill('category', 'all', 'All', filters.category.length === 0);
    for (const c of availableCats) {
      catPills.insertAdjacentHTML('beforeend', makePill('category', c, c, filters.category.includes(c)));
    }

    // Rebuild store pills to show only non-clothing stores
    if (config?.stores) {
      const ncStores = Object.entries(config.stores)
        .filter(([key, s]) => s.enabled && s.category === 'non-clothing')
        .map(([key, s]) => ({ key, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const storePills = document.getElementById('storePills');
      storePills.innerHTML = makePill('store', 'all', 'All', filters.store.length === 0);
      for (const { key, name } of ncStores) {
        storePills.insertAdjacentHTML('beforeend', makePill('store', key, name, filters.store.includes(key)));
      }
    }

    // Build category nav with all non-clothing deals
    buildNcCategoryNav(ncDeals);
  } else {
    // Restore clothing tab
    if (genderSection) genderSection.classList.remove('nc-hide');
    buildDynamicFilters(); // Rebuild normal filters
  }

  syncPillExcluded();
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
    ? Object.entries(config.stores)
        .filter(([, s]) => s.enabled && s.category !== 'non-clothing')
        .map(([key, s]) => ({ key, name: s.name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [...new Set(allDeals.map(d => ({ key: d.storeKey || d.store, name: d.store })))];
  for (const { key, name } of configStores) storePills.insertAdjacentHTML('beforeend', makePill('store', key, name));

  // Category pills — filter out Non-Clothing and gender tags
  const GENDER_TAGS = new Set(['Men', 'Women', 'Unisex', 'Kids']);
  const clothingDeals = allDeals.filter(d => !d.tags.includes('Non-Clothing'));
  const cats = [...new Set(clothingDeals.flatMap(d => d.tags).filter(t => !GENDER_TAGS.has(t) && t !== 'Non-Clothing'))].sort();
  const catPills = document.getElementById('categoryPills');
  catPills.innerHTML = makePill('category', 'all', 'All', true);
  for (const c of cats) catPills.insertAdjacentHTML('beforeend', makePill('category', c, c));

  // Re-sync active states (including gender which has static HTML pills)
  syncPillActive('store', filters.store);
  syncPillActive('gender', filters.gender);
  syncPillActive('category', filters.category);
  syncPillExcluded();
}

function makePill(filter, value, label, active = false) {
  const isExcluded = excludedFilters[filter]?.includes(value);
  const cls = `pill${active ? ' active' : ''}${isExcluded ? ' excluded' : ''}`;
  return `<div class="${cls}" data-filter="${filter}" data-value="${escHtml(value)}" onclick="togglePill(this, event)">${escHtml(label)}</div>`;
}

function syncPillActive(filter, value) {
  // For multi-select (array values), mark all pills whose value is in the array as active
  if (Array.isArray(value)) {
    document.querySelectorAll(`[data-filter="${filter}"]`).forEach(p => {
      const isAll = p.dataset.value === 'all';
      const isInArray = value.includes(p.dataset.value);
      p.classList.toggle('active', isAll ? value.length === 0 : isInArray);
    });
  } else {
    // For single-select (string/number values) - backwards compatibility
    document.querySelectorAll(`[data-filter="${filter}"]`).forEach(p => {
      p.classList.toggle('active', p.dataset.value === String(value));
    });
  }
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
  // Update non-clothing tab badge
  const nonClothingCount = allDeals.filter(d => d.tags.includes('Non-Clothing')).length;
  const badge = document.getElementById('nonClothingCount');
  if (badge) badge.textContent = nonClothingCount > 0 ? `(${nonClothingCount})` : '';

  // Tab split: clothing tab hides Non-Clothing items; non-clothing tab shows only them
  let deals = allDeals.filter(d =>
    currentTab === 'non-clothing' ? d.tags.includes('Non-Clothing') : !d.tags.includes('Non-Clothing')
  );

  // Filter out deals from disabled stores
  if (config?.stores) {
    const enabledKeys = new Set(Object.entries(config.stores).filter(([,s]) => s.enabled).map(([k]) => k));
    deals = deals.filter(d => enabledKeys.has(d.storeKey));
  }

  // For non-clothing tab: apply store, category, price, discount filters (but not gender)
  if (currentTab === 'non-clothing') {
    // Multi-select filters (store and category)
    if (filters.store.length > 0) {
      deals = deals.filter(d => filters.store.includes(d.storeKey || d.store));
    }
    if (filters.category.length > 0) {
      deals = deals.filter(d => filters.category.some(c => d.tags.includes(c)));
    }

    // Slider filters
    if (filters.priceMin > 0 || filters.priceMax < 500) {
      deals = deals.filter(d => {
        const p = d.currency === 'USD' && d.priceCAD ? d.priceCAD : d.price;
        return p >= filters.priceMin && (filters.priceMax >= 500 ? true : p <= filters.priceMax);
      });
    }
    if (filters.discount > 0) {
      deals = deals.filter(d => d.discount >= filters.discount);
    }

    // Apply exclusion filters for non-clothing tab
    const cadP = d => (d.currency === 'USD' && d.priceCAD) ? d.priceCAD : d.price;
    for (const [key, excluded] of Object.entries(excludedFilters)) {
      for (const val of excluded) {
        if (key === 'store')    deals = deals.filter(d => (d.storeKey || d.store) !== val);
        if (key === 'category') deals = deals.filter(d => !d.tags.includes(val));
      }
    }

    // Search filter with relevance scoring
    if (searchQuery) {
      const queryWords = searchQuery.split(/\s+/).filter(w => w.length > 0);

      // First try exact matching
      let scored = deals.map(d => {
        let score = 0;
        const name = d.name.toLowerCase();
        const store = (d.storeKey || d.store).toLowerCase();
        const tags = d.tags.map(t => t.toLowerCase());

        if (queryWords.every(w => name.includes(w))) {
          score = 3; // Product name match (highest priority)
        } else if (queryWords.every(w => store.includes(w))) {
          score = 2; // Store name match
        } else if (queryWords.every(w => tags.some(tag => tag.includes(w)))) {
          score = 1; // Tag match (lowest priority)
        }

        return { ...d, _searchScore: score };
      }).filter(d => d._searchScore > 0);

      // If no exact results, try fuzzy matching
      if (scored.length === 0) {
        scored = deals.map(d => ({ ...d, _searchScore: fuzzyScore(d, queryWords) }))
                      .filter(d => d._searchScore > 0);
        searchIsFuzzy = true;
      } else {
        searchIsFuzzy = false;
      }

      deals = scored;

      // Sort by relevance when search is active
      deals.sort((a, b) => b._searchScore - a._searchScore);
    } else {
      searchIsFuzzy = false;
      // Normal sort order when no search query
      deals.sort((a, b) => {
        if (currentSort === 'discount') return b.discount - a.discount;
        if (currentSort === 'price-asc') return a.price - b.price;
        if (currentSort === 'price-desc') return b.price - a.price;
        if (currentSort === 'newest') return new Date(b.scrapedAt) - new Date(a.scrapedAt);
        return 0;
      });
    }

    filteredDeals = deals;
    currentPage = 1;
    renderGrid();
    renderResultsBar();
    renderPagination();
    updatePillAvailability();

    // Rebuild non-clothing category nav with filtered deals (before any category filter is applied)
    const ncDealsBeforeCategoryFilter = allDeals
      .filter(d => d.tags.includes('Non-Clothing'))
      .filter(d => config?.stores ? Object.entries(config.stores).filter(([,s]) => s.enabled).map(([k]) => k).includes(d.storeKey) : true)
      .filter(d => filters.store.length > 0 ? filters.store.includes(d.storeKey || d.store) : true)
      .filter(d => {
        if (filters.priceMin > 0 || filters.priceMax < 500) {
          const p = d.currency === 'USD' && d.priceCAD ? d.priceCAD : d.price;
          return p >= filters.priceMin && (filters.priceMax >= 500 ? true : p <= filters.priceMax);
        }
        return true;
      })
      .filter(d => filters.discount > 0 ? d.discount >= filters.discount : true);
    buildNcCategoryNav(ncDealsBeforeCategoryFilter);
    return;
  }

  // Kids filter — hide Kids items by default unless explicitly selected
  const showKids = filters.gender.includes('Kids');
  if (!showKids) {
    deals = deals.filter(d => !d.tags.includes('Kids'));
  }

  // Multi-select filters (OR logic)
  if (filters.store.length > 0) {
    deals = deals.filter(d => filters.store.includes(d.storeKey || d.store));
  }
  if (filters.gender.length > 0) {
    const GENDER_TAGS = ['Men', 'Women', 'Kids'];
    deals = deals.filter(d => filters.gender.some(g => {
      if (g === 'Unisex') {
        // Strict: only show items explicitly tagged Unisex (not "no-gender" items which may include kids)
        return d.tags.includes('Unisex');
      }
      return d.tags.includes(g) || d.tags.includes('Unisex') || !GENDER_TAGS.some(gt => d.tags.includes(gt));
    }));
  }
  if (filters.category.length > 0) {
    deals = deals.filter(d => filters.category.some(c => d.tags.includes(c)));
  }

  // Slider filters
  if (filters.priceMin > 0 || filters.priceMax < 500) {
    deals = deals.filter(d => {
      const p = d.currency === 'USD' && d.priceCAD ? d.priceCAD : d.price;
      return p >= filters.priceMin && (filters.priceMax >= 500 ? true : p <= filters.priceMax);
    });
  }
  if (filters.discount > 0) {
    deals = deals.filter(d => d.discount >= filters.discount);
  }

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

  // Search filter with relevance scoring
  if (searchQuery) {
    const queryWords = searchQuery.split(/\s+/).filter(w => w.length > 0);

    // First try exact matching
    let scored = deals.map(d => {
      let score = 0;
      const name = d.name.toLowerCase();
      const store = (d.storeKey || d.store).toLowerCase();
      const tags = d.tags.map(t => t.toLowerCase());

      if (queryWords.every(w => name.includes(w))) {
        score = 3; // Product name match (highest priority)
      } else if (queryWords.every(w => store.includes(w))) {
        score = 2; // Store name match
      } else if (queryWords.every(w => tags.some(tag => tag.includes(w)))) {
        score = 1; // Tag match (lowest priority)
      }

      return { ...d, _searchScore: score };
    }).filter(d => d._searchScore > 0);

    // If no exact results, try fuzzy matching
    if (scored.length === 0) {
      scored = deals.map(d => ({ ...d, _searchScore: fuzzyScore(d, queryWords) }))
                    .filter(d => d._searchScore > 0);
      searchIsFuzzy = true;
    } else {
      searchIsFuzzy = false;
    }

    deals = scored;

    // Sort by relevance when search is active
    deals.sort((a, b) => b._searchScore - a._searchScore);
  } else {
    searchIsFuzzy = false;
    // Normal sort order when no search query
    deals.sort((a, b) => {
      if (currentSort === 'discount') return b.discount - a.discount;
      if (currentSort === 'price-asc') return a.price - b.price;
      if (currentSort === 'price-desc') return b.price - a.price;
      if (currentSort === 'newest') return new Date(b.scrapedAt) - new Date(a.scrapedAt);
      return 0;
    });
  }

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
  let d = currentTab === 'non-clothing'
    ? allDeals.filter(x => x.tags.includes('Non-Clothing'))
    : allDeals.filter(x => !x.tags.includes('Non-Clothing'));

  // Filter out disabled stores
  if (config?.stores) {
    const enabledKeys = new Set(Object.entries(config.stores).filter(([,s]) => s.enabled).map(([k]) => k));
    d = d.filter(x => enabledKeys.has(x.storeKey));
  }

  // Multi-select filters
  if (excludeKey !== 'store' && filters.store.length > 0) {
    d = d.filter(x => filters.store.includes(x.storeKey || x.store));
  }
  // Gender filter only applies on clothing tab
  if (currentTab !== 'non-clothing' && excludeKey !== 'gender' && filters.gender.length > 0) {
    const GENDER_TAGS = ['Men', 'Women', 'Kids'];
    d = d.filter(x => filters.gender.some(g => {
      if (g === 'Unisex') return x.tags.includes('Unisex'); // strict: no "no-gender" fallback
      return x.tags.includes(g) || x.tags.includes('Unisex') || !GENDER_TAGS.some(gt => x.tags.includes(gt));
    }));
  }
  if (excludeKey !== 'category' && filters.category.length > 0) {
    d = d.filter(x => filters.category.some(c => x.tags.includes(c)));
  }

  // Slider filters (no exclusion for sliders)
  if (filters.priceMin > 0 || filters.priceMax < 500) {
    d = d.filter(x => {
      const p = cadPrice(x);
      return p >= filters.priceMin && (filters.priceMax >= 500 ? true : p <= filters.priceMax);
    });
  }
  if (filters.discount > 0) {
    d = d.filter(x => x.discount >= filters.discount);
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
  };

  // On non-clothing tab, only update store and category (not gender)
  const filtersToCheck = currentTab === 'non-clothing' ? ['store', 'category'] : ['store', 'gender', 'category'];

  for (const filterKey of filtersToCheck) {
    const base = dealsExcluding(filterKey);
    document.querySelectorAll(`[data-filter="${filterKey}"]`).forEach(pill => {
      const val = pill.dataset.value;
      // Never disable excluded pills — check state directly (class may not be set yet)
      if (excludedFilters[filterKey]?.includes(val)) { pill.classList.remove('pill-disabled'); return; }
      if (val === 'all') { pill.classList.remove('pill-disabled'); return; }
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
  if (currentTab === 'non-clothing') {
    text += ' <span style="font-size:11px;color:var(--text-muted)">(electronics & more)</span>';
  }
  if (allDeals.length !== total) text += ` of ${allDeals.length}`;
  if (total > PAGE_SIZE) text += ` · showing ${start}–${end}`;

  // Add fuzzy search indicator
  if (searchIsFuzzy && searchQuery) {
    text += ` <span class="fuzzy-note">(fuzzy match)</span>`;
  }

  document.getElementById('resultsCount').innerHTML = text;

  const chips = [];
  let hasActiveFilter = false;

  // Show multi-select filters
  for (const key of ['store', 'gender', 'category']) {
    const values = filters[key];
    if (values && values.length > 0) {
      hasActiveFilter = true;
      let displayValues = values;
      // For stores, look up display names
      if (key === 'store' && config?.stores) {
        displayValues = values.map(v => config.stores[v]?.name || v);
      }
      const label = `${key.charAt(0).toUpperCase() + key.slice(1)}: ${displayValues.join(', ')}`;
      chips.push(`<div class="active-tag">${escHtml(label)} <span class="active-tag-x" onclick="clearFilter('${key}')">×</span></div>`);
    }
  }

  // Show slider filters
  if (filters.priceMin > 0 || filters.priceMax < 500) {
    hasActiveFilter = true;
    const lo = filters.priceMin;
    const hi = filters.priceMax >= 500 ? '500+' : filters.priceMax;
    chips.push(`<div class="active-tag">Price: $${lo}–$${hi} <span class="active-tag-x" onclick="clearFilter('price')">×</span></div>`);
  }
  if (filters.discount > 0) {
    hasActiveFilter = true;
    chips.push(`<div class="active-tag">Discount: ${filters.discount}%+ <span class="active-tag-x" onclick="clearFilter('discount')">×</span></div>`);
  }

  // Show exclusion filters
  for (const [key, excluded] of Object.entries(excludedFilters)) {
    for (const val of excluded) {
      hasActiveFilter = true;
      let label = val;
      if (key === 'store' && config?.stores) {
        label = config.stores[val]?.name || val;
      }
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
  ['store', 'gender', 'category'].forEach(k => syncPillActive(k, filters[k]));
  syncPillExcluded();
  updateSliders();
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
// ── Drawer Tab Control ───────────────────────────────────────────────────────
function setDrawerTab(tab) {
  drawerTab = tab;
  document.querySelectorAll('.drawer-tab-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.tab === tab);
  });
  // Show/hide rows based on category
  document.querySelectorAll('.ds-row[data-store-category]').forEach(row => {
    const cat = row.dataset.storeCategory || 'clothing';
    row.style.display = (tab === 'clothing' && cat === 'clothing') || (tab === 'non-clothing' && cat === 'non-clothing') ? '' : 'none';
  });
}

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

  // Detect broken stores: disabled + note with block/bot/redirect keywords
  const BROKEN_KW = ['block', 'bot', 'redirect', 'akamai', 'perimeterx', 'cloudflare', 'denied', '404', 'broken'];
  function isBroken(s) {
    if (s.enabled) return false;
    const note = (s.note || '').toLowerCase();
    return BROKEN_KW.some(kw => note.includes(kw));
  }

  const storeRows = Object.entries(stores).map(([key, s]) => {
    const sr = status.storeResults?.[key];
    const statusText = sr
      ? (sr.error ? `⚠ ${sr.error.slice(0, 40)}` : `${sr.count} deals`)
      : (s.note ? s.note.slice(0, 55) : 'not scraped yet');
    const dotClass = sr ? (sr.error ? 'warn' : 'ok') : '';
    const broken = isBroken(s);
    const category = s.category || 'clothing';
    return `
    <div class="ds-row${broken ? ' ds-row-broken' : ''}" data-store-name="${escHtml(s.name.toLowerCase())}" data-store-category="${category}">
      <div class="ds-row-text">
        <div class="ds-name">${escHtml(s.name)}${broken ? ' <span class="ds-broken-badge">broken</span>' : ''}</div>
        <div class="ds-sub"><span class="store-status"><span class="status-dot ${dotClass}"></span>${escHtml(statusText)}</span></div>
      </div>
      <div class="toggle ${s.enabled ? 'on' : ''}" onclick="toggleStore('${key}', this)"></div>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="drawer-tab-bar">
      <button class="drawer-tab-pill active" data-tab="clothing" onclick="setDrawerTab('clothing')">Clothing Stores</button>
      <button class="drawer-tab-pill" data-tab="non-clothing" onclick="setDrawerTab('non-clothing')">Electronics & More</button>
    </div>
    <div class="ds-section">
      <div class="ds-label">Active Stores</div>
      <div class="ds-store-search-wrap">
        <input class="ds-store-search" type="text" placeholder="Filter stores…" oninput="filterDrawerStores(this.value)" autocomplete="off">
      </div>
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
    <div class="ds-section">
      <div class="ds-label">Data</div>
      <div class="ds-row">
        <div class="ds-row-text">
          <div class="ds-name">Clear deal cache</div>
          <div class="ds-sub">⚠ Deletes all cached deals — next launch will re-scrape from scratch</div>
        </div>
        <button class="ds-danger-btn" onclick="clearCache()">Clear</button>
      </div>
    </div>
  `;

  // Initialize drawer tab visibility
  setDrawerTab(drawerTab);
}

async function clearCache() {
  const confirmed = window.confirm(
    'Clear all cached deals?\n\nThis deletes the local deals.json file. The grid will be empty until you run a new scrape (click ↻ in the top bar).'
  );
  if (!confirmed) return;
  try {
    const r = await fetch('/api/cache', { method: 'DELETE' });
    if (!r.ok) throw new Error('Server error');
    allDeals = [];
    filteredDeals = [];
    clearGrid();
    setStrip('cached', 'Cache cleared — click ↻ to scrape');
    closeDrawer();
  } catch (_) {
    alert('Failed to clear cache.');
  }
}

function filterDrawerStores(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#drawerBody .ds-row[data-store-name]').forEach(row => {
    const matchesSearch = !q || row.dataset.storeName.includes(q);
    const cat = row.dataset.storeCategory || 'clothing';
    const matchesTab = (drawerTab === 'clothing' && cat === 'clothing') || (drawerTab === 'non-clothing' && cat === 'non-clothing');
    row.style.display = (matchesSearch && matchesTab) ? '' : 'none';
  });
}

async function toggleStore(key, el) {
  el.classList.toggle('on');
  const enabled = el.classList.contains('on');
  await patchConfig({ stores: { [key]: { enabled } } });
  if (config?.stores?.[key]) config.stores[key].enabled = enabled;
  buildDynamicFilters(); // update store pills
  applyFiltersAndRender(); // update grid
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

function onSearchInput() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    searchQuery = document.getElementById('searchInput').value.trim().toLowerCase();
    document.getElementById('searchClear').classList.toggle('visible', searchQuery.length > 0);
    currentPage = 1;
    applyFiltersAndRender();
  }, 200);
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  searchQuery = '';
  document.getElementById('searchClear').classList.remove('visible');
  currentPage = 1;
  applyFiltersAndRender();
}

function togglePill(el, event) {
  if (el.classList.contains('pill-disabled')) return;
  const group = el.closest('.pill-group');
  const filterKey = el.dataset.filter;
  const value = el.dataset.value;

  // Determine if this is a multi-select filter
  const isMultiSelect = ['store', 'gender', 'category'].includes(filterKey);

  // Shift-click: toggle exclusion (turn red)
  if (event && event.shiftKey) {
    if (value === 'all') return; // Can't exclude "all"
    const excluded = excludedFilters[filterKey];
    if (!excluded) return; // Only multi-select filters have exclusions now
    const idx = excluded.indexOf(value);
    if (idx >= 0) {
      excluded.splice(idx, 1); // Remove exclusion
    } else {
      excluded.push(value); // Add exclusion
      // Remove from include filter if same value was active
      if (isMultiSelect && filters[filterKey].includes(value)) {
        filters[filterKey] = filters[filterKey].filter(v => v !== value);
        syncPillActive(filterKey, filters[filterKey]);
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
  if (isMultiSelect) {
    const excIdx = excludedFilters[filterKey]?.indexOf(value);
    if (excIdx >= 0) excludedFilters[filterKey].splice(excIdx, 1);

    if (value === 'all') {
      // Clicking "All" clears the array
      filters[filterKey] = [];
      syncPillActive(filterKey, filters[filterKey]);
    } else {
      // Multi-select logic
      const arr = filters[filterKey];
      const idx = arr.indexOf(value);
      if (idx >= 0) {
        // Already active - deselect it
        arr.splice(idx, 1);
      } else {
        // Not active - select it
        arr.push(value);
      }
      syncPillActive(filterKey, filters[filterKey]);
    }
  } else {
    // Single-select for other filters (if any remain) - not used currently
    group.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
    el.classList.add('active');
    filters[filterKey] = value;
  }

  // Sync with non-clothing category nav if on non-clothing tab and clicking category
  if (currentTab === 'non-clothing' && filterKey === 'category') {
    if (value === 'all') {
      selectedNcCategory = '';
    } else if (filters.category.length === 1 && filters.category[0] === value) {
      // Single category selected - sync selectedNcCategory
      selectedNcCategory = value;
    } else if (filters.category.length === 0) {
      // No categories - reset selectedNcCategory
      selectedNcCategory = '';
    } else {
      // Multiple categories - clear selectedNcCategory (nav shows "All" active)
      selectedNcCategory = '';
    }
  }

  currentPage = 1;
  saveFilters();
  applyFiltersAndRender();
  if (isMultiSelect) syncPillExcluded();
}

function clearFilter(key) {
  // Handle multi-select filters
  if (key === 'store' || key === 'gender' || key === 'category') {
    filters[key] = [];
    syncPillActive(key, filters[key]);
  }
  // Handle slider filters
  else if (key === 'price') {
    filters.priceMin = 0;
    filters.priceMax = 500;
    updateSliders();
  }
  else if (key === 'discount') {
    filters.discount = 0;
    updateSliders();
  }
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

// ── Sliders ───────────────────────────────────────────────────────────────────
// Calculate thumb left-% accounting for browser thumb-radius inset
function thumbLeft(val, min, max, trackEl) {
  const pct = (val - min) / (max - min);
  const trackW = (trackEl && trackEl.offsetWidth) || 192;
  const thumbR = 8; // half of 16px thumb
  return ((pct * (trackW - 2 * thumbR) + thumbR) / trackW) * 100;
}

function setTooltip(id, text, leftPct) {
  const el = document.getElementById(id);
  if (el) { el.textContent = text; el.style.left = leftPct + '%'; }
}

function setFill(fillId, leftPct, widthPct) {
  const el = document.getElementById(fillId);
  if (el) { el.style.left = leftPct + '%'; el.style.width = widthPct + '%'; }
}

function initSliders() {
  const priceMin = document.getElementById('priceMin');
  const priceMax = document.getElementById('priceMax');
  const discountSlider = document.getElementById('discountSlider');
  const priceTrack = document.getElementById('priceSlider');
  const discTrack = document.getElementById('discountSliderWrap');

  function updatePriceSlider() {
    const lo = parseInt(priceMin.value);
    const hi = parseInt(priceMax.value);
    if (lo > hi) { priceMin.value = hi; return updatePriceSlider(); }
    filters.priceMin = lo;
    filters.priceMax = hi;
    document.getElementById('priceSliderVals').textContent =
      `$${lo} – ${hi >= 500 ? '$500+' : '$' + hi}`;
    setFill('priceSliderFill', (lo / 500) * 100, ((hi - lo) / 500) * 100);
    setTooltip('priceMinTip', `$${lo}`, thumbLeft(lo, 0, 500, priceTrack));
    setTooltip('priceMaxTip', hi >= 500 ? '$500+' : `$${hi}`, thumbLeft(hi, 0, 500, priceTrack));
    currentPage = 1;
    saveFilters();
    applyFiltersAndRender();
  }

  function updateDiscountSlider() {
    const val = parseInt(discountSlider.value);
    filters.discount = val;
    document.getElementById('discountSliderVal').textContent = val === 0 ? 'Any' : val + '%+';
    setFill('discountSliderFill', 0, (val / 90) * 100);
    setTooltip('discountTip', val === 0 ? '0%' : val + '%', thumbLeft(val, 0, 90, discTrack));
    currentPage = 1;
    saveFilters();
    applyFiltersAndRender();
  }

  if (priceMin && priceMax) {
    priceMin.value = filters.priceMin;
    priceMax.value = filters.priceMax;
    updatePriceSlider();
    priceMin.addEventListener('input', updatePriceSlider);
    priceMax.addEventListener('input', updatePriceSlider);
  }

  if (discountSlider) {
    discountSlider.value = filters.discount;
    updateDiscountSlider();
    discountSlider.addEventListener('input', updateDiscountSlider);
  }
}

// Helper to update slider UI (called from clearFilter and resetAllFilters)
function updateSliders() {
  const priceMin = document.getElementById('priceMin');
  const priceMax = document.getElementById('priceMax');
  const discountSlider = document.getElementById('discountSlider');
  const priceTrack = document.getElementById('priceSlider');
  const discTrack = document.getElementById('discountSliderWrap');

  if (priceMin && priceMax) {
    priceMin.value = filters.priceMin;
    priceMax.value = filters.priceMax;
    const lo = filters.priceMin, hi = filters.priceMax;
    document.getElementById('priceSliderVals').textContent =
      `$${lo} – ${hi >= 500 ? '$500+' : '$' + hi}`;
    setFill('priceSliderFill', (lo / 500) * 100, ((hi - lo) / 500) * 100);
    setTooltip('priceMinTip', `$${lo}`, thumbLeft(lo, 0, 500, priceTrack));
    setTooltip('priceMaxTip', hi >= 500 ? '$500+' : `$${hi}`, thumbLeft(hi, 0, 500, priceTrack));
  }

  if (discountSlider) {
    discountSlider.value = filters.discount;
    const val = filters.discount;
    document.getElementById('discountSliderVal').textContent = val === 0 ? 'Any' : val + '%+';
    setFill('discountSliderFill', 0, (val / 90) * 100);
    setTooltip('discountTip', val === 0 ? '0%' : val + '%', thumbLeft(val, 0, 90, discTrack));
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
