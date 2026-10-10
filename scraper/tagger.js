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
  'tent ', ' tent', 'sleeping bag', 'camp stove', 'camping stove', 'camp chair', 'camping chair',
  'tarp ', ' tarp', 'ground sheet', 'hammock', 'camp table',
  'lantern', 'headlamp', 'flashlight', 'torch ',
  // Water sports equipment
  'kayak', 'canoe', 'paddleboard', 'stand-up paddle', 'sup board',
  'life jacket', 'pfd ', ' pfd', 'paddle ', ' paddle',
  // Winter sports equipment
  'ski ', ' ski', 'skis', 'snowboard', 'ski boot', 'ski binding', 'ski pole',
  // Bike & cycle equipment
  'bicycle', 'bike frame', 'bike wheel', 'handlebar', 'derailleur', 'bike pedal', 'bike chain',
  // Team & ball sports equipment
  'hockey stick', 'hockey puck', 'skate blade', 'lacrosse stick',
  'tennis racket', 'racquet', 'golf club', 'golf ball', 'golf tee',
  'baseball bat', 'baseball glove', 'softball', 'volleyball', 'basketball', 'soccer ball', 'football',
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
  { tag: 'Women', keywords: ['women', 'woman', 'womens', 'ladies', 'female', "w's"] },
  { tag: 'Men',   keywords: ['men', 'man', 'mens', 'male', "m's"] },
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
  const norm = s => s.toLowerCase().replace(/[‘’]/g, "'");
  const haystack = norm([name, description, category].join(' '));
  // "Short Sleeve Tee" is a top, not shorts
  const catHaystack = norm([name, category].join(' ')).replace(/short[- ]sleeve/g, 'shirt');
  const tags = new Set();

  const cats = CATEGORY_MAP.filter(({ keywords }) => keywords.some(k => has(catHaystack, k))).map(c => c.tag);

  // Equipment keywords only win when nothing clothing-like matched ("Ski Jacket" stays a jacket)
  if (!cats.length && NON_CLOTHING_KEYWORDS.some(k => has(haystack, k.toLowerCase()))) {
    return ['Non-Clothing'];
  }

  const genderOf = hay => GENDER_MAP.find(({ keywords }) => keywords.some(k => has(hay, k)))?.tag;
  const g = (gender && genderOf(norm(gender))) || (gender && has(norm(gender), 'unisex') && 'Unisex') || genderOf(haystack);
  if (g) tags.add(g);
  // Untagged gender is fine — the frontend treats "Unisex" as "truly unisex + unknown gender".

  cats.forEach(c => tags.add(c));
  return [...tags];
}

module.exports = { tag };
