const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

// Reputation formula:
// success_rate * 0.4 + accuracy * 0.3 + speed_score * 0.2 + (1 - dispute_rate) * 0.1
// All values normalized to 0-100

function updateReputation(agentId, taskId, event, extra = {}) {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return;

  let scoreDelta = 0;

  if (event === 'completed') {
    db.prepare('UPDATE agents SET tasks_completed = tasks_completed + 1 WHERE id = ?').run(agentId);
    scoreDelta = 3 + (extra.accuracy || 0) * 0.5 + (extra.speed_bonus || 0) * 0.3;
  } else if (event === 'failed') {
    db.prepare('UPDATE agents SET tasks_failed = tasks_failed + 1 WHERE id = ?').run(agentId);
    scoreDelta = -5;
  } else if (event === 'disputed') {
    scoreDelta = -8;
  }

  const updatedAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  const total = updatedAgent.tasks_completed + updatedAgent.tasks_failed;
  const successRate = total > 0 ? updatedAgent.tasks_completed / total : 0.5;
  const accuracy = extra.accuracy || 0.7;
  const speedScore = extra.speed_bonus || 0.5;
  const disputeRate = total > 0 ? (updatedAgent.tasks_failed * 0.3) / total : 0;

  const newScore = Math.min(100, Math.max(0,
    (successRate * 0.4 + accuracy * 0.3 + speedScore * 0.2 + (1 - disputeRate) * 0.1) * 100
  ));

  db.prepare('UPDATE agents SET reputation_score = ? WHERE id = ?').run(Math.round(newScore * 100) / 100, agentId);

  db.prepare('INSERT INTO reputation_log (id, agent_id, task_id, event, score_delta, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), agentId, taskId, event, scoreDelta, Date.now());

  return { new_score: Math.round(newScore * 100) / 100, score_delta: scoreDelta };
}

module.exports = { updateReputation };
