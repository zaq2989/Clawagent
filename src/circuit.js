// Circuit Breaker: per-agent consecutive failures and cooldown tracking

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 3600000; // 1 hour
const BUDGET_ALERT_RATIO = 0.2;

const globalState = {
  budgetUsed: 0,
  budgetLimit: 0,
  windowStart: Date.now(),
};

// Per-agent circuit state: { consecutiveFailures, cooldownUntil }
const agentStates = new Map();

function getAgentState(agentId) {
  if (!agentStates.has(agentId)) {
    agentStates.set(agentId, { consecutiveFailures: 0, cooldownUntil: null });
  }
  return agentStates.get(agentId);
}

const circuitBreaker = {
  recordFailure(agentId) {
    const s = getAgentState(agentId);
    s.consecutiveFailures++;
    if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
      s.cooldownUntil = Date.now() + COOLDOWN_MS;
      console.log(`[CIRCUIT BREAKER] Agent ${agentId}: ${FAILURE_THRESHOLD} consecutive failures. Cooldown until ${new Date(s.cooldownUntil).toISOString()}`);
    }
  },

  recordSuccess(agentId) {
    const s = getAgentState(agentId);
    s.consecutiveFailures = 0;
  },

  recordSpend(amount) {
    if (Date.now() - globalState.windowStart > COOLDOWN_MS) {
      globalState.budgetUsed = 0;
      globalState.windowStart = Date.now();
    }
    globalState.budgetUsed += amount;
    if (globalState.budgetLimit > 0 && globalState.budgetUsed > globalState.budgetLimit * BUDGET_ALERT_RATIO) {
      console.log(`[CIRCUIT BREAKER] Budget ${globalState.budgetUsed} exceeded 20% of limit ${globalState.budgetLimit} within 1h window`);
    }
  },

  setBudgetLimit(limit) {
    globalState.budgetLimit = limit;
  },

  isOpen(agentId) {
    if (agentId) {
      const s = getAgentState(agentId);
      if (s.cooldownUntil && Date.now() < s.cooldownUntil) return true;
      if (s.cooldownUntil && Date.now() >= s.cooldownUntil) {
        s.cooldownUntil = null;
        s.consecutiveFailures = 0;
      }
      return false;
    }
    // Global check: any agent in cooldown
    for (const [, s] of agentStates) {
      if (s.cooldownUntil && Date.now() < s.cooldownUntil) return true;
    }
    return false;
  },

  reset(agentId) {
    if (agentId) {
      agentStates.delete(agentId);
    } else {
      agentStates.clear();
      globalState.budgetUsed = 0;
      globalState.windowStart = Date.now();
    }
  },

  getStatus() {
    return {
      budget_used: globalState.budgetUsed,
      budget_limit: globalState.budgetLimit,
    };
  },

  getAgentStatuses(db) {
    const agents = db.prepare('SELECT id, name, status FROM agents').all();
    return agents.map(a => {
      const s = agentStates.get(a.id) || { consecutiveFailures: 0, cooldownUntil: null };
      // Clear expired cooldowns
      if (s.cooldownUntil && Date.now() >= s.cooldownUntil) {
        s.cooldownUntil = null;
        s.consecutiveFailures = 0;
      }
      return {
        agent_id: a.id,
        name: a.name,
        status: s.cooldownUntil ? 'cooldown' : a.status,
        fail_streak: s.consecutiveFailures,
        cooldown_until: s.cooldownUntil ? new Date(s.cooldownUntil).toISOString() : null,
      };
    });
  }
};

module.exports = { circuitBreaker };
