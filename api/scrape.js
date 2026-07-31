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
  console.log(`[${name}] Launching browser...`);

  let browser;
  try {
    const executablePath = await chromium.executablePath();

    // 🔥 FIX: Set library path so Chromium can find system libs
    const execDir = executablePath.substring(0, executablePath.lastIndexOf('/'));
    process.env.LD_LIBRARY_PATH = `${execDir}:${process.env.LD_LIBRARY_PATH || ''}`;

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
      timeout: 15000,
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });

    const html = await page.content();
    await browser.close();

    console.log(`[${name}] HTML length: ${html.length}`);

    if (html.length < 500) {
      console.log(`[${name}] Empty or too short response`);
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
    if (browser) await browser.close();
    return { regular: {}, chroma: {} };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    console.log('🔄 Scraping fresh with Puppeteer...');
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

    console.log(`✅ TOTAL: ${Object.keys(mergedRegular).length} regular, ${Object.keys(mergedChroma).length} chroma`);
    res.status(200).json(finalData);
  } catch (error) {
    console.error('FATAL:', error);
    res.status(500).json({ error: error.message });
  }
};
