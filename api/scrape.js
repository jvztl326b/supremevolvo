const { parse } = require('node-html-parser');

const CATEGORIES = {
  godlies: 'https://supremevalues.com/mm2/godlies',
  chromas: 'https://supremevalues.com/mm2/chromas',
  ancients: 'https://supremevalues.com/mm2/ancients',
  uniques: 'https://supremevalues.com/mm2/uniques',
  vintages: 'https://supremevalues.com/mm2/vintages', // optional
};

const SCRAPINGBEE_KEY = process.env.SCRAPINGBEE_API_KEY;

// ⏰ Cache TTL: 12 hours (43200000 ms)
let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12 hours

function extractValue(col) {
  let val = parseInt(col.getAttribute('data-value'));
  if (!isNaN(val) && val > 0) return val;

  const valEl = col.querySelector('.itemvalue');
  if (valEl) {
    const text = valEl.text.replace(/,/g, '').trim();
    const num = parseInt(text);
    if (!isNaN(num) && num > 0) return num;
  }

  const text = col.textContent;
  const matches = text.match(/\b(\d{1,6})\b/g);
  if (matches) {
    const nums = matches.map(Number).filter(n => n > 10);
    if (nums.length) return Math.max(...nums);
  }
  return null;
}

async function scrapeCategory(name, url) {
  console.log(`[${name}] Scraping with ScrapingBee...`);

  const targetUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_KEY}&url=${encodeURIComponent(url)}&render_js=true&premium_proxy=true&block_ads=true&timeout=15000`;

  const response = await fetch(targetUrl);
  if (!response.ok) {
    console.log(`[${name}] HTTP error ${response.status}`);
    return { regular: {}, chroma: {} };
  }

  const html = await response.text();
  console.log(`[${name}] HTML length: ${html.length}`);

  if (html.length < 500 || html.includes('Access Denied') || html.includes('Blocked')) {
    console.log(`[${name}] Blocked or empty response`);
    return { regular: {}, chroma: {} };
  }

  const root = parse(html);
  const regular = {};
  const chroma = {};
  const columns = root.querySelectorAll('.itemcolumn');
  console.log(`[${name}] Found ${columns.length} items`);

  columns.forEach(col => {
    const head = col.querySelector('.itemhead');
    if (!head) return;
    let nameTag = head.text.trim();
    const value = extractValue(col);
    if (!value || value <= 0) return;

    const classAttr = col.getAttribute('class') || '';
    const isChroma = classAttr.includes('chroma') ||
                     nameTag.toLowerCase().startsWith('chroma ') ||
                     nameTag.toLowerCase().startsWith('c. ');

    if (isChroma) {
      nameTag = nameTag.replace(/^(chroma|c\.)\s+/i, '').trim();
      chroma[nameTag] = value;
    } else {
      regular[nameTag] = value;
    }
  });

  console.log(`[${name}] Extracted ${Object.keys(regular).length + Object.keys(chroma).length} items`);
  return { regular, chroma };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!SCRAPINGBEE_KEY) {
    return res.status(500).json({ error: 'Missing SCRAPINGBEE_API_KEY environment variable' });
  }

  const now = Date.now();

  // 🔥 Force refresh if query parameter ?refresh=true is passed
  const forceRefresh = req.query.refresh === 'true';

  if (!forceRefresh && cache.data && (now - cache.timestamp) < CACHE_TTL) {
    console.log('✅ Serving from cache (last updated ' + new Date(cache.timestamp).toISOString() + ')');
    return res.status(200).json(cache.data);
  }

  try {
    console.log('🔄 Cache expired or force refresh – scraping fresh...');
    const tasks = Object.entries(CATEGORIES).map(([name, url]) =>
      scrapeCategory(name, url)
    );
    const results = await Promise.all(tasks);

    const mergedRegular = {};
    const mergedChroma = {};
    for (const result of results) {
      Object.assign(mergedRegular, result.regular);
      Object.assign(mergedChroma, result.chroma);
    }

    const finalData = {
      regular: mergedRegular,
      chroma: mergedChroma,
    };

    cache.data = finalData;
    cache.timestamp = now;

    console.log(`✅ TOTAL: ${Object.keys(mergedRegular).length} regular, ${Object.keys(mergedChroma).length} chroma`);
    res.status(200).json(finalData);
  } catch (error) {
    console.error('FATAL:', error);
    res.status(500).json({ error: error.message });
  }
};
