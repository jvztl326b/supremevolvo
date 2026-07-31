const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { parse } = require('node-html-parser');

const CATEGORIES = {
  godlies: 'https://supremevalues.com/mm2/godlies',
  chromas: 'https://supremevalues.com/mm2/chromas',
  ancients: 'https://supremevalues.com/mm2/ancients',
  uniques: 'https://supremevalues.com/mm2/uniques',
  vintages: 'https://supremevalues.com/mm2/vintages',
};

// 🔥 Cache that auto‑expires after 10 minutes
let cache = {
  data: null,
  timestamp: 0,
};
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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

// Launch browser with retries
async function launchBrowser(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
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
      return browser;
    } catch (error) {
      console.log(`[Launch] Attempt ${attempt} failed: ${error.message}`);
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function scrapeCategory(page, name, url) {
  console.log(`[${name}] Loading...`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.itemcolumn', { timeout: 5000 }).catch(() => {});

    const html = await page.content();
    console.log(`[${name}] HTML length: ${html.length}`);

    if (html.length < 500) {
      console.log(`[${name}] Empty or too short`);
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
  } catch (error) {
    console.error(`[${name}] Error:`, error.message);
    return { regular: {}, chroma: {} };
  }
}

// Main scraping function – uses a single browser with multiple pages
async function scrapeAll() {
  let browser;
  try {
    console.log('🔄 Scraping fresh data...');
    browser = await launchBrowser();

    const pages = await Promise.all(
      Object.entries(CATEGORIES).map(async ([name, url]) => {
        const page = await browser.newPage();
        return { name, url, page };
      })
    );

    const scrapePromises = pages.map(({ name, url, page }) =>
      scrapeCategory(page, name, url)
    );
    const results = await Promise.all(scrapePromises);

    // Close pages and browser
    for (const { page } of pages) await page.close().catch(() => {});
    await browser.close();

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
  } catch (error) {
    console.error('Scrape error:', error);
    if (browser) await browser.close().catch(() => {});
    throw error;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const now = Date.now();

  // 🔥 If cache is older than 10 minutes, refresh it
  if (!cache.data || (now - cache.timestamp) > CACHE_TTL) {
    console.log('⏰ Cache expired – scraping fresh...');
    try {
      cache.data = await scrapeAll();
      cache.timestamp = now;
      console.log('✅ Cache updated');
    } catch (error) {
      console.error('Scrape failed:', error);
      // If we have old cache, serve it even if expired
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
