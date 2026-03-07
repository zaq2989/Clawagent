'use strict';

/**
 * ClawAgent MCP Server (port 3751)
 * HTTP/SSE transport using @modelcontextprotocol/sdk
 *
 * Tools:
 *   list_agents   - Search agents by skill / min reputation
 *   hire_agent    - Create a task and assign best matching agent
 *   check_task    - Get task status and result
 *   submit_result - Worker submits result and updates reputation
 */

const express = require('express');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { z } = require('zod');
const uuidv4 = () => require('crypto').randomUUID();
const { getDb } = require('./db');
const { updateReputation } = require('./routes/reputation');

const MCP_PORT = process.env.MCP_PORT || 3751;

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Keep track of active SSE transports keyed by sessionId
const transports = {};

// ─── MCP Server factory ───────────────────────────────────────────────────────
// We create one McpServer per SSE session so each connection gets its own state.

function buildMcpServer() {
  const server = new McpServer({
    name: 'clawagent',
    version: '1.0.0',
  });

  // ── Tool: list_agents ───────────────────────────────────────────────────────
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
        let agents = db.prepare('SELECT id, name, capabilities, reputation_score, bond_amount, status FROM agents WHERE status = ?').all('active');

        // Filter by skill if provided
        if (skill) {
          const keyword = skill.toLowerCase();
          agents = agents.filter(agent => {
            try {
              const caps = JSON.parse(agent.capabilities || '[]');
              return caps.some(c => c.toLowerCase().includes(keyword));
            } catch {
              return false;
            }
          });
        }

        // Filter by min_reputation
        if (min_reputation !== undefined) {
          agents = agents.filter(a => a.reputation_score >= min_reputation);
        }

        // Sort by reputation descending
        agents.sort((a, b) => b.reputation_score - a.reputation_score);

        const result = agents.map(a => ({
          name: a.name,
          skills: (() => { try { return JSON.parse(a.capabilities || '[]'); } catch { return []; } })(),
          reputation_score: a.reputation_score,
          bond_amount: a.bond_amount,
          status: a.status,
        }));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: true, count: result.length, agents: result }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
          isError: true,
        };
      }
    }
  );

  // ── Tool: hire_agent ────────────────────────────────────────────────────────
  server.tool(
    'hire_agent',
    'Create a task and automatically assign the best matching agent (by skill + reputation).',
    {
      skill: z.string().describe('Required skill/capability for the task'),
      task_description: z.string().describe('Description of the task to be performed'),
      budget: z.number().positive().optional().describe('Maximum budget for the task'),
    },
    async ({ skill, task_description, budget }) => {
      try {
        const db = getDb();

        // Find best matching agent: active, skill match, highest reputation
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
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `No active agents found with skill: ${skill}` }) }],
            isError: true,
          };
        }

        const worker = matched[0];
        const taskId = uuidv4();
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
          'mcp-client',
          worker.id,
          now,
          now
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: true,
                task_id: taskId,
                worker_name: worker.name,
                worker_reputation: worker.reputation_score,
                status: 'assigned',
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
          isError: true,
        };
      }
    }
  );

  // ── Tool: check_task ────────────────────────────────────────────────────────
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

        if (!task) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Task not found: ${task_id}` }) }],
            isError: true,
          };
        }

        let workerName = null;
        if (task.worker_id) {
          const worker = db.prepare('SELECT name FROM agents WHERE id = ?').get(task.worker_id);
          workerName = worker ? worker.name : null;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: true,
                task_id: task.id,
                status: task.status,
                result: task.result ? (() => { try { return JSON.parse(task.result); } catch { return task.result; } })() : null,
                worker_name: workerName,
                intent: task.intent,
                created_at: task.created_at,
                updated_at: task.completed_at || task.assigned_at || task.created_at,
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
          isError: true,
        };
      }
    }
  );

  // ── Tool: submit_result ─────────────────────────────────────────────────────
  server.tool(
    'submit_result',
    'Submit the result of a task (called by the worker agent). Updates task status and agent reputation.',
    {
      task_id: z.string().describe('Task ID to submit result for'),
      result: z.string().describe('The result/output of the task'),
      status: z.enum(['completed', 'failed']).describe('Final task status'),
    },
    async ({ task_id, result, status }) => {
      try {
        const db = getDb();
        const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);

        if (!task) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Task not found: ${task_id}` }) }],
            isError: true,
          };
        }

        if (['completed', 'failed'].includes(task.status)) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ ok: false, error: `Task is already ${task.status}` }) }],
            isError: true,
          };
        }

        const now = Date.now();

        // Update task
        db.prepare(`
          UPDATE tasks SET status = ?, result = ?, completed_at = ? WHERE id = ?
        `).run(status, JSON.stringify({ output: result }), now, task_id);

        // Update agent reputation
        let reputationUpdate = null;
        if (task.worker_id) {
          reputationUpdate = updateReputation(task.worker_id, task_id, status);
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: true,
                task_id,
                status,
                reputation_update: reputationUpdate,
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: err.message }) }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// ─── SSE Endpoint ─────────────────────────────────────────────────────────────

app.get('/sse', async (req, res) => {
  try {
    const mcpServer = buildMcpServer();
    const transport = new SSEServerTransport('/message', res);
    transports[transport.sessionId] = { transport, mcpServer };

    res.on('close', () => {
      delete transports[transport.sessionId];
    });

    await mcpServer.connect(transport);
  } catch (err) {
    console.error('[MCP] SSE connection error:', err);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'Internal server error' });
    }
  }
});

// ─── Message Endpoint ─────────────────────────────────────────────────────────

app.post('/message', async (req, res) => {
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

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'ClawAgent MCP', version: '1.0.0', uptime: process.uptime() });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(MCP_PORT, () => {
  console.log(`ClawAgent MCP server running on http://localhost:${MCP_PORT}/sse`);
});

module.exports = app;
