'use strict';

// Keyword maps for auto-tagging product names → normalized category tags
const CATEGORY_MAP = [
  { tag: 'T-Shirts',    keywords: ['t-shirt', 'tshirt', 'tee', ' tee ', 'graphic tee', 'crew neck', 'crewneck'] },
  { tag: 'Shorts',      keywords: ['short', 'shorts'] },
  { tag: 'Jackets',     keywords: ['jacket', 'parka', 'anorak', 'windbreaker', 'wind breaker', 'vest', 'gilet'] },
  { tag: 'Hoodies',     keywords: ['hoodie', 'hoody', 'sweatshirt', 'fleece', 'pullover'] },
  { tag: 'Outerwear',   keywords: ['coat', 'overcoat', 'trench', 'puffer', 'down jacket', 'rain jacket'] },
  { tag: 'Dresses',     keywords: ['dress', 'gown', 'midi', 'maxi dress', 'mini dress'] },
  { tag: 'Skirts',      keywords: ['skirt'] },
  { tag: 'Pants',       keywords: ['pant', 'pants', 'jean', 'jeans', 'trouser', 'trousers', 'chino', 'legging', 'jogger', 'sweatpant'] },
  { tag: 'Tops',        keywords: ['blouse', 'top ', 'tops', 'tunic', 'tank', 'cami', 'crop', 'polo', 'henley', 'shirt'] },
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

// Women must come before Men — 'mens' is a substring of 'womens', and 'male' of 'female'.
// Checking Women first ensures "womens shorts" → Women, not Men.
// Kids includes all age groups: toddlers, grade school, little kids, big kids, etc.
const GENDER_MAP = [
  { tag: 'Women', keywords: ['women\'s', 'womens', ' women ', 'female', 'ladies', 'w\'s ', ' w\'s'] },
  { tag: 'Men',   keywords: ['men\'s', 'mens', ' men ', 'male', 'm\'s ', ' m\'s'] },
  { tag: 'Kids',  keywords: [
    'kids', 'children', 'toddler', 'infant', 'baby', 'youth',
    'grade school', 'little kids', 'big kids', 'preschool',
    ' gs ', ' ps ', ' td ', ' bg ', ' lg ', ' gg ',
    'junior ', ' boys ', ' girls ', ' boy ', ' girl ',
  ]},
];

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
  const haystack = [name, description, category].join(' ').toLowerCase();
  const tags = new Set();

  // Non-clothing check — if matched, return early with just Non-Clothing tag
  if (NON_CLOTHING_KEYWORDS.some(k => haystack.includes(k.toLowerCase()))) {
    return ['Non-Clothing'];
  }

  // Gender
  if (gender) {
    const g = gender.toLowerCase();
    if (g.includes('men') && !g.includes('women')) tags.add('Men');
    else if (g.includes('women') || g.includes('woman')) tags.add('Women');
    else if (g.includes('unisex')) tags.add('Unisex');
    else if (
      g.includes('kid') || g.includes('child') || g.includes('boy') || g.includes('girl') ||
      g.includes('youth') || g.includes('infant') || g.includes('toddler') ||
      g.includes('grade school') || g.includes('little kid') || g.includes('big kid') ||
      g.includes('preschool') || g.includes('junior')
    ) {
      tags.add('Kids');
    }
  }

  if (tags.size === 0) {
    for (const { tag: t, keywords } of GENDER_MAP) {
      if (keywords.some(k => haystack.includes(k))) {
        tags.add(t);
        break;
      }
    }
  }

  // Don't default to Unisex — leave items with no gender hint untagged.
  // The frontend treats "Unisex" filter as "truly unisex + unknown gender".

  // Category — can match multiple
  const catHaystack = [name, category].join(' ').toLowerCase();
  for (const { tag: t, keywords } of CATEGORY_MAP) {
    if (keywords.some(k => catHaystack.includes(k))) {
      tags.add(t);
    }
  }

  return [...tags];
}

module.exports = { tag };
