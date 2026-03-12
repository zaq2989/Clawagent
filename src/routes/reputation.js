const uuidv4 = () => require('crypto').randomUUID();
const { query, run, get } = require('../db');

// Reputation formula:
// success_rate * 0.4 + accuracy * 0.3 + speed_score * 0.2 + (1 - dispute_rate) * 0.1
// All values normalized to 0-100

async function updateReputation(agentId, taskId, event, extra = {}) {
  const agent = await get('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (!agent) return;

  let scoreDelta = 0;

  if (event === 'completed') {
    await run('UPDATE agents SET tasks_completed = tasks_completed + 1 WHERE id = ?', [agentId]);
    scoreDelta = 3 + (extra.accuracy || 0) * 0.5 + (extra.speed_bonus || 0) * 0.3;
  } else if (event === 'failed') {
    await run('UPDATE agents SET tasks_failed = tasks_failed + 1 WHERE id = ?', [agentId]);
    scoreDelta = -5;
  } else if (event === 'disputed') {
    scoreDelta = -8;
  }

  const updatedAgent = await get('SELECT * FROM agents WHERE id = ?', [agentId]);
  const total = updatedAgent.tasks_completed + updatedAgent.tasks_failed;
  const successRate = total > 0 ? updatedAgent.tasks_completed / total : 0.5;
  const accuracy = extra.accuracy || 0.7;
  const speedScore = extra.speed_bonus || 0.5;
  const disputeRate = total > 0 ? (updatedAgent.tasks_failed * 0.3) / total : 0;

  const newScore = Math.min(100, Math.max(0,
    (successRate * 0.4 + accuracy * 0.3 + speedScore * 0.2 + (1 - disputeRate) * 0.1) * 100
  ));

  await run('UPDATE agents SET reputation_score = ? WHERE id = ?', [Math.round(newScore * 100) / 100, agentId]);

  await run(
    'INSERT INTO reputation_log (id, agent_id, task_id, event, score_delta, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [uuidv4(), agentId, taskId, event, scoreDelta, Date.now()]
  );

  return { new_score: Math.round(newScore * 100) / 100, score_delta: scoreDelta };
}

module.exports = { updateReputation };
