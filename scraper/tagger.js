'use strict';

// Keyword maps for auto-tagging product names → normalized category tags
const CATEGORY_MAP = [
  { tag: 'T-Shirts',    keywords: ['t-shirt', 'tshirt', 'tee', 'graphic tee', 'crew neck', 'crewneck'] },
  { tag: 'Shorts',      keywords: ['short', 'shorts'] },
  { tag: 'Jackets',     keywords: ['jacket', 'parka', 'anorak', 'windbreaker', 'wind breaker', 'vest', 'gilet'] },
  { tag: 'Hoodies',     keywords: ['hoodie', 'hoody', 'sweatshirt', 'fleece', 'pullover', 'sweater', 'cardigan', 'quarter zip', '1/4 zip', 'half zip', 'crew'] },
  { tag: 'Outerwear',   keywords: ['coat', 'overcoat', 'trench', 'puffer', 'down jacket', 'rain jacket'] },
  { tag: 'Dresses',     keywords: ['dress', 'gown', 'midi', 'maxi dress', 'mini dress'] },
  { tag: 'Skirts',      keywords: ['skirt'] },
  { tag: 'Pants',       keywords: ['pant', 'pants', 'jean', 'jeans', 'trouser', 'trousers', 'chino', 'legging', 'jogger', 'sweatpant'] },
  { tag: 'Tops',        keywords: ['blouse', 'top', 'tops', 'tunic', 'tank', 'cami', 'crop', 'polo', 'henley', 'shirt'] },
  { tag: 'Footwear',    keywords: ['shoe', 'shoes', 'sneaker', 'runner', 'trainer', 'boot', 'sandal', 'slide', 'loafer', 'oxford', 'mule', 'clog'] },
  { tag: 'Activewear',  keywords: ['sport', 'active', 'athletic', 'performance', 'training', 'running', 'gym', 'yoga', 'cycling', 'compression', 'hovr', 'rush', 'tech'] },
  { tag: 'Swimwear',    keywords: ['swim', 'bikini', 'board short', 'swimsuit', 'bathing'] },
  { tag: 'Underwear',   keywords: ['underwear', 'brief', 'briefs', 'boxer', 'bra', 'bralette', 'lingerie', 'thong', 'panty', 'sock', 'socks'] },
  { tag: 'Accessories', keywords: ['bag', 'tote', 'backpack', 'wallet', 'belt', 'hat', 'cap', 'beanie', 'glove', 'scarf', 'sunglasses', 'watch', 'jewelry', 'jewellery', 'necklace', 'bracelet', 'earring'] },
];

// Non-clothing items (Marks tools, MEC/SportChek equipment). Checked first — if matched,
// tagged Non-Clothing and no clothing categories are added.
const NON_CLOTHING_KEYWORDS = [
  // Hand tools & hardware
  'drill bit', 'bit set', 'hex key', 'allen key', 'socket set', 'ratchet', 'wrench', 'torque wrench',
  'screwdriver', 'pliers', 'cutter', 'tape measure', 'utility knife', 'level ',
  'caulk', 'fastener', 'rivet', 'staple', 'nail set', 'chisel', 'file set',
  // Power tools
  'drill ', 'power drill', 'circular saw', 'jig saw', 'band saw', 'reciprocating saw',
  'grinder', 'sander ', 'router ', 'impact driver', 'heat gun', 'work light',
  // Safety & PPE (non-apparel)
  'safety glasses', 'safety goggle', 'hard hat', 'bump cap', 'face shield',
  'ear plug', 'ear muff', 'respirator', 'dust mask',
  // Camping & outdoor gear
  'sleeping bag', 'camp stove', 'camping stove', 'camp chair', 'camping chair',
  'camping tent', 'dome tent', 'ground sheet', 'hammock', 'camp table',
  'lantern', 'headlamp', 'flashlight',
  // Water sports equipment
  'kayak', 'canoe', 'paddleboard', 'stand-up paddle', 'sup board',
  'life jacket', 'pfd ', ' pfd',
  // Winter sports equipment (equipment only — not ski/snowboard jackets, pants, base layers)
  'skis', 'ski boot', 'ski binding', 'ski pole', 'ski helmet', 'ski goggle',
  'snowboard boot', 'snowboard binding', 'snowboard helmet',
  // Bike & cycle equipment
  'bicycle', 'bike frame', 'bike wheel', 'handlebar', 'derailleur', 'bike pedal', 'bike chain',
  // Team & ball sports equipment
  'hockey stick', 'hockey puck', 'skate blade', 'lacrosse stick',
  'tennis racket', 'racquet', 'golf club', 'golf ball', 'golf tee',
  'baseball bat', 'baseball glove', 'soccer ball',
  // Note: 'football', 'basketball', 'volleyball', 'softball' removed — too broad,
  // matches clothing (jerseys, shorts). Helmets/pads cover sports-equipment detection.
  // Fitness equipment
  'dumbbell', 'barbell', 'kettlebell', 'weight plate', 'weight bench', 'pull-up bar', 'chin-up bar',
  'foam roller', 'yoga mat', 'resistance band', 'jump rope', 'battle rope',
  'treadmill', 'rowing machine', 'elliptical', 'stationary bike',
  // Helmets & hard protective gear
  'helmet', 'knee pad', 'shin guard', 'elbow pad', 'ankle brace', 'wrist guard',
  // Hydration & nutrition
  'water bottle', 'hydration bladder', 'hydration pack', 'thermos', 'insulated bottle',
  // Other
  'first aid', 'sunscreen', 'insect repel', 'luggage', 'suitcase',
  'phone case', 'headphone', 'earphone', 'earbuds', 'power bank',
  'cooking pot', 'camp cookware', 'cutlery set', 'eating utensil',
];

