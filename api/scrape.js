const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { parse } = require('node-html-parser');

// 在这里添加所有需要爬取的类别
const CATEGORIES = {
  godlies: 'https://supremevalues.com/mm2/godlies',
  chromas: 'https://supremevalues.com/mm2/chromas',
  ancients: 'https://supremevalues.com/mm2/ancients',
  uniques: 'https://supremevalues.com/mm2/uniques',
  vintages: 'https://supremevalues.com/mm2/vintages',
  legendaries: 'https://supremevalues.com/mm2/legendaries', // 新增
  rares: 'https://supremevalues.com/mm2/rares',             // 新增
  uncommons: 'https://supremevalues.com/mm2/uncommons',     // 新增
  pets: 'https://supremevalues.com/mm2/pets',               // 新增
};

// ---------- 缓存配置：每10分钟自动更新 ----------
let cache = {
  data: null,
  timestamp: 0,
};
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟

// ---------- 工具函数：从HTML元素中提取数值 ----------
function extractValue(col) {
  // 1. 尝试从 data-value 属性获取
  let val = parseInt(col.getAttribute('data-value'));
  if (!isNaN(val) && val > 0) return val;

  // 2. 尝试从 .itemvalue 元素获取
  const valEl = col.querySelector('.itemvalue');
  if (valEl) {
    const text = valEl.text.replace(/,/g, '').trim();
    const num = parseInt(text);
    if (!isNaN(num) && num > 0) return num;
  }

  // 3. 降级方案：在文本中查找所有数字，取最大值
  const text = col.textContent;
  const matches = text.match(/\b(\d{1,6})\b/g);
  if (matches) {
    const nums = matches.map(Number).filter(n => n > 10);
    if (nums.length) return Math.max(...nums);
  }
  return null;
}

// ---------- 启动浏览器的辅助函数（带重试机制） ----------
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
        timeout: 20000,
      });
      return browser;
    } catch (error) {
      console.log(`[Launch] Attempt ${attempt} failed: ${error.message}`);
      if (attempt === retries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// ---------- 核心：爬取单个类别 ----------
async function scrapeCategory(page, name, url) {
  console.log(`[${name}] Loading...`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.itemcolumn', { timeout: 10000 }).catch(() => {});

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

// ---------- 主爬取函数：使用单个浏览器实例并行处理所有类别 ----------
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

// ---------- Vercel Serverless 函数入口 ----------
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
