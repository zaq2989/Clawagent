// src/builtins/index.js — Built-in capability executor
// These capabilities run server-side without an external agent endpoint.

const BUILTINS = {
  'echo.text': async (input) => ({
    echoed: input.text || input.message || JSON.stringify(input),
    timestamp: new Date().toISOString(),
  }),

  'detect.language': async (input) => {
    const text = input.text || '';
    // Simple language detection (Japanese / Chinese / English / other)
    const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
    const hasChinese  = /[\u4e00-\u9fff]/.test(text) && !hasJapanese;
    const lang = hasJapanese ? 'ja' : hasChinese ? 'zh' : 'en';
    return { language: lang, confidence: 0.9, text };
  },

  'validate.json': async (input) => {
    try {
      const parsed = typeof input.data === 'string' ? JSON.parse(input.data) : input.data;
      return { valid: true, parsed, keys: Object.keys(parsed || {}) };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  },

  'format.markdown': async (input) => {
    const text = input.text || '';
    const formatted = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>');
    return { original: text, formatted, length: text.length };
  },

  'analyze.sentiment': async (input) => {
    const text = (input.text || '').toLowerCase();
    const positive = ['good', 'great', 'excellent', 'amazing', 'love', 'wonderful', 'fantastic', 'happy', 'best']
      .filter(w => text.includes(w)).length;
    const negative = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'disgusting', 'sad', 'poor']
      .filter(w => text.includes(w)).length;
    const score = positive - negative;
    return {
      sentiment: score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral',
      score,
      positive_signals: positive,
      negative_signals: negative,
    };
  },
};

module.exports = { BUILTINS };
