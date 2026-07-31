const { parse } = require('node-html-parser');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const CATEGORIES = {
  godlies: 'https://supremevalues.com/mm2/godlies',
  chromas: 'https://supremevalues.com/mm2/chromas',
  ancients: 'https://supremevalues.com/mm2/ancients',
  uniques: 'https://supremevalues.com/mm2/uniques',
  vintages: 'https://supremevalues.com/mm2/vintages',
  legendaries: 'https://supremevalues.com/mm2/legendaries',
  rares: 'https://supremevalues.com/mm2/rares',
  uncommons: 'https://supremevalues.com/mm2/uncommons',
  pets: 'https://supremevalues.com/mm2/pets',
};

// Cache 10 minutes
let cache = { data: null, timestamp: 0 };
const CACHE_TTL = 10 * 60 * 1000;

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

// ---------- Fetch HTML using multiple strategies ----------
async function fetchHTML(url) {
  // Strategy 1: Direct fetch with real browser headers
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });
    if (response.ok) {
      const html = await response.text();
      if (html.length > 500) {
        console.log(`[fetch] Direct OK: ${html.length} bytes`);
        return html;
      }
    }
  } catch (e) {
    console.log(`[fetch] Direct failed: ${e.message}`);
  }

  // Strategy 2: Free CORS proxy (allorigins.win)
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    const response = await fetch(proxyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (response.ok) {
      const html = await response.text();
      if (html.length > 500) {
        console.log(`[fetch] Proxy OK: ${html.length} bytes`);
        return html;
      }
    }
  } catch (e) {
    console.log(`[fetch] Proxy failed: ${e.message}`);
  }

  // Strategy 3: Puppeteer (headless browser) – last resort
  try {
    console.log(`[fetch] Falling back to Puppeteer for ${url}`);
    const executablePath = await chromium.executablePath();
    const execDir = executablePath.substring(0, executablePath.lastIndexOf('/'));
    process.env.LD_LIBRARY_PATH = `${execDir}:${process.env.LD_LIBRARY_PATH || ''}`;

    const browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
      timeout: 15000,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('.itemcolumn', { timeout: 5000 }).catch(() => {});
    const html = await page.content();
    await browser.close();

    if (html.length > 500) {
      console.log(`[fetch] Puppeteer OK: ${html.length} bytes`);
      return html;
    }
  } catch (e) {
    console.log(`[fetch] Puppeteer failed: ${e.message}`);
  }

  return null; // all failed
}

async function scrapeCategory(name, url) {
  console.log(`[${name}] Starting...`);

  const html = await fetchHTML(url);
  if (!html) {
    console.log(`[${name}] No HTML fetched`);
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

async function scrapeAll() {
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

  return {
    regular: mergedRegular,
    chroma: mergedChroma,
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const now = Date.now();

  if (!cache.data || (now - cache.timestamp) > CACHE_TTL) {
    console.log('⏰ Cache expired – scraping fresh...');
    try {
      cache.data = await scrapeAll();
      cache.timestamp = now;
      console.log('✅ Cache updated');
    } catch (error) {
      console.error('Scrape failed:', error);
      if (cache.data) {
        console.log('⚠️ Serving stale cache due to error');
        return res.status(200).json(cache.data);
      }
      return res.status(500).json({ error: error.message });
    }
  } else {
    console.log(`✅ Serving cached data (${Math.round((now - cache.timestamp) / 1000 / 60)} minutes old)`);
  }

  res.status(200).json(cache.data);
};
