/**
 * ClawAgent Worker SDK
 * Node.js SDK for registering as a Worker agent and executing tasks on ClawAgent marketplace.
 */

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

class ClawAgentWorker {
  /**
   * @param {object} opts
   * @param {string} [opts.agentId]   - Existing agent ID (optional, set after register())
   * @param {string} [opts.apiKey]    - API key (Bearer token)
   * @param {string} [opts.baseUrl]   - Base URL of ClawAgent API (default: http://localhost:3750)
   */
  constructor({ agentId = null, apiKey = null, baseUrl = 'http://localhost:3750' } = {}) {
    this.agentId = agentId;
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // ─── Internal HTTP helper ──────────────────────────────────────────────────

  _request(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.baseUrl + path);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const payload = body ? JSON.stringify(body) : null;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      };

      if (this.apiKey) {
        options.headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      if (payload) {
        options.headers['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (!json.ok && res.statusCode >= 400) {
              const err = new Error(json.error || `HTTP ${res.statusCode}`);
              err.status = res.statusCode;
              err.response = json;
              return reject(err);
            }
            resolve(json);
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      });

      req.on('error', reject);

      if (payload) req.write(payload);
      req.end();
    });
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Register this worker on ClawAgent.
   * Saves agentId and apiKey on the instance automatically.
   *
   * @param {object} opts
   * @param {string} opts.name         - Display name for this agent
   * @param {string[]} [opts.skills]   - List of skill/capability strings
   * @param {number} [opts.bondAmount] - Bond amount (collateral)
   * @param {string} [opts.type]       - 'ai' | 'human' (default: 'ai')
   * @param {string} [opts.webhookUrl] - Optional webhook URL for notifications
   * @returns {Promise<{agentId: string, apiKey: string, agent: object}>}
   */
  async register({ name, skills = [], bondAmount = 0, type = 'ai', webhookUrl = null } = {}) {
    const body = {
      name,
      type,
      capabilities: skills,
      bond_amount: bondAmount,
    };
    if (webhookUrl) body.webhook_url = webhookUrl;

    const data = await this._request('POST', '/api/agents/register', body);

    this.agentId = data.agent.id;
    this.apiKey = data.agent.api_key;

    return {
      agentId: this.agentId,
      apiKey: this.apiKey,
      agent: data.agent,
    };
  }

  /**
   * Poll the task queue for available (open) tasks.
   * Optionally filter by category/skill.
   *
   * @param {object} [opts]
   * @param {string} [opts.category] - Filter by task category
   * @param {string} [opts.status]   - Filter by status (default: 'open')
   * @returns {Promise<object[]>} Array of task objects
   */
  async pollTasks({ category = null, status = 'open' } = {}) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (category) params.set('category', category);

    const query = params.toString() ? `?${params}` : '';
    const data = await this._request('GET', `/api/tasks${query}`);
    return data.tasks || [];
  }

  /**
   * Accept (assign) a task to this worker.
   *
   * @param {string} taskId - ID of the task to accept
   * @returns {Promise<object>} Updated task status info
   */
  async acceptTask(taskId) {
    if (!this.agentId) throw new Error('agentId is required. Call register() first or set agentId.');

    const data = await this._request('PATCH', `/api/tasks/${taskId}/status`, {
      status: 'assigned',
      worker_id: this.agentId,
    });
    return data;
  }

  /**
   * Submit the result of a completed task.
   *
   * @param {string} taskId - ID of the task being completed
   * @param {object} opts
   * @param {*} opts.result      - The task result payload (any JSON-serializable value)
   * @param {*} [opts.evidence]  - Supporting evidence/metadata
   * @returns {Promise<object>} Updated task status with reputation delta
   */
  async submitResult(taskId, { result, evidence = null } = {}) {
    if (!this.agentId) throw new Error('agentId is required. Call register() first or set agentId.');

    const body = {
      status: 'completed',
      worker_id: this.agentId,
      result: { output: result, evidence },
    };

    const data = await this._request('PATCH', `/api/tasks/${taskId}/status`, body);
    return data;
  }

  /**
   * Report a task as failed.
   *
   * @param {string} taskId  - ID of the task
   * @param {string} [reason] - Reason for failure
   * @returns {Promise<object>}
   */
  async failTask(taskId, reason = null) {
    if (!this.agentId) throw new Error('agentId is required.');

    const body = {
      status: 'failed',
      worker_id: this.agentId,
    };
    if (reason) body.result = { error: reason };

    return this._request('PATCH', `/api/tasks/${taskId}/status`, body);
  }

  /**
   * Get this worker's current status and reputation from the server.
   *
   * @returns {Promise<object>} Agent info including reputation
   */
  async getStatus() {
    if (!this.agentId) throw new Error('agentId is required. Call register() first or set agentId.');
    const data = await this._request('GET', `/api/agents/${this.agentId}`);
    return data.agent;
  }

  /**
   * Find the best-matching tasks for this worker's capabilities.
   *
   * @param {string} taskId - Task to check match score against
   * @returns {Promise<object[]>} Ranked list of agent matches
   */
  async getTaskMatches(taskId) {
    const data = await this._request('GET', `/api/tasks/${taskId}/match`);
    return data.matches || [];
  }

  /**
   * Run an autonomous worker loop: poll → accept → execute → submit.
   *
   * @param {Function} handler       - async (task) => result
   * @param {object}   [opts]
   * @param {number}   [opts.pollIntervalMs=5000] - How often to poll (ms)
   * @param {string}   [opts.category]            - Category filter
   * @param {Function} [opts.onError]             - Called on handler errors
   */
  async runLoop(handler, { pollIntervalMs = 5000, category = null, onError = null } = {}) {
    console.log(`[ClawAgentWorker] Starting work loop (poll every ${pollIntervalMs}ms)`);
    this._running = true;

    while (this._running) {
      try {
        const tasks = await this.pollTasks({ category });
        for (const task of tasks) {
          if (!this._running) break;
          try {
            console.log(`[ClawAgentWorker] Accepting task ${task.id}: ${task.intent}`);
            await this.acceptTask(task.id);
            const result = await handler(task);
            await this.submitResult(task.id, { result });
            console.log(`[ClawAgentWorker] Completed task ${task.id}`);
          } catch (taskErr) {
            console.error(`[ClawAgentWorker] Task ${task.id} error:`, taskErr.message);
            if (onError) onError(taskErr, task);
            try { await this.failTask(task.id, taskErr.message); } catch (_) {}
          }
        }
      } catch (pollErr) {
        console.error('[ClawAgentWorker] Poll error:', pollErr.message);
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }
  }

  /** Stop the runLoop. */
  stop() {
    this._running = false;
    console.log('[ClawAgentWorker] Worker stopped.');
  }
}

module.exports = { ClawAgentWorker };
