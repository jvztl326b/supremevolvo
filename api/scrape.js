const { parse } = require('node-html-parser');

const CATEGORIES = {
  godlies: 'https://supremevalues.com/mm2/godlies',
  chromas: 'https://supremevalues.com/mm2/chromas',
  ancients: 'https://supremevalues.com/mm2/ancients',
  uniques: 'https://supremevalues.com/mm2/uniques',
};

const SCRAPINGBEE_KEY = process.env.SCRAPINGBEE_API_KEY;

async function scrapeCategory(name, url) {
  console.log(`Scraping ${name}...`);

  const targetUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_KEY}&url=${encodeURIComponent(url)}&render_js=true&premium_proxy=true&country_code=us&block_ads=true&timeout=20000`;

  const response = await fetch(targetUrl);
  const html = await response.text();

  if (html.includes('Blocked') || html.includes('Access Denied')) {
    console.log(`Blocked: ${name}`);
    return { regular: {}, chroma: {} };
  }

  const root = parse(html);
  const regular = {};
  const chroma = {};

  const columns = root.querySelectorAll('.itemcolumn');
  console.log(`${name}: found ${columns.length} items`);

  columns.forEach(col => {
    const head = col.querySelector('.itemhead');
    if (!head) return;

    let nameTag = head.text.trim();
    let value = parseInt(col.getAttribute('data-value'));

    if (!value || isNaN(value) || value <= 0) {
      const valEl = col.querySelector('.itemvalue');
      if (valEl) {
        value = parseInt(valEl.text.replace(/,/g, '').trim());
      }
    }

    if (!value || isNaN(value) || value <= 0) return;

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

  console.log(`${name}: extracted ${Object.keys(regular).length + Object.keys(chroma).length} items`);
  return { regular, chroma };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!SCRAPINGBEE_KEY) {
    return res.status(500).json({ error: 'Missing SCRAPINGBEE_API_KEY environment variable' });
  }

  // Check if user wants just one category
  const singleCategory = req.query.category;
  if (singleCategory) {
    const url = CATEGORIES[singleCategory];
    if (!url) {
      return res.status(400).json({ error: 'Invalid category. Use: godlies, chromas, ancients, uniques' });
    }
    const result = await scrapeCategory(singleCategory, url);
    return res.status(200).json(result);
  }

  // Scrape all categories in parallel
  try {
    const tasks = Object.entries(CATEGORIES).map(([name, url]) =>
      scrapeCategory(name, url)
    );
    const results = await Promise.all(tasks);

    // Merge all regular and chroma
    const mergedRegular = {};
    const mergedChroma = {};

    for (const result of results) {
      Object.assign(mergedRegular, result.regular);
      Object.assign(mergedChroma, result.chroma);
    }

    console.log(`Total: ${Object.keys(mergedRegular).length} regular, ${Object.keys(mergedChroma).length} chroma`);

    res.status(200).json({
      regular: mergedRegular,
      chroma: mergedChroma,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};
