const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const category = req.query.category || 'godlies';
  const url = `https://supremevalues.com/mm2/${category}`;

  let browser = null;
  try {
    const executablePath = await chromium.executablePath();

    // CRITICAL: Set library path so Chromium can find extracted libs
    const execDir = executablePath.substring(0, executablePath.lastIndexOf('/'));
    process.env.LD_LIBRARY_PATH = execDir + ':' + (process.env.LD_LIBRARY_PATH || '');

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: executablePath,
      headless: chromium.headless,
      timeout: 30000,
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });

    // Scroll to load lazy items
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 500;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    await page.waitForTimeout(2000);

    const data = await page.evaluate(() => {
      const regular = {};
      const chroma = {};
      document.querySelectorAll('.itemcolumn').forEach(col => {
        const head = col.querySelector('.itemhead');
        if (!head) return;
        let name = head.textContent.trim();
        let value = parseInt(col.dataset.value);
        if (!value || isNaN(value)) {
          const valEl = col.querySelector('.itemvalue');
          if (valEl) {
            value = parseInt(valEl.textContent.replace(/,/g, '').trim());
          }
        }
        if (!value || isNaN(value) || value <= 0) return;

        const isChroma = col.classList.contains('chroma') ||
                         name.toLowerCase().startsWith('chroma ') ||
                         name.toLowerCase().startsWith('c. ');
        if (isChroma) {
          name = name.replace(/^(chroma|c\.)\s+/i, '').trim();
          chroma[name] = value;
        } else {
          regular[name] = value;
        }
      });
      return { regular, chroma };
    });

    await browser.close();
    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    if (browser) await browser.close();
    res.status(500).json({ error: error.message });
  }
};
