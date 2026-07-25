// api/scrape.js
const puppeteer = require('puppeteer');

module.exports = async (req, res) => {
  // Enable CORS for Roblox
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const category = req.query.category || 'godlies';
  const url = `https://supremevalues.com/mm2/${category}`;

  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
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

    // Extract data
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
    res.status(500).json({ error: error.message });
  }
};
