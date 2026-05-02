require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ⚡ BETTER POOL CONFIG (MUHIM)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  keepAlive: true
});

// ── HELPERS ─────────────────────────────
function curMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── MIDDLEWARE ──────────────────────────
app.use(express.json());
app.use(express.static(__dirname));

// ── SAFE INIT (optimized + single query) ─
async function init() {
  try {
    const { rows } = await pool.query('SELECT COUNT(*)::int FROM employees');
    const count = rows[0].count;

    if (count === 0) {
      const names = [
        'AYUBXON','ELDORJON','RAMIZXON',
        'SHAXZODBEK','ABDUBOSIT','DIYORBEK','JAHONGIR'
      ];

      const values = names.map((n, i) =>
        `('emp_${i}', '${n}', 'Ofis xodimi', ${i})`
      ).join(',');

      await pool.query(`
        INSERT INTO employees (id, name, role, color_idx)
        VALUES ${values}
      `);

      console.log("✅ Standart xodimlar qo'shildi");
    }
  } catch (err) {
    console.error("INIT ERROR:", err.message);
  }
}

init();

// ── EMPLOYEES (FAST QUERY) ───────────────
app.get('/api/employees', async (req, res) => {
  try {
    const month = req.query.month || curMonthStr();

    const { rows } = await pool.query(`
      SELECT 
        e.id, e.name, e.role, e.color_idx,
        COALESCE(ms.score, 0) AS score
      FROM employees e
      LEFT JOIN monthly_scores ms 
        ON ms.emp_id = e.id AND ms.month = $1
      ORDER BY score DESC, e.name ASC
    `, [month]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── CREATE EMPLOYEE (optimized count) ─────
app.post('/api/employees', async (req, res) => {
  try {
    const { name, role } = req.body;
    if (!name) return res.status(400).json({ error: 'Ism kerak' });

    const id = `emp_${Date.now()}`;

    const { rows } = await pool.query(
      'SELECT COUNT(*)::int FROM employees'
    );

    await pool.query(`
      INSERT INTO employees (id, name, role, color_idx)
      VALUES ($1, $2, $3, $4)
    `, [
      id,
      name.toUpperCase(),
      role || 'Xodim',
      rows[0].count
    ]);

    res.json({ id, name, role, score: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE EMPLOYEE (parallel deletes) ───
app.delete('/api/employees/:id', async (req, res) => {
  try {
    const id = req.params.id;

    await Promise.all([
      pool.query('DELETE FROM history WHERE emp_id = $1', [id]),
      pool.query('DELETE FROM monthly_scores WHERE emp_id = $1', [id]),
      pool.query('DELETE FROM employees WHERE id = $1', [id])
    ]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ACTION (OPTIMIZED 1 LESS QUERY) ──────
app.post('/api/employees/:id/action', async (req, res) => {
  try {
    const { points, label, month } = req.body;
    if (points === undefined || !label) {
      return res.status(400).json({ error: 'points va label kerak' });
    }

    const targetMonth = month || curMonthStr();
    const empId = req.params.id;

    // ensure + update in single step
    await pool.query(`
      INSERT INTO monthly_scores (emp_id, month, score)
      VALUES ($1, $2, $3)
      ON CONFLICT (emp_id, month)
      DO UPDATE SET score = monthly_scores.score + $3
    `, [empId, targetMonth, points]);

    await pool.query(`
      INSERT INTO history (emp_id, month, points, label)
      VALUES ($1, $2, $3, $4)
    `, [empId, targetMonth, points, label]);

    const { rows } = await pool.query(`
      SELECT e.id, e.name, e.role, e.color_idx,
             COALESCE(ms.score,0) AS score
      FROM employees e
      LEFT JOIN monthly_scores ms
        ON ms.emp_id = e.id AND ms.month = $1
      WHERE e.id = $2
    `, [targetMonth, empId]);

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── HISTORY (light query) ────────────────
app.get('/api/employees/:id/history', async (req, res) => {
  try {
    const month = req.query.month || curMonthStr();

    const { rows } = await pool.query(`
      SELECT id, emp_id, month, points, label, created_at
      FROM history
      WHERE emp_id=$1 AND month=$2
      ORDER BY created_at DESC
      LIMIT 100
    `, [req.params.id, month]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── STATS (optimized single scan idea) ───
app.get('/api/stats', async (req, res) => {
  try {
    const month = req.query.month || curMonthStr();

    const { rows } = await pool.query(`
      SELECT 
        COUNT(e.id)::int AS total,
        COALESCE(SUM(ms.score),0)::int AS total_score,
        COALESCE(MAX(ms.score),0)::int AS top,
        COUNT(CASE WHEN COALESCE(ms.score,0) >= 120 THEN 1 END)::int AS above_120
      FROM employees e
      LEFT JOIN monthly_scores ms 
        ON ms.emp_id = e.id AND ms.month = $1
    `, [month]);

    const data = rows[0];

    res.json({
      total: data.total,
      totalScore: data.total_score,
      top: data.top,
      above120: data.above_120
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MONTHS ──────────────────────────────
app.get('/api/months', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT month 
      FROM monthly_scores
      ORDER BY month DESC
    `);

    const cur = curMonthStr();
    const months = rows.map(r => r.month);

    if (!months.includes(cur)) months.unshift(cur);

    res.json(months);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE HISTORY ITEM ─────────────────
app.delete('/api/history/:id', async (req, res) => {
  try {
    const histId = req.params.id;

    // Get history item to know how many points to reverse
    const { rows: histRows } = await pool.query(
      'SELECT * FROM history WHERE id = $1', [histId]
    );
    if (!histRows.length) return res.status(404).json({ error: 'Topilmadi' });

    const h = histRows[0];

    // Delete history record
    await pool.query('DELETE FROM history WHERE id = $1', [histId]);

    // Reverse the points in monthly_scores
    await pool.query(`
      UPDATE monthly_scores
      SET score = score - $1
      WHERE emp_id = $2 AND month = $3
    `, [h.points, h.emp_id, h.month]);

    res.json({ ok: true, reversed: h.points });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── RESET ───────────────────────────────
app.post('/api/reset', async (req, res) => {
  try {
    const month = req.body.month || curMonthStr();

    await Promise.all([
      pool.query('DELETE FROM monthly_scores WHERE month=$1', [month]),
      pool.query('DELETE FROM history WHERE month=$1', [month])
    ]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FRONTEND ────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── START ───────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});