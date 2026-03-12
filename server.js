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
  const openPaths = ["/api/login", "/api/me", "/login.html", "/login.css", "/login.js", "/logo.png", "/logo.jpeg"];
  const openExtensions = [".png", ".jpg", ".jpeg", ".ico", ".svg", ".webp", ".css", ".js", ".woff", ".woff2"];
  const isOpenAsset = openExtensions.some(ext => req.path.endsWith(ext));
  if (openPaths.includes(req.path) || isOpenAsset || req.session.authenticated) return next();
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
      order_position INTEGER,
      active INTEGER DEFAULT 1
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
      finished INTEGER DEFAULT 0,
      round_number TEXT,
      excluded_players TEXT DEFAULT ''
    )
  `);
  // Migrate existing tables if columns missing
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS active INTEGER DEFAULT 1`);
  await pool.query(`ALTER TABLE weeks ADD COLUMN IF NOT EXISTS round_number TEXT`);
  await pool.query(`ALTER TABLE weeks ADD COLUMN IF NOT EXISTS excluded_players TEXT DEFAULT ''`);
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
    await pool.query("INSERT INTO players (name, order_position, active) VALUES ($1, $2, 1)", [name.trim(), position]);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Jugador ya existe" });
  }
});

app.get("/players", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM players ORDER BY order_position ASC");
  res.json(rows);
});

