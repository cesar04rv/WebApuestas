require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const bodyParser = require("body-parser");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

// ===================== CONFIG =====================
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "quiniela2025";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || "quiniela-secret-key-2025",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

// Middleware de autenticación
app.use((req, res, next) => {
  const openPaths = ["/api/login", "/api/me", "/login.html", "/login.css", "/login.js"];
  if (openPaths.includes(req.path) || req.session.authenticated) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "No autenticado" });
  if (req.accepts("html")) return res.redirect("/login.html");
  res.status(401).json({ error: "No autenticado" });
});

app.use(express.static("public"));

// ===================== DB INIT =====================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      order_position INTEGER
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weeks (
      id SERIAL PRIMARY KEY,
      match TEXT,
      match_date TEXT,
      created_at TEXT,
      real_result TEXT,
      pot INTEGER DEFAULT 0,
      next_pot INTEGER DEFAULT 0,
      weekly_amount INTEGER DEFAULT 0,
      finished INTEGER DEFAULT 0
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS predictions (
      id SERIAL PRIMARY KEY,
      week_id INTEGER,
      player_id INTEGER,
      result TEXT,
      UNIQUE(week_id, result),
      UNIQUE(week_id, player_id)
    )
  `);
  console.log("✅ Base de datos lista");
}

// ===================== AUTH =====================
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    req.session.authenticated = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Usuario o contraseña incorrectos" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get("/api/me", (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// ===================== PLAYERS =====================
app.post("/add-player", async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nombre inválido" });
  try {
    const { rows } = await pool.query("SELECT COUNT(*) as count FROM players");
    const position = parseInt(rows[0].count) + 1;
    await pool.query("INSERT INTO players (name, order_position) VALUES ($1, $2)", [name.trim(), position]);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Jugador ya existe" });
  }
});

app.get("/players", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM players ORDER BY order_position ASC");
  res.json(rows);
});

app.post("/reorder-players", async (req, res) => {
  const { orders } = req.body;
  try {
    for (const p of orders) {
      await pool.query("UPDATE players SET order_position = $1 WHERE id = $2", [p.order_position, p.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== WEEKS =====================
app.post("/new-week", async (req, res) => {
  const { match, match_date } = req.body;
  if (!match?.trim()) return res.status(400).json({ error: "Partido inválido" });
  try {
    const { rows } = await pool.query("SELECT next_pot FROM weeks WHERE finished = 1 ORDER BY id DESC LIMIT 1");
    const pot = rows[0]?.next_pot || 0;
    const now = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
    await pool.query(
      "INSERT INTO weeks (match, match_date, created_at, pot, finished) VALUES ($1, $2, $3, $4, 0)",
      [match.trim(), match_date || null, now, pot]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/current-week", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM weeks WHERE finished = 0 ORDER BY id DESC LIMIT 1");
  res.json(rows[0] || null);
});

app.post("/edit-week", async (req, res) => {
  const { week_id, match, match_date } = req.body;
  if (!week_id || !match?.trim()) return res.status(400).json({ error: "Datos inválidos" });
  try {
    const { rowCount } = await pool.query(
      "UPDATE weeks SET match = $1, match_date = $2 WHERE id = $3 AND finished = 0",
      [match.trim(), match_date || null, week_id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Semana no encontrada o ya cerrada" });
    await pool.query("DELETE FROM predictions WHERE week_id = $1", [week_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/delete-week", async (req, res) => {
  const { week_id } = req.body;
  if (!week_id) return res.status(400).json({ error: "ID requerido" });
  try {
    await pool.query("DELETE FROM predictions WHERE week_id = $1", [week_id]);
    const { rowCount } = await pool.query("DELETE FROM weeks WHERE id = $1 AND finished = 0", [week_id]);
    if (rowCount === 0) return res.status(404).json({ error: "Semana no encontrada o ya cerrada" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== PREDICTIONS =====================
app.get("/predictions/:week_id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM predictions WHERE week_id = $1", [req.params.week_id]);
  res.json(rows);
});

app.post("/predict", async (req, res) => {
  const { week_id, player_id, result } = req.body;
  if (!week_id || !player_id || !result) return res.status(400).json({ error: "Datos incompletos" });
  try {
    const { rows: players } = await pool.query("SELECT * FROM players ORDER BY order_position ASC");
    if (!players.length) return res.status(400).json({ error: "No hay jugadores creados" });
    const { rows: preds } = await pool.query("SELECT * FROM predictions WHERE week_id = $1 ORDER BY id ASC", [week_id]);
    const expectedPlayer = players[preds.length % players.length].id;
    if (parseInt(player_id) !== expectedPlayer) return res.status(400).json({ error: "No es tu turno" });
    await pool.query("INSERT INTO predictions (week_id, player_id, result) VALUES ($1, $2, $3)", [week_id, player_id, result.trim()]);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Resultado ya elegido o jugador ya apostó" });
  }
});

// ===================== CLOSE WEEK =====================
app.post("/close-week", async (req, res) => {
  const { week_id, real_result, weekly_amount } = req.body;
  if (!week_id || !real_result) return res.status(400).json({ message: "Faltan datos" });

  const amountPerPerson = (weekly_amount !== undefined && weekly_amount !== "" && weekly_amount !== null && !isNaN(parseInt(weekly_amount)))
    ? parseInt(weekly_amount) : 1;

  try {
    const { rows: weekRows } = await pool.query("SELECT * FROM weeks WHERE id = $1", [week_id]);
    if (!weekRows.length) return res.status(404).json({ message: "Semana no encontrada" });
    const week = weekRows[0];

    const { rows: countRows } = await pool.query("SELECT COUNT(*) as count FROM players");
    const totalPlayers = parseInt(countRows[0].count);
    const newPot = (week.pot || 0) + amountPerPerson * totalPlayers;

    const { rows: preds } = await pool.query("SELECT * FROM predictions WHERE week_id = $1", [week_id]);
    const winners = preds.filter(p => p.result === real_result.trim());
    const hasWinner = winners.length > 0;
    const nextPot = hasWinner ? 0 : newPot;

    await pool.query(
      "UPDATE weeks SET real_result = $1, weekly_amount = $2, pot = $3, next_pot = $4, finished = 1 WHERE id = $5",
      [real_result.trim(), amountPerPerson, newPot, nextPot, week_id]
    );

    // Rotación: el primero pasa al último
    const { rows: allPlayers } = await pool.query("SELECT * FROM players ORDER BY order_position ASC");
    const newOrder = [...allPlayers.slice(1), allPlayers[0]];
    for (let i = 0; i < newOrder.length; i++) {
      await pool.query("UPDATE players SET order_position = $1 WHERE id = $2", [i + 1, newOrder[i].id]);
    }

    if (hasWinner) {
      const winnerNames = winners.map(w => allPlayers.find(p => p.id === w.player_id)?.name || "?").join(", ");
      res.json({ message: `✅ Semana cerrada. Acertaron: ${winnerNames}. Bote: ${newPot}€`, winners: winnerNames, pot: newPot });
    } else {
      res.json({ message: `❌ Nadie acertó. El bote sube a ${newPot}€`, winners: null, pot: newPot });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===================== HISTORY =====================
app.get("/history", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT w.*, STRING_AGG(p.name, ',') as winners
      FROM weeks w
      LEFT JOIN predictions pr ON pr.week_id = w.id AND pr.result = w.real_result
      LEFT JOIN players p ON p.id = pr.player_id
      WHERE w.finished = 1
      GROUP BY w.id
      ORDER BY w.id DESC LIMIT 30
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== RANKINGS =====================
app.get("/rankings", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.name,
        COUNT(pr.id) as total_predictions,
        SUM(CASE WHEN pr.result = w.real_result AND w.finished = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN pr.result = w.real_result AND w.finished = 1 THEN w.pot ELSE 0 END) as money_won
      FROM players p
      LEFT JOIN predictions pr ON pr.player_id = p.id
      LEFT JOIN weeks w ON w.id = pr.week_id
      GROUP BY p.id ORDER BY wins DESC, money_won DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== BACKUP / RESTORE / RESET =====================
app.get("/api/export", async (req, res) => {
  try {
    const { rows: players } = await pool.query("SELECT * FROM players ORDER BY order_position ASC");
    const { rows: weeks } = await pool.query("SELECT * FROM weeks ORDER BY id ASC");
    const { rows: predictions } = await pool.query("SELECT * FROM predictions ORDER BY id ASC");
    const backup = { exported_at: new Date().toISOString(), version: 1, players, weeks, predictions };
    const filename = `porrids_backup_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    res.json(backup);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/import", async (req, res) => {
  const { players, weeks, predictions } = req.body;
  if (!players || !weeks || !predictions) return res.status(400).json({ error: "JSON inválido: faltan datos" });
  try {
    await pool.query("DELETE FROM predictions");
    await pool.query("DELETE FROM weeks");
    await pool.query("DELETE FROM players");

    for (const p of players) {
      await pool.query("INSERT INTO players (id, name, order_position) VALUES ($1, $2, $3)", [p.id, p.name, p.order_position]);
    }
    for (const w of weeks) {
      await pool.query(
        "INSERT INTO weeks (id, match, match_date, created_at, real_result, pot, next_pot, weekly_amount, finished) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [w.id, w.match, w.match_date || null, w.created_at || null, w.real_result || null, w.pot || 0, w.next_pot || 0, w.weekly_amount || 0, w.finished || 0]
      );
    }
    for (const p of predictions) {
      await pool.query("INSERT INTO predictions (id, week_id, player_id, result) VALUES ($1, $2, $3, $4)", [p.id, p.week_id, p.player_id, p.result]);
    }

    await pool.query("SELECT setval('players_id_seq', (SELECT MAX(id) FROM players))");
    await pool.query("SELECT setval('weeks_id_seq', (SELECT MAX(id) FROM weeks))");
    await pool.query("SELECT setval('predictions_id_seq', (SELECT MAX(id) FROM predictions))");

    res.json({ success: true, message: `Importados: ${players.length} jugadores, ${weeks.length} semanas, ${predictions.length} apuestas` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/reset", async (req, res) => {
  try {
    await pool.query("DELETE FROM predictions");
    await pool.query("DELETE FROM weeks");
    await pool.query("DELETE FROM players");
    await pool.query("ALTER SEQUENCE players_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE weeks_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE predictions_id_seq RESTART WITH 1");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== START =====================
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Servidor en http://localhost:${PORT}`);
    console.log(`🔐 Login: ${ADMIN_USER} / ${ADMIN_PASS}`);
  });
}).catch(err => {
  console.error("❌ Error conectando a la base de datos:", err);
  process.exit(1);
});