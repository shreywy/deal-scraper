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
  const catHaystack = norm([name, category].join(' ')).replace(/short[- ]sleeve/g, 'shirt');
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

// Category for items from non-clothing stores (keys match the frontend's NC_CATEGORY_MAP)
function ncTag(name = '') {
  const t = name.toLowerCase();
  if (/laptop|notebook|chromebook|desktop|workstation|mini pc/.test(t)) return 'Computers';
  if (/\bmonitor\b|\btv\b|television|oled|qled/.test(t)) return 'TVs & Displays';
  if (/\bphone\b|\btablet\b|\bipad\b|iphone/.test(t)) return 'Phones & Tablets';
  if (/headphone|earphone|earbud|\bspeaker\b|soundbar/.test(t)) return 'Audio';
  if (/\bcamera\b|mirrorless|dslr/.test(t)) return 'Cameras';
  if (/gaming|console|\bxbox\b|playstation|\bps5\b|nintendo|controller/.test(t)) return 'Gaming';
  if (/washer|dryer|fridge|refrigerator|dishwasher|microwave|\boven\b|\bstove\b|\brange\b|vacuum|air purifier|coffee maker|blender|toaster|freezer|cooktop/.test(t)) return 'Appliances';
  if (/drill|\bsaw\b|wrench|hammer|screwdriver|power tool|toolbox/.test(t)) return 'Tools & Home Improvement';
  if (/cookware|\bpot\b|\bpan\b|\bknife\b|bakeware|dinnerware/.test(t)) return 'Kitchen';
  return 'Furniture'; // the remaining non-clothing stores are furniture/home retailers
}

module.exports = { tag, genderOf, ncTag };
