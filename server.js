const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 🔥 SUPABASE CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ── HELPER ─────────────────────────────────────────────────────
function curMonthStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// ── MIDDLEWARE ─────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── INIT (standart xodimlar) ───────────────────────────────────
async function init() {
  const { rows } = await pool.query('SELECT COUNT(*) FROM employees');
  if (parseInt(rows[0].count) === 0) {
    const names = ['AYUBXON','ELDORJON','RAMIZXON','SHAXZODBEK','ABDUBOSIT','DIYORBEK','JAHONGIR'];
    for (let i = 0; i < names.length; i++) {
      await pool.query(
        'INSERT INTO employees (id, name, role, color_idx) VALUES ($1,$2,$3,$4)',
        ['emp_' + i, names[i], 'Ofis xodimi', i]
      );
    }
    console.log("✅ Standart xodimlar qo'shildi");
  }
}
init();

// ── XODIMLAR ───────────────────────────────────────────────────
app.get('/api/employees', async (req, res) => {
  const month = req.query.month || curMonthStr();

  const { rows } = await pool.query(`
    SELECT e.*, COALESCE(ms.score, 0) as score
    FROM employees e
    LEFT JOIN monthly_scores ms 
    ON ms.emp_id = e.id AND ms.month = $1
    ORDER BY score DESC, e.name ASC
  `, [month]);

  res.json(rows);
});

app.post('/api/employees', async (req, res) => {
  const { name, role } = req.body;
  if (!name) return res.status(400).json({ error: 'Ism kerak' });

  const id = 'emp_' + Date.now();
  const { rows } = await pool.query('SELECT COUNT(*) FROM employees');
  const ci = parseInt(rows[0].count);

  await pool.query(
    'INSERT INTO employees (id, name, role, color_idx) VALUES ($1,$2,$3,$4)',
    [id, name.toUpperCase(), role || 'Xodim', ci]
  );

  res.json({ id, name, role, score: 0 });
});

app.delete('/api/employees/:id', async (req, res) => {
  const id = req.params.id;

  await pool.query('DELETE FROM history WHERE emp_id = $1', [id]);
  await pool.query('DELETE FROM monthly_scores WHERE emp_id = $1', [id]);

  const result = await pool.query('DELETE FROM employees WHERE id = $1', [id]);

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Xodim topilmadi' });
  }

  res.json({ ok: true });
});

// ── HARAKATLAR ────────────────────────────────────────────────
app.post('/api/employees/:id/action', async (req, res) => {
  const { points, label, month } = req.body;
  if (points === undefined || !label) {
    return res.status(400).json({ error: 'points va label kerak' });
  }

  const targetMonth = month || curMonthStr();

  const emp = await pool.query('SELECT * FROM employees WHERE id = $1', [req.params.id]);
  if (emp.rowCount === 0) return res.status(404).json({ error: 'Xodim topilmadi' });

  // ensure row
  await pool.query(`
    INSERT INTO monthly_scores (emp_id, month, score)
    VALUES ($1, $2, 0)
    ON CONFLICT (emp_id, month) DO NOTHING
  `, [req.params.id, targetMonth]);

  const cur = await pool.query(
    'SELECT score FROM monthly_scores WHERE emp_id=$1 AND month=$2',
    [req.params.id, targetMonth]
  );

  const newScore = Math.max(0, cur.rows[0].score + points);

  await pool.query(
    'UPDATE monthly_scores SET score=$1 WHERE emp_id=$2 AND month=$3',
    [newScore, req.params.id, targetMonth]
  );

  await pool.query(
    'INSERT INTO history (emp_id, month, points, label) VALUES ($1,$2,$3,$4)',
    [req.params.id, targetMonth, points, label]
  );

  const updated = await pool.query(`
    SELECT e.*, COALESCE(ms.score,0) as score
    FROM employees e
    LEFT JOIN monthly_scores ms ON ms.emp_id=e.id AND ms.month=$1
    WHERE e.id=$2
  `, [targetMonth, req.params.id]);

  res.json(updated.rows[0]);
});

// ── TARIX ─────────────────────────────────────────────────────
app.get('/api/employees/:id/history', async (req, res) => {
  const month = req.query.month || curMonthStr();

  const { rows } = await pool.query(
    'SELECT * FROM history WHERE emp_id=$1 AND month=$2 ORDER BY created_at DESC LIMIT 100',
    [req.params.id, month]
  );

  res.json(rows);
});

// ── STATISTIKA ────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  const month = req.query.month || curMonthStr();

  const total = await pool.query('SELECT COUNT(*) FROM employees');

  const agg = await pool.query(`
    SELECT COALESCE(SUM(ms.score),0) as totalScore,
           COALESCE(MAX(ms.score),0) as top
    FROM employees e
    LEFT JOIN monthly_scores ms ON ms.emp_id=e.id AND ms.month=$1
  `, [month]);

  const above120 = await pool.query(`
    SELECT COUNT(*) FROM employees e
    LEFT JOIN monthly_scores ms ON ms.emp_id=e.id AND ms.month=$1
    WHERE COALESCE(ms.score,0) >= 120
  `, [month]);

  res.json({
    total: parseInt(total.rows[0].count),
    totalScore: agg.rows[0].totalscore,
    top: agg.rows[0].top,
    above120: parseInt(above120.rows[0].count)
  });
});

// ── OYLAR ─────────────────────────────────────────────────────
app.get('/api/months', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT DISTINCT month FROM monthly_scores
    WHERE score > 0
    ORDER BY month DESC
  `);

  const cur = curMonthStr();
  const months = rows.map(r => r.month);
  if (!months.includes(cur)) months.unshift(cur);

  res.json(months);
});

// ── RESET ─────────────────────────────────────────────────────
app.post('/api/reset', async (req, res) => {
  const month = req.body.month || curMonthStr();

  await pool.query('DELETE FROM monthly_scores WHERE month=$1', [month]);
  await pool.query('DELETE FROM history WHERE month=$1', [month]);

  res.json({ ok: true });
});

// ── FRONTEND ──────────────────────────────────────────────────
app.get('*', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});