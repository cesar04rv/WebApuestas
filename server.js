const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const session = require("express-session");

const app = express();
const PORT = 3000;

// ===================== CONFIG =====================
// ⚠️ Cambia estas credenciales antes de desplegar
const ADMIN_USER = "admin";
const ADMIN_PASS = "quiniela2025";

app.use(bodyParser.json());
app.use(session({
  secret: "quiniela-secret-key-2025",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // sesión de 8 horas
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

// ===================== DB =====================
const db = new sqlite3.Database("./database.db");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    order_position INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS weeks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match TEXT,
    match_date TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    real_result TEXT,
    pot INTEGER DEFAULT 0,
    next_pot INTEGER DEFAULT 0,
    weekly_amount INTEGER DEFAULT 0,
    finished INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    week_id INTEGER,
    player_id INTEGER,
    result TEXT,
    UNIQUE(week_id, result),
    UNIQUE(week_id, player_id)
  )`);

  // Migraciones para BD existentes
  ["weekly_amount", "next_pot", "match_date", "created_at"].forEach(col => {
    const def = col === "created_at" ? "TEXT" : col.includes("amount") || col.includes("pot") ? "INTEGER DEFAULT 0" : "TEXT";
    db.run(`ALTER TABLE weeks ADD COLUMN ${col} ${def}`, () => {});
  });
});

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
app.post("/add-player", (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nombre inválido" });

  db.get("SELECT COUNT(*) as count FROM players", (err, row) => {
    const position = (row?.count || 0) + 1;
    db.run("INSERT INTO players (name, order_position) VALUES (?, ?)", [name.trim(), position], (err) => {
      if (err) return res.status(400).json({ error: "Jugador ya existe" });
      res.json({ success: true });
    });
  });
});

app.get("/players", (req, res) => {
  db.all("SELECT * FROM players ORDER BY order_position ASC", (err, rows) => res.json(rows || []));
});

app.post("/reorder-players", (req, res) => {
  const { orders } = req.body;
  const stmt = db.prepare("UPDATE players SET order_position = ? WHERE id = ?");
  db.serialize(() => {
    orders.forEach(p => stmt.run(p.order_position, p.id));
    stmt.finalize();
    res.json({ success: true });
  });
});

// ===================== WEEKS =====================
app.post("/new-week", (req, res) => {
  const { match, match_date } = req.body;
  if (!match?.trim()) return res.status(400).json({ error: "Partido inválido" });

  db.get("SELECT next_pot FROM weeks WHERE finished = 1 ORDER BY id DESC LIMIT 1", (err, last) => {
    const pot = last?.next_pot || 0;
    const now = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });

    db.run(
      "INSERT INTO weeks (match, match_date, created_at, pot, finished) VALUES (?, ?, ?, ?, 0)",
      [match.trim(), match_date || null, now, pot],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  });
});

app.get("/current-week", (req, res) => {
  db.get("SELECT * FROM weeks WHERE finished = 0 ORDER BY id DESC LIMIT 1", (err, row) => res.json(row || null));
});

app.post("/edit-week", (req, res) => {
  const { week_id, match, match_date } = req.body;
  if (!week_id || !match?.trim()) return res.status(400).json({ error: "Datos inválidos" });

  db.run(
    "UPDATE weeks SET match = ?, match_date = ? WHERE id = ? AND finished = 0",
    [match.trim(), match_date || null, week_id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Semana no encontrada o ya cerrada" });

      db.run("DELETE FROM predictions WHERE week_id = ?", [week_id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    }
  );
});

app.post("/delete-week", (req, res) => {
  const { week_id } = req.body;
  if (!week_id) return res.status(400).json({ error: "ID requerido" });

  db.run("DELETE FROM predictions WHERE week_id = ?", [week_id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    db.run("DELETE FROM weeks WHERE id = ? AND finished = 0", [week_id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Semana no encontrada o ya cerrada" });
      res.json({ success: true });
    });
  });
});

// ===================== PREDICTIONS =====================
app.get("/predictions/:week_id", (req, res) => {
  db.all("SELECT * FROM predictions WHERE week_id = ?", [req.params.week_id], (err, rows) => res.json(rows || []));
});

app.post("/predict", (req, res) => {
  const { week_id, player_id, result } = req.body;
  if (!week_id || !player_id || !result) return res.status(400).json({ error: "Datos incompletos" });

  db.all("SELECT * FROM players ORDER BY order_position ASC", (err, players) => {
    if (!players?.length) return res.status(400).json({ error: "No hay jugadores creados" });

    db.all("SELECT * FROM predictions WHERE week_id = ? ORDER BY id ASC", [week_id], (err, predictions) => {
      const expectedPlayer = players[predictions.length % players.length].id;
      if (parseInt(player_id) !== expectedPlayer) return res.status(400).json({ error: "No es tu turno" });

      db.run("INSERT INTO predictions (week_id, player_id, result) VALUES (?, ?, ?)", [week_id, player_id, result.trim()], (err) => {
        if (err) return res.status(400).json({ error: "Resultado ya elegido o jugador ya apostó" });
        res.json({ success: true });
      });
    });
  });
});

// ===================== CLOSE WEEK =====================
app.post("/close-week", (req, res) => {
  const { week_id, real_result, weekly_amount } = req.body;
  if (!week_id || !real_result) return res.status(400).json({ message: "Faltan datos" });

  // Por defecto 1€ por persona si no se especifica
  const amountPerPerson = (weekly_amount !== undefined && weekly_amount !== "" && weekly_amount !== null)
    ? parseInt(weekly_amount)
    : 1;

  db.get("SELECT * FROM weeks WHERE id = ?", [week_id], (err, week) => {
    if (!week) return res.status(404).json({ message: "Semana no encontrada" });

    db.get("SELECT COUNT(*) as count FROM players", (err, row) => {
      const totalPlayers = row.count;
      const contribution = amountPerPerson * totalPlayers;
      const newPot = (week.pot || 0) + contribution;

      db.all("SELECT * FROM predictions WHERE week_id = ?", [week_id], (err, predictions) => {
        const winners = predictions.filter(p => p.result === real_result.trim());
        const hasWinner = winners.length > 0;
        const nextPot = hasWinner ? 0 : newPot;

        db.run(
          "UPDATE weeks SET real_result = ?, weekly_amount = ?, pot = ?, next_pot = ?, finished = 1 WHERE id = ?",
          [real_result.trim(), amountPerPerson, newPot, nextPot, week_id],
          (err) => {
            if (err) return res.status(500).json({ message: err.message });

            if (hasWinner && winners.length === 1) {
              // Un solo ganador: se coloca último, los demás rotan hacia arriba manteniendo orden relativo
              db.all("SELECT * FROM players ORDER BY order_position ASC", (err, allPlayers) => {
                const winnerId = winners[0].player_id;
                const nonWinners = allPlayers.filter(p => p.id !== winnerId);
                const winnerPlayer = allPlayers.find(p => p.id === winnerId);
                // No-ganadores suben en orden, ganador al final
                const newOrder = [...nonWinners, winnerPlayer];
                db.serialize(() => newOrder.forEach((p, i) => db.run("UPDATE players SET order_position = ? WHERE id = ?", [i + 1, p.id])));

                const winnerName = winnerPlayer?.name || "?";
                res.json({ message: `✅ Semana cerrada. Acertó: ${winnerName}. Bote: ${newPot}€`, winners: winnerName, pot: newPot });
              });
            } else {
              // Nadie acierta O 2+ ganadores: rotación secuencial (el primero pasa al último)
              db.all("SELECT * FROM players ORDER BY order_position ASC", (err, allPlayers) => {
                const first = allPlayers[0];
                const rest = allPlayers.slice(1);
                const newOrder = [...rest, first];
                db.serialize(() => newOrder.forEach((p, i) => db.run("UPDATE players SET order_position = ? WHERE id = ?", [i + 1, p.id])));

                if (hasWinner) {
                  // 2+ ganadores
                  const winnerNames = winners.map(w => allPlayers.find(p => p.id === w.player_id)?.name || "?").join(", ");
                  res.json({ message: `✅ Semana cerrada. Acertaron: ${winnerNames}. Bote: ${newPot}€`, winners: winnerNames, pot: newPot });
                } else {
                  res.json({ message: `❌ Nadie acertó. El bote sube a ${newPot}€`, winners: null, pot: newPot });
                }
              });
            }
          }
        );
      });
    });
  });
});

// ===================== HISTORY =====================
app.get("/history", (req, res) => {
  db.all(`
    SELECT w.*, GROUP_CONCAT(p.name) as winners
    FROM weeks w
    LEFT JOIN predictions pr ON pr.week_id = w.id AND pr.result = w.real_result
    LEFT JOIN players p ON p.id = pr.player_id
    WHERE w.finished = 1
    GROUP BY w.id
    ORDER BY w.id DESC LIMIT 30
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// ===================== RANKINGS =====================
app.get("/rankings", (req, res) => {
  db.all(`
    SELECT p.id, p.name,
      COUNT(pr.id) as total_predictions,
      SUM(CASE WHEN pr.result = w.real_result AND w.finished = 1 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN pr.result = w.real_result AND w.finished = 1 THEN w.pot ELSE 0 END) as money_won
    FROM players p
    LEFT JOIN predictions pr ON pr.player_id = p.id
    LEFT JOIN weeks w ON w.id = pr.week_id
    GROUP BY p.id ORDER BY wins DESC, money_won DESC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// ===================== START =====================
app.listen(PORT, () => {
  console.log(`✅ Servidor en http://localhost:${PORT}`);
  console.log(`🔐 Login: ${ADMIN_USER} / ${ADMIN_PASS}`);
});