const { parse } = require('node-html-parser');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const category = req.query.category || 'godlies';
  const url = `https://supremevalues.com/mm2/${category}`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });

    const html = await response.text();
    const root = parse(html);

    // Debug: count how many .itemcolumn elements we found
    const columns = root.querySelectorAll('.itemcolumn');
    console.log(`Found ${columns.length} .itemcolumn elements`);

    const regular = {};
    const chroma = {};
    let sample = [];

    columns.forEach((col, index) => {
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

      // Check if it's chroma by class or name prefix
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

      // Save a sample of the first 5 items for debugging
      if (index < 5) {
        sample.push({ name, value, isChroma, classAttr: classAttr.substring(0, 100) });
      }
    });

    // If no items found, return debug info
    if (Object.keys(regular).length === 0 && Object.keys(chroma).length === 0) {
      return res.status(200).json({
        error: 'No items parsed',
        debug: {
          columnsFound: columns.length,
          sample: sample,
          htmlPreview: html.substring(0, 2000), // first 2000 chars
        },
      });
    }

    res.status(200).json({ regular, chroma });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
};
