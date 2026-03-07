'use strict';

/**
 * ClawAgent MCP Router
 * Mounts MCP endpoints on an existing Express app at /mcp/*
 *
 * Endpoints:
 *   GET  /mcp/sse     - SSE connection (optional: X-API-Key header or ?api_key=)
 *   POST /mcp/message - MCP message relay
 *   GET  /mcp/health  - Health check
 *
 * Auth policy:
 *   list_agents / check_task  → public (no auth required)
 *   hire_agent / submit_result → API key required (validated at SSE connect time)
 */

const crypto = require('crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { z } = require('zod');
const { getDb } = require('./db');
const { updateReputation } = require('./routes/reputation');

// Keep track of active SSE transports keyed by sessionId
const transports = {};

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Resolve API key from HTTP request (header or query param).
 * Returns { agentId } on success, null on missing key, or throws on invalid key.
 */
function resolveAuth(req) {
  const rawKey = req.headers['x-api-key'] || req.query.api_key;
  if (!rawKey) return null;

  const hashed = hashKey(rawKey);
  const db = getDb();
  const agent = db.prepare('SELECT id, status FROM agents WHERE api_key = ?').get(hashed);

  if (!agent) throw new Error('Invalid API key');
  if (agent.status === 'banned') throw new Error('Agent is banned');

  return { agentId: agent.id };
}

// ─── MCP error helper ─────────────────────────────────────────────────────────

function mcpError(message) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: message }) }],
    isError: true,
  };
}

// ─── MCP Server factory ───────────────────────────────────────────────────────
// One McpServer per SSE session. sessionAuth is { agentId } or null.

function buildMcpServer(sessionAuth) {
  const server = new McpServer({
    name: 'clawagent',
    version: '1.0.0',
  });

  // ── Tool: list_agents (public) ──────────────────────────────────────────────
  server.tool(
    'list_agents',
    'Search available agents by skill and/or minimum reputation score.',
    {
      skill: z.string().optional().describe('Filter by skill/capability keyword'),
      min_reputation: z.number().min(0).max(100).optional().describe('Minimum reputation score (0-100)'),
    },
    async ({ skill, min_reputation }) => {
      try {
        const db = getDb();
        let agents = db.prepare(
          'SELECT id, name, capabilities, reputation_score, bond_amount, status FROM agents WHERE status = ?'
        ).all('active');

        if (skill) {
          const keyword = skill.toLowerCase();
          agents = agents.filter(agent => {
            try {
              const caps = JSON.parse(agent.capabilities || '[]');
              return caps.some(c => c.toLowerCase().includes(keyword));
            } catch { return false; }
          });
        }

        if (min_reputation !== undefined) {
          agents = agents.filter(a => a.reputation_score >= min_reputation);
        }

        agents.sort((a, b) => b.reputation_score - a.reputation_score);

        const result = agents.map(a => ({
          name: a.name,
          skills: (() => { try { return JSON.parse(a.capabilities || '[]'); } catch { return []; } })(),
          reputation_score: a.reputation_score,
          bond_amount: a.bond_amount,
          status: a.status,
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ ok: true, count: result.length, agents: result }, null, 2),
          }],
        };
      } catch (err) {
        return mcpError(err.message);
      }
    }
  );

  // ── Tool: check_task (public) ───────────────────────────────────────────────
  server.tool(
    'check_task',
    'Check the status and result of a task.',
    {
      task_id: z.string().describe('Task ID to check'),
    },
    async ({ task_id }) => {
      try {
        const db = getDb();
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);

        if (!task) return mcpError(`Task not found: ${task_id}`);

        let workerName = null;
        if (task.worker_id) {
          const worker = db.prepare('SELECT name FROM agents WHERE id = ?').get(task.worker_id);
          workerName = worker ? worker.name : null;
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              task_id: task.id,
              status: task.status,
              result: task.result
                ? (() => { try { return JSON.parse(task.result); } catch { return task.result; } })()
                : null,
              worker_name: workerName,
              intent: task.intent,
              created_at: task.created_at,
              updated_at: task.completed_at || task.assigned_at || task.created_at,
            }, null, 2),
          }],
        };
      } catch (err) {
        return mcpError(err.message);
      }
    }
  );

  // ── Tool: hire_agent (auth required) ───────────────────────────────────────
  server.tool(
    'hire_agent',
    'Create a task and automatically assign the best matching agent (by skill + reputation). Requires API key.',
    {
      skill: z.string().describe('Required skill/capability for the task'),
      task_description: z.string().describe('Description of the task to be performed'),
      budget: z.number().positive().optional().describe('Maximum budget for the task'),
    },
    async ({ skill, task_description, budget }) => {
      if (!sessionAuth) {
        return mcpError('hire_agent requires authentication. Provide X-API-Key header or ?api_key= when connecting.');
      }

      try {
        const db = getDb();
        const allAgents = db.prepare('SELECT * FROM agents WHERE status = ?').all('active');
        const keyword = skill.toLowerCase();
        const matched = allAgents
          .filter(a => {
            try {
              const caps = JSON.parse(a.capabilities || '[]');
              return caps.some(c => c.toLowerCase().includes(keyword));
            } catch { return false; }
          })
          .sort((a, b) => b.reputation_score - a.reputation_score);

        if (matched.length === 0) {
          return mcpError(`No active agents found with skill: ${skill}`);
        }

        const worker = matched[0];
        const taskId = require('crypto').randomUUID();
        const now = Date.now();

        db.prepare(`
          INSERT INTO tasks (id, category, intent, input_data, max_cost, payment_amount, issuer_id, worker_id, status, created_at, assigned_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'assigned', ?, ?)
        `).run(
          taskId,
          skill,
          task_description,
          JSON.stringify({ description: task_description }),
          budget || null,
          budget || null,
          sessionAuth.agentId,
          worker.id,
          now,
          now
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              task_id: taskId,
              worker_name: worker.name,
              worker_reputation: worker.reputation_score,
              status: 'assigned',
            }, null, 2),
          }],
        };
      } catch (err) {
        return mcpError(err.message);
      }
    }
  );

  // ── Tool: submit_result (auth required) ────────────────────────────────────
  server.tool(
    'submit_result',
    'Submit the result of a task (called by the worker agent). Requires API key.',
    {
      task_id: z.string().describe('Task ID to submit result for'),
      result: z.string().describe('The result/output of the task'),
      status: z.enum(['completed', 'failed']).describe('Final task status'),
    },
    async ({ task_id, result, status }) => {
      if (!sessionAuth) {
        return mcpError('submit_result requires authentication. Provide X-API-Key header or ?api_key= when connecting.');
      }

      try {
        const db = getDb();
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);

        if (!task) return mcpError(`Task not found: ${task_id}`);

        if (['completed', 'failed'].includes(task.status)) {
          return mcpError(`Task is already ${task.status}`);
        }

        // Worker must own this task
        if (task.worker_id !== sessionAuth.agentId) {
          return mcpError('You are not the assigned worker for this task');
        }

        const now = Date.now();
        db.prepare(
          'UPDATE tasks SET status = ?, result = ?, completed_at = ? WHERE id = ?'
        ).run(status, JSON.stringify({ output: result }), now, task_id);

        let reputationUpdate = null;
        if (task.worker_id) {
          try {
            reputationUpdate = updateReputation(task.worker_id, task_id, status);
          } catch (repErr) {
            console.error('[MCP] Reputation update error:', repErr.message);
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ ok: true, task_id, status, reputation_update: reputationUpdate }, null, 2),
          }],
        };
      } catch (err) {
        return mcpError(err.message);
      }
    }
  );

  return server;
}

