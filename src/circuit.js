// Circuit Breaker: consecutive failures and budget monitoring

const state = {
  consecutiveFailures: 0,
  cooldownUntil: null,
  budgetUsed: 0,
  budgetLimit: 0,
  windowStart: Date.now(),
};

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 3600000; // 1 hour
const BUDGET_ALERT_RATIO = 0.2;

const circuitBreaker = {
  recordFailure() {
    state.consecutiveFailures++;
    if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
      state.cooldownUntil = Date.now() + COOLDOWN_MS;
      console.log(`[CIRCUIT BREAKER] ALERT to Kiri: ${FAILURE_THRESHOLD} consecutive failures. Cooldown until ${new Date(state.cooldownUntil).toISOString()}`);
    }
  },

  recordSuccess() {
    state.consecutiveFailures = 0;
  },

  recordSpend(amount) {
    if (Date.now() - state.windowStart > COOLDOWN_MS) {
      state.budgetUsed = 0;
      state.windowStart = Date.now();
    }
    state.budgetUsed += amount;
    if (state.budgetLimit > 0 && state.budgetUsed > state.budgetLimit * BUDGET_ALERT_RATIO) {
      console.log(`[CIRCUIT BREAKER] ALERT to Kiri: Budget ${state.budgetUsed} exceeded 20% of limit ${state.budgetLimit} within 1h window`);
    }
  },

  setBudgetLimit(limit) {
    state.budgetLimit = limit;
  },

  isOpen() {
    if (state.cooldownUntil && Date.now() < state.cooldownUntil) return true;
    if (state.cooldownUntil && Date.now() >= state.cooldownUntil) {
      state.cooldownUntil = null;
      state.consecutiveFailures = 0;
    }
    return false;
  },

  reset() {
    state.consecutiveFailures = 0;
    state.cooldownUntil = null;
    state.budgetUsed = 0;
    state.windowStart = Date.now();
  },

  getStatus() {
    return {
      is_open: circuitBreaker.isOpen(),
      consecutive_failures: state.consecutiveFailures,
      cooldown_until: state.cooldownUntil ? new Date(state.cooldownUntil).toISOString() : null,
      budget_used: state.budgetUsed,
      budget_limit: state.budgetLimit
    };
  }
};

module.exports = { circuitBreaker };
