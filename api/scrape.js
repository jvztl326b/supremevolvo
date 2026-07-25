// api/scrape.js – uses ScrapingBee to render the page
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const category = req.query.category || 'godlies';
  const url = `https://supremevalues.com/mm2/${category}`;

  // Get your ScrapingBee API key from environment variables
  const apiKey = process.env.SCRAPINGBEE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Missing SCRAPINGBEE_API_KEY environment variable' });
  }

  try {
    // Use ScrapingBee to render the page with JavaScript
    const targetUrl = `https://app.scrapingbee.com/api/v1/?api_key=${apiKey}&url=${encodeURIComponent(url)}&render_js=true&premium_proxy=true&country_code=us&block_ads=true&timeout=20000`;

    const response = await fetch(targetUrl);
    const html = await response.text();

    if (html.includes('Blocked') || html.includes('Access Denied')) {
      return res.status(403).json({ error: 'Page blocked, try using a different proxy or country' });
    }

    // Parse HTML with node-html-parser
    const { parse } = require('node-html-parser');
    const root = parse(html);

    const regular = {};
    const chroma = {};

    const columns = root.querySelectorAll('.itemcolumn');
    columns.forEach(col => {
      const head = col.querySelector('.itemhead');
      if (!head) return;

      let name = head.text.trim();
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
                       name.toLowerCase().startsWith('chroma ') ||
                       name.toLowerCase().startsWith('c. ');

      if (isChroma) {
        name = name.replace(/^(chroma|c\.)\s+/i, '').trim();
        chroma[name] = value;
      } else {
        regular[name] = value;
      }
    });

    res.status(200).json({ regular, chroma });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};
