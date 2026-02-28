const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static("public"));

// ===================== DB SETUP =====================
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

  // Add weekly_amount column if upgrading from old DB
  db.run(`ALTER TABLE weeks ADD COLUMN weekly_amount INTEGER DEFAULT 0`, () => {});
  db.run(`ALTER TABLE weeks ADD COLUMN next_pot INTEGER DEFAULT 0`, () => {});
});

// ===================== PLAYERS =====================
app.post("/add-player", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Nombre inválido" });

  db.get("SELECT COUNT(*) as count FROM players", (err, row) => {
    const position = (row?.count || 0) + 1;
    db.run(
      "INSERT INTO players (name, order_position) VALUES (?, ?)",
      [name.trim(), position],
      (err) => {
        if (err) return res.status(400).json({ error: "Jugador ya existe" });
        res.json({ success: true });
      }
    );
  });
});

app.get("/players", (req, res) => {
  db.all("SELECT * FROM players ORDER BY order_position ASC", (err, rows) => {
    res.json(rows || []);
  });
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
  const { match } = req.body;
  if (!match || !match.trim()) return res.status(400).json({ error: "Partido inválido" });

  // Carry over pot from last week only if no winner
  db.get("SELECT next_pot, pot FROM weeks WHERE finished = 1 ORDER BY id DESC LIMIT 1", (err, lastWeek) => {
    const pot = lastWeek ? (lastWeek.next_pot ?? lastWeek.pot) : 0;

    db.run(
      "INSERT INTO weeks (match, pot, finished) VALUES (?, ?, 0)",
      [match.trim(), pot],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  });
});

app.get("/current-week", (req, res) => {
  db.get(
    "SELECT * FROM weeks WHERE finished = 0 ORDER BY id DESC LIMIT 1",
    (err, row) => res.json(row || null)
  );
});

// ===================== PREDICTIONS =====================
app.get("/predictions/:week_id", (req, res) => {
  db.all(
    "SELECT * FROM predictions WHERE week_id = ?",
    [req.params.week_id],
    (err, rows) => res.json(rows || [])
  );
});

app.post("/predict", (req, res) => {
  const { week_id, player_id, result } = req.body;

  if (!week_id || !player_id || !result) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  db.all("SELECT * FROM players ORDER BY order_position ASC", (err, players) => {
    if (!players || players.length === 0) {
      return res.status(400).json({ error: "No hay jugadores creados" });
    }

    db.all(
      "SELECT * FROM predictions WHERE week_id = ? ORDER BY id ASC",
      [week_id],
      (err, predictions) => {
        const expectedPlayer = players[predictions.length % players.length].id;

        if (parseInt(player_id) !== expectedPlayer) {
          return res.status(400).json({ error: "No es tu turno" });
        }

        db.run(
          "INSERT INTO predictions (week_id, player_id, result) VALUES (?, ?, ?)",
          [week_id, player_id, result.trim()],
          (err) => {
            if (err) return res.status(400).json({ error: "Resultado ya elegido o jugador ya apostó" });
            res.json({ success: true });
          }
        );
      }
    );
  });
});

// ===================== CLOSE WEEK =====================
app.post("/close-week", (req, res) => {
  const { week_id, real_result, weekly_amount } = req.body;

  if (!week_id || !real_result) {
    return res.status(400).json({ message: "Faltan datos" });
  }

  db.get("SELECT * FROM weeks WHERE id = ?", [week_id], (err, week) => {
    if (!week) return res.status(404).json({ message: "Semana no encontrada" });

    db.all("SELECT COUNT(*) as count FROM players", (err, rows) => {
      const totalPlayers = rows[0].count;
      const contribution = (parseInt(weekly_amount) || 0) * totalPlayers;
      const newPot = (week.pot || 0) + contribution;

      db.all("SELECT * FROM predictions WHERE week_id = ?", [week_id], (err, predictions) => {
        const winners = predictions.filter(p => p.result === real_result.trim());
        const hasWinner = winners.length > 0;

        // Si hay ganador → el bote de esta semana se reparte (guarda el valor ganado pero la siguiente empieza a 0)
        // Si no hay ganador → el bote se acumula a la siguiente semana
        const finalPot = newPot; // lo que se ganó / acumuló esta semana
        const nextPot = hasWinner ? 0 : newPot; // lo que arranca la siguiente semana

        db.run(
          "UPDATE weeks SET real_result = ?, weekly_amount = ?, pot = ?, next_pot = ?, finished = 1 WHERE id = ?",
          [real_result.trim(), parseInt(weekly_amount) || 0, finalPot, nextPot, week_id],
          (err) => {
            if (err) return res.status(500).json({ message: err.message });

            if (hasWinner) {
              // Move winners to last position (they pick last next week)
              db.all("SELECT * FROM players ORDER BY order_position ASC", (err, allPlayers) => {
                let maxPos = allPlayers.length;

                // Build new order: non-winners first (preserve relative order), winners at end
                const nonWinnerIds = new Set(winners.map(w => w.player_id));
                const nonWinners = allPlayers.filter(p => !nonWinnerIds.has(p.id));
                const winnerPlayers = allPlayers.filter(p => nonWinnerIds.has(p.id));

                const newOrder = [...nonWinners, ...winnerPlayers];

                db.serialize(() => {
                  newOrder.forEach((p, i) => {
                    db.run("UPDATE players SET order_position = ? WHERE id = ?", [i + 1, p.id]);
                  });
                });

                // Get winner names for response
                const winnerNames = winners.map(w => {
                  const player = allPlayers.find(p => p.id === w.player_id);
                  return player ? player.name : "?";
                }).join(", ");

                res.json({
                  message: `✅ Semana cerrada. Acertaron: ${winnerNames}. Bote: ${finalPot}€`,
                  winners: winnerNames,
                  pot: finalPot
                });
              });
            } else {
              res.json({
                message: `❌ Nadie acertó. El bote sube a ${finalPot}€`,
                winners: null,
                pot: finalPot
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
  db.all(
    "SELECT w.*, GROUP_CONCAT(p.name) as winners FROM weeks w LEFT JOIN predictions pr ON pr.week_id = w.id AND pr.result = w.real_result LEFT JOIN players p ON p.id = pr.player_id WHERE w.finished = 1 GROUP BY w.id ORDER BY w.id DESC LIMIT 20",
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
});

// ===================== RANKINGS =====================
app.get("/rankings", (req, res) => {
  const query = `
    SELECT
      p.id,
      p.name,
      COUNT(pr.id) as total_predictions,
      SUM(CASE WHEN pr.result = w.real_result AND w.finished = 1 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN pr.result = w.real_result AND w.finished = 1 THEN w.pot ELSE 0 END) as money_won
    FROM players p
    LEFT JOIN predictions pr ON pr.player_id = p.id
    LEFT JOIN weeks w ON w.id = pr.week_id
    GROUP BY p.id
    ORDER BY wins DESC, money_won DESC
  `;

  db.all(query, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// ===================== START =====================
app.listen(PORT, () => {
  console.log(`✅ Servidor en http://localhost:${PORT}`);
});