app.post("/deactivate-player", async (req, res) => {
  const { player_id } = req.body;
  if (!player_id) return res.status(400).json({ error: "ID requerido" });
  try {
    await pool.query("UPDATE players SET active = 0 WHERE id = $1", [player_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/reactivate-player", async (req, res) => {
  const { player_id } = req.body;
  if (!player_id) return res.status(400).json({ error: "ID requerido" });
  try {
    await pool.query("UPDATE players SET active = 1 WHERE id = $1", [player_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  const { match, match_date, round_number, excluded_players } = req.body;
  if (!match?.trim()) return res.status(400).json({ error: "Partido inválido" });
  try {
    const { rows } = await pool.query("SELECT next_pot FROM weeks WHERE finished = 1 ORDER BY id DESC LIMIT 1");
    const pot = rows[0]?.next_pot || 0;
    const now = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
    const excludedStr = Array.isArray(excluded_players) ? excluded_players.join(",") : (excluded_players || "");
    await pool.query(
      "INSERT INTO weeks (match, match_date, created_at, pot, finished, round_number, excluded_players) VALUES ($1, $2, $3, $4, 0, $5, $6)",
      [match.trim(), match_date || null, now, pot, round_number || null, excludedStr]
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
  const { week_id, match, match_date, round_number, excluded_players } = req.body;
  if (!week_id || !match?.trim()) return res.status(400).json({ error: "Datos inválidos" });
  try {
    const excludedStr = Array.isArray(excluded_players) ? excluded_players.join(",") : (excluded_players || "");
    const { rowCount } = await pool.query(
      "UPDATE weeks SET match = $1, match_date = $2, round_number = $3, excluded_players = $4 WHERE id = $5 AND finished = 0",
      [match.trim(), match_date || null, round_number || null, excludedStr, week_id]
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
    const { rows: weekRows } = await pool.query("SELECT * FROM weeks WHERE id = $1", [week_id]);
    if (!weekRows.length) return res.status(404).json({ error: "Semana no encontrada" });
    const week = weekRows[0];
    const excludedIds = week.excluded_players ? week.excluded_players.split(",").filter(Boolean).map(Number) : [];

    const { rows: players } = await pool.query("SELECT * FROM players WHERE active = 1 AND id != ALL($1) ORDER BY order_position ASC", [excludedIds.length ? excludedIds : [0]]);
    if (!players.length) return res.status(400).json({ error: "No hay jugadores activos" });
    const { rows: preds } = await pool.query("SELECT * FROM predictions WHERE week_id = $1 ORDER BY id ASC", [week_id]);
    const playerIdsWhoBet = new Set(preds.map(p => p.player_id));
    const nextPlayer = players.find(p => !playerIdsWhoBet.has(p.id));
    if (!nextPlayer) return res.status(400).json({ error: "Todos ya han apostado" });
    if (parseInt(player_id) !== nextPlayer.id) return res.status(400).json({ error: "No es tu turno" });
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
    const excludedIds = week.excluded_players ? week.excluded_players.split(",").filter(Boolean).map(Number) : [];

    // Only count active, non-excluded players for pot
    const { rows: activePlayers } = await pool.query(
      "SELECT * FROM players WHERE active = 1 AND id != ALL($1) ORDER BY order_position ASC",
      [excludedIds.length ? excludedIds : [0]]
    );
    const totalPlayers = activePlayers.length;
    const newPot = (week.pot || 0) + amountPerPerson * totalPlayers;

    const { rows: preds } = await pool.query("SELECT * FROM predictions WHERE week_id = $1", [week_id]);
    const winners = preds.filter(p => p.result === real_result.trim());
    const hasWinner = winners.length > 0;
    const nextPot = hasWinner ? 0 : newPot;

    await pool.query(
      "UPDATE weeks SET real_result = $1, weekly_amount = $2, pot = $3, next_pot = $4, finished = 1 WHERE id = $5",
      [real_result.trim(), amountPerPerson, newPot, nextPot, week_id]
    );

    // Rotación: solo entre jugadores activos no excluidos
    const { rows: allActivePlayers } = await pool.query(
      "SELECT * FROM players WHERE active = 1 AND id != ALL($1) ORDER BY order_position ASC",
      [excludedIds.length ? excludedIds : [0]]
    );
    const newOrder = [...allActivePlayers.slice(1), allActivePlayers[0]];
    for (let i = 0; i < newOrder.length; i++) {
      await pool.query("UPDATE players SET order_position = $1 WHERE id = $2", [i + 1, newOrder[i].id]);
    }

    if (hasWinner) {
      const { rows: allPlayers } = await pool.query("SELECT * FROM players");
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
    // Get all players (active and inactive for historical records)
    const { rows: allPlayers } = await pool.query("SELECT * FROM players ORDER BY order_position ASC, id ASC");
    // Get all finished weeks with excluded_players info
    const { rows: finishedWeeks } = await pool.query("SELECT * FROM weeks WHERE finished = 1");
    // Get all predictions with week result
    const { rows: allPreds } = await pool.query(`
      SELECT pr.*, w.real_result, w.pot, w.finished, w.excluded_players
      FROM predictions pr
      JOIN weeks w ON w.id = pr.week_id
      WHERE w.finished = 1
    `);

    const rankings = allPlayers.map(player => {
      // Weeks where the player was NOT excluded and was active at the time
      // (we approximate "active at time" as: they have a prediction OR they were not excluded)
      const activeWeeks = finishedWeeks.filter(w => {
        const excluded = w.excluded_players ? w.excluded_players.split(",").filter(Boolean).map(Number) : [];
        return !excluded.includes(player.id);
      });

      const playerPreds = allPreds.filter(pr => pr.player_id === player.id);
      const wins = playerPreds.filter(pr => pr.result === pr.real_result).length;
      const moneyWon = playerPreds
        .filter(pr => pr.result === pr.real_result)
        .reduce((sum, pr) => sum + (parseInt(pr.pot) || 0), 0);

      // total_predictions = weeks player actually participated (had a prediction)
      const totalPredictions = playerPreds.length;

      return {
        id: player.id,
        name: player.name,
        active: player.active,
        total_predictions: totalPredictions,
        active_weeks: activeWeeks.length,
        wins,
        money_won: moneyWon
      };
    });

    rankings.sort((a, b) => b.wins - a.wins || (b.money_won || 0) - (a.money_won || 0));
    res.json(rankings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== WEEK DETAIL LOG =====================
app.get("/week-log", async (req, res) => {
  try {
    const { rows: weeks } = await pool.query(
      "SELECT * FROM weeks WHERE finished = 1 ORDER BY id DESC LIMIT 50"
    );
    const { rows: allPlayers } = await pool.query("SELECT * FROM players ORDER BY order_position ASC");

    const result = [];
    for (const w of weeks) {
      const { rows: preds } = await pool.query(`
        SELECT pr.*, p.name as player_name
        FROM predictions pr
        JOIN players p ON p.id = pr.player_id
        WHERE pr.week_id = $1
        ORDER BY pr.id ASC
      `, [w.id]);

      const excludedIds = w.excluded_players
        ? w.excluded_players.split(",").filter(Boolean).map(Number)
        : [];
      const excludedNames = excludedIds
        .map(id => allPlayers.find(p => p.id === id)?.name)
        .filter(Boolean);

      result.push({
        id: w.id,
        match: w.match,
        round_number: w.round_number,
        match_date: w.match_date,
        real_result: w.real_result,
        pot: w.pot,
        weekly_amount: w.weekly_amount,
        home_team_id: w.home_team_id,
        away_team_id: w.away_team_id,
        excluded: excludedNames,
        predictions: preds.map((pr, i) => ({
          order: i + 1,
          player_name: pr.player_name,
          result: pr.result,
          correct: pr.result === w.real_result
        }))
      });
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== PAYMENTS =====================
app.get("/payments/:week_id", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM payments WHERE week_id = $1",
      [req.params.week_id]
    );
    res.json(rows);
  } catch (err) {
    // Table might not exist yet
    res.json([]);
  }
});

app.post("/payment-toggle", async (req, res) => {
  const { week_id, player_id, paid } = req.body;
  if (!week_id || !player_id) return res.status(400).json({ error: "Datos incompletos" });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        week_id INTEGER,
        player_id INTEGER,
        paid INTEGER DEFAULT 0,
        UNIQUE(week_id, player_id)
      )
    `);
    await pool.query(`
      INSERT INTO payments (week_id, player_id, paid) VALUES ($1, $2, $3)
      ON CONFLICT (week_id, player_id) DO UPDATE SET paid = $3
    `, [week_id, player_id, paid ? 1 : 0]);
    res.json({ success: true });
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