/**
 * Web Search / Scrape capability
 * - FIRECRAWL_API_KEY が設定されていればFirecrawl APIを使用
 * - なければDuckDuckGo instant answer（フォールバック）
 */

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;

/**
 * URLをスクレイプしてmarkdownで返す
 */
async function webScrape(url) {
  if (!FIRECRAWL_API_KEY) throw new Error('FIRECRAWL_API_KEY not set');
  const res = await fetch('https://api.firecrawl.dev/v1/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, formats: ['markdown'] }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || 'Firecrawl scrape failed');
  return {
    url,
    title: data.data?.metadata?.title || '',
    markdown: data.data?.markdown || '',
  };
}

/**
 * キーワード検索して上位結果をmarkdownで返す
 */
async function webSearch(query, options = {}) {
  const limit = options.limit || 5;

  if (FIRECRAWL_API_KEY) {
    const res = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, limit }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Firecrawl search failed');
    return (data.data || []).map(r => ({
      title: r.title || '',
      url: r.url || '',
      snippet: r.description || r.markdown?.slice(0, 300) || '',
    }));
  }

  // Fallback: DuckDuckGo instant answer
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url);
  const data = await res.json();
  return [{ title: data.Heading, snippet: data.AbstractText, url: data.AbstractURL }].filter(r => r.title);
}

module.exports = { webSearch, webScrape };