// Matched on word boundaries (see has()), so 'men' never matches 'women' and order doesn't matter.
const GENDER_MAP = [
  { tag: 'Women', keywords: ['women', 'woman', 'womens', 'ladies', 'female', "w's", 'for her'] },
  { tag: 'Men',   keywords: ['men', 'man', 'mens', 'male', "m's", 'for him'] },
  { tag: 'Kids',  keywords: [
    'kid', 'children', 'toddler', 'infant', 'baby', 'youth', 'junior', 'preschool',
    'grade school', 'boy', 'girl', 'gs', 'ps', 'td', 'bg', 'lg', 'gg',
  ]},
];

const escRe = s => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const reCache = new Map();
// Whole-word match allowing a plural/possessive suffix: 'short' matches "Shorts"/"Short's", 'bra' doesn't match "Brawler".
function has(hay, kw) {
  let re = reCache.get(kw);
  if (!re) reCache.set(kw, re = new RegExp(`(^|[^a-z])${escRe(kw)}(s|es)?('s?)?(?![a-z])`));
  return re.test(hay);
}

const norm = s => s.toLowerCase().replace(/[‘’]/g, "'");

// Kids wins ("Girls' Hoodie"); both Men and Women (e.g. store tags "mens, womens") means Unisex
function genderOf(text) {
  const hay = norm(text);
  const hits = GENDER_MAP.filter(({ keywords }) => keywords.some(k => has(hay, k))).map(m => m.tag);
  if (hits.includes('Kids')) return 'Kids'; // "Unisex Beanie for Toddler" is a kids' item
  if (has(hay, 'unisex') || has(hay, 'gender inclusive') || hits.length > 1) return 'Unisex';
  return hits[0];
}

/**
 * Given a product name, description, and optional store-provided category string,
 * returns an array of normalized string tags.
 *
 * @param {object} opts
 * @param {string} opts.name          Product name
 * @param {string} [opts.description] Product description (optional)
 * @param {string} [opts.category]    Store-provided category string (optional)
 * @param {string} [opts.gender]      Store-provided gender hint (optional)
 * @returns {string[]}
 */
function tag({ name = '', description = '', category = '', gender = '' } = {}) {
  const haystack = norm([name, description, category].join(' '));
  // "Short Sleeve Tee" is a top, not shorts
  const catHaystack = norm([name, category].join(' ')).replace(/short[- ]sleeve/g, 'shirt')
    .replace(/\bdress (shirt|pant|trouser|shoe|sock|boot)/g, '$1'); // "Dress Shirt" isn't a dress
  const tags = new Set();

  const cats = CATEGORY_MAP.filter(({ keywords }) => keywords.some(k => has(catHaystack, k))).map(c => c.tag);

  // Equipment keywords only win when nothing clothing-like matched ("Ski Jacket" stays a jacket)
  if (!cats.length && NON_CLOTHING_KEYWORDS.some(k => has(haystack, k.toLowerCase()))) {
    return ['Non-Clothing'];
  }

  // Name beats store hints ("Women's Tee" in a men's collection), hints beat descriptions/tags
  const g = genderOf(name) || (gender && genderOf(gender)) || genderOf(haystack);
  if (g) tags.add(g);
  // Untagged gender is fine — the frontend treats "Unisex" as "truly unisex + unknown gender".

  cats.forEach(c => tags.add(c));
  return [...tags];
}

