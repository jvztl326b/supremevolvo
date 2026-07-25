const { parse } = require('node-html-parser');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const category = req.query.category || 'godlies';
  const url = `https://supremevalues.com/mm2/${category}`;

  try {
    // Fetch the HTML
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });

    const html = await response.text();
    const root = parse(html);

    const regular = {};
    const chroma = {};

    // Find all .itemcolumn divs
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

      // Chroma detection
      const classList = col.classNames || [];
      const isChroma = classList.includes('chroma') ||
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
