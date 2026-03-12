const express = require('express');
const { body, validationResult } = require('express-validator');
const { query, run, get } = require('../db');
const { apiKeyAuth } = require('../middleware/auth');

const router = express.Router();

// All verify routes require auth
router.use(apiKeyAuth);

const verifyValidation = [
  body('task_id').isString().trim().notEmpty().withMessage('task_id is required'),
];

// POST /api/verify
router.post('/', verifyValidation, async (req, res) => {
  const valErrors = validationResult(req);
  if (!valErrors.isEmpty()) return res.status(400).json({ ok: false, errors: valErrors.array() });

  try {
    const { task_id, result } = req.body;

    const task = await get('SELECT * FROM tasks WHERE id = ?', [task_id]);
    if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

    const criteria = JSON.parse(task.success_criteria || '{}');
    const data = result || JSON.parse(task.result || '{}');
    const errors = [];

    // Stage 1: JSON Schema validation (basic type/existence checks)
    if (criteria.schema) {
      const schema = criteria.schema;
      if (schema.required && Array.isArray(schema.required)) {
        for (const field of schema.required) {
          if (data[field] === undefined || data[field] === null) {
            errors.push({ stage: 1, message: `Missing required field: ${field}` });
          }
        }
      }
      if (schema.properties) {
        for (const [key, spec] of Object.entries(schema.properties)) {
          if (data[key] !== undefined && spec.type) {
            const actualType = Array.isArray(data[key]) ? 'array' : typeof data[key];
            if (actualType !== spec.type) {
              errors.push({ stage: 1, message: `Field ${key}: expected ${spec.type}, got ${actualType}` });
            }
          }
        }
      }
    }

    // Stage 2: Rule-based checks
    if (criteria.rules && Array.isArray(criteria.rules)) {
      for (const rule of criteria.rules) {
        const val = data[rule.field];
        switch (rule.op) {
          case 'exists':
            if (val === undefined || val === null) errors.push({ stage: 2, message: `Field ${rule.field} must exist` });
            break;
          case 'min_length':
            if (!Array.isArray(val) || val.length < rule.value) errors.push({ stage: 2, message: `Field ${rule.field} must have at least ${rule.value} items` });
            break;
          case 'equals':
            if (val !== rule.value) errors.push({ stage: 2, message: `Field ${rule.field} must equal ${rule.value}` });
            break;
          case 'gt':
            if (typeof val !== 'number' || val <= rule.value) errors.push({ stage: 2, message: `Field ${rule.field} must be > ${rule.value}` });
            break;
          case 'lt':
            if (typeof val !== 'number' || val >= rule.value) errors.push({ stage: 2, message: `Field ${rule.field} must be < ${rule.value}` });
            break;
          case 'regex':
            if (typeof val !== 'string' || !new RegExp(rule.value).test(val)) errors.push({ stage: 2, message: `Field ${rule.field} must match pattern ${rule.value}` });
            break;
        }
      }
    }

    const passed = errors.length === 0;
    res.json({ ok: true, passed, errors, stages_checked: [1, 2] });
  } catch (err) {
    console.error('[verify] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

module.exports = router;