// Category for items from non-clothing stores (keys match the frontend's NC_CATEGORY_MAP).
// `cat` is the store's own category text, if any. First match wins, so order matters.
function ncTag(name = '', cat = '', fallback = 'Electronics') {
  const t = `${name} ${cat}`.toLowerCase();
  if (/\btv (?:stand|unit|bench|cabinet)|media console|console table|entertainment cent(?:re|er)|book ?case/.test(t)) return 'Furniture';
  if (/laptop|notebook|ultrabook|chromebook|macbook|surface (?:pro|laptop)|galaxy book|thinkpad|ideapad|thinkbook|\blegion\b|\byoga (?:slim|pro|book|\d)|\bxps\b|inspiron|vostro|latitude/.test(t)) return 'Computers';
  if (/desktop|workstation|mini pc|all.in.one(?!.*(?:wash|laundry|print))|\bimac\b|mac mini|mac pro|mac studio|optiplex|thinkcentre|thinkstation/.test(t)) return 'Computers';
  if (/\bmonitor\b|\btv\b|television|oled|qled|4k display|studio display|thinkvision/.test(t)) return 'TVs & Displays';
  if (/\bphone\b|smartphone|iphone|\btablet\b|\bipad\b|galaxy (?:[sa]\d|z (?:fold|flip)|tab)/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|airpod|homepod|\bbeats\b|galaxy buds|\bspeakers?\b|soundbar|subwoofer/.test(t)) return 'Audio';
  if (/\bcamera\b|mirrorless|dslr|\bdrone\b/.test(t)) return 'Cameras';
  if (/gaming|console|\bxbox\b|playstation|\bps[45]\b|nintendo|controller|alienware|\bgpu\b|graphics card|geforce|radeon/.test(t)) return 'Gaming';
  if (/washer|dryer|fridge|refrigerator|freezer|dishwasher|microwave|\boven\b|\bstove\b|(?<!long[- ]|extreme )\brange\b|cooktop|vacuum|air purifier|air conditioner|humidifier|coffee (?:maker|machine)|espresso (?:machine|maker)|\bkettle\b|blender|toaster/.test(t)) return 'Appliances';
  if (/lego|\btoys?\b|action figure|\bdolls?\b|playset|puzzle|board game|card game|nerf|hot wheels/.test(t)) return 'Toys & Games';
  if (/\bprinter\b|\bscanner\b|\bkeyboard\b|(?<!minn?ie |plush )\bmouse\b|trackpad|apple pencil|webcam|\brouter\b|hard drive|\bssd\b|\bram\b|\bcpu\b|motherboard|\bpsu\b|power supply|cpu cooler/.test(t)) return 'Computer Parts';
  if (/\bbooks?\b|\bnovel\b|cookbook|memoir|biography|manga|textbook/.test(t)) return 'Books & Media';
  if (/skincare|shampoo|conditioner|moisturizer|serum|perfume|cologne|makeup|\bbeauty\b|haircare|vitamin|supplement/.test(t)) return 'Beauty & Health';
  if (/fitness|treadmill|dumbbell|kettlebell|yoga mat|exercise bike|elliptical/.test(t)) return 'Fitness';
  if (/\bsofa\b|\bcouch\b|\bchairs?\b|\bdesk\b|\btables?\b(?! saw)|shel(?:f|ves|ving)|bookcase|\bbed\b|mattress|\blamps?\b|\brugs?\b|wardrobe|dresser|nightstand|curtain|pillow|duvet/.test(t)) return 'Furniture';
  if (/drill|\bsaws?\b|wrench|\bhammers?\b|screwdriver|power tool|toolbox|\bladder\b|\bpaint\b/.test(t)) return 'Tools & Home Improvement';
  if (/cookware|\bpots?\b|\bpans?\b|\bknife\b|knives|cutting board|bakeware|dinnerware|utensil|spatula/.test(t)) return 'Kitchen';
  if (/\bdock\b|docking station/.test(t)) return 'Computer Parts';
  return fallback;
}

module.exports = { tag, genderOf, ncTag };
