// src/capabilities/webSearch.js — Built-in web search capability
// Uses Brave Search API if BRAVE_API_KEY is set, otherwise DuckDuckGo instant answers

/**
 * @param {string} query
 * @param {{ limit?: number }} options
 * @returns {Promise<Array<{ title: string, url: string, snippet: string }>>}
 */
async function webSearch(query, options = {}) {
  const limit = options.limit || 5;

  if (process.env.BRAVE_API_KEY) {
    // Brave Search API
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY },
    });
    if (!res.ok) {
      throw new Error(`Brave Search API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    return (data.web?.results || []).slice(0, limit).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description || '',
    }));
  } else {
    // DuckDuckGo instant answer API（無料・APIキー不要）
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`DuckDuckGo API error: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();

    const results = [];

    // Main abstract result
    if (data.Heading && data.AbstractText) {
      results.push({
        title: data.Heading,
        snippet: data.AbstractText,
        url: data.AbstractURL || '',
      });
    }

    // Related topics
    if (Array.isArray(data.RelatedTopics)) {
      for (const topic of data.RelatedTopics) {
        if (results.length >= limit) break;
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.split(' - ')[0] || topic.Text,
            snippet: topic.Text,
            url: topic.FirstURL,
          });
        }
      }
    }

    return results.slice(0, limit);
  }
}

module.exports = { webSearch };
