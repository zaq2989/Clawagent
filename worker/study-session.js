'use strict';
// study-session.js — post-task reflection + knowledge extraction

const { addKnowledge } = require('./knowledge-store.js');

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

async function ollamaChat(messages) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false }),
  });
  const data = await res.json();
  return data.message?.content || '';
}

/**
 * Run a post-task study session via Ollama.
 * @param {object} opts
 * @param {object} opts.task       - The task object (must have category / description / title)
 * @param {*}      opts.result     - Task result (string or object)
 * @param {boolean} opts.success   - Whether the task succeeded
 */
async function runStudySession({ task, result, success }) {
  try {
    console.log('[StudySession] Running post-task study...');

    const taskTitle    = task.title || task.description || task.category || 'unknown';
    const taskCategory = task.category || task.intent || 'general';
    const resultStr    = typeof result === 'string'
      ? result.slice(0, 500)
      : JSON.stringify(result).slice(0, 500);

    const prompt = `You just completed a task. Reflect and extract a concise learning in Japanese.

Task: ${taskTitle}
Category: ${taskCategory}
Result: ${success ? 'SUCCESS' : 'FAILURE'}
Output: ${resultStr}

In 1-2 sentences in Japanese, what is the key learning from this task?
What worked well or what should be done differently next time?
Reply with ONLY the learning — no preamble, no labels.`;

    const learning = await ollamaChat([{ role: 'user', content: prompt }]);

    if (learning && learning.trim().length > 10) {
      addKnowledge({
        task_category: taskCategory,
        task_summary:  (task.title || task.description || '').slice(0, 100),
        outcome:       success ? 'success' : 'failure',
        learning:      learning.trim(),
      });
      console.log(`[StudySession] Learned: ${learning.trim().slice(0, 100)}`);
    }
  } catch (e) {
    console.warn('[StudySession] Failed (non-fatal):', e.message);
  }
}

module.exports = { runStudySession };