// ─── Router factory ───────────────────────────────────────────────────────────

function createMcpRouter(app) {
  // Health check
  app.get('/mcp/health', (req, res) => {
    res.json({
      ok: true,
      service: 'ClawAgent MCP',
      version: '1.0.0',
      uptime: process.uptime(),
      activeSessions: Object.keys(transports).length,
    });
  });

  // SSE endpoint — optional API key for auth-required tools
  app.get('/mcp/sse', async (req, res) => {
    let sessionAuth = null;
    try {
      sessionAuth = resolveAuth(req);
    } catch (err) {
      return res.status(401).json({ ok: false, error: err.message });
    }

    try {
      const mcpServer = buildMcpServer(sessionAuth);
      const transport = new SSEServerTransport('/mcp/message', res);
      transports[transport.sessionId] = { transport, mcpServer };

      res.on('close', () => {
        delete transports[transport.sessionId];
        console.log(`[MCP] Session closed: ${transport.sessionId}`);
      });

      console.log(`[MCP] New session: ${transport.sessionId} auth=${!!sessionAuth}`);
      await mcpServer.connect(transport);
    } catch (err) {
      console.error('[MCP] SSE connection error:', err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'Internal server error' });
      }
    }
  });

  // Message relay endpoint
  app.post('/mcp/message', async (req, res) => {
    try {
      const sessionId = req.query.sessionId;
      const session = transports[sessionId];

      if (!session) {
        return res.status(404).json({ ok: false, error: `No active session: ${sessionId}` });
      }

      await session.transport.handlePostMessage(req, res, req.body);
    } catch (err) {
      console.error('[MCP] Message handling error:', err);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: 'Internal server error' });
      }
    }
  });

  console.log('[MCP] Routes mounted: GET /mcp/sse  POST /mcp/message  GET /mcp/health');
}

module.exports = { createMcpRouter };
