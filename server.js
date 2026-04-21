require("dotenv").config();

const express = require("express");
const { Pool } = require("pg");
const bodyParser = require("body-parser");
const session = require("express-session");

// =====================================================
// 📧 SERVICIO DE EMAILS CON MAILGUN
// =====================================================
const {
  initMailgun,
  sendPollToActivePlayers,
  sendTurnToPlayer
} = require("./mailgun-service");

// =====================================================
// 🔥 FIREBASE ADMIN SDK (RENDER SECRET FILES - MEJORADO)
// =====================================================
const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

try {
  let serviceAccount;
  const secretFilePath = '/etc/secrets/firebase-service-account.json';
  const localFilePath = path.join(__dirname, 'firebase-service-account.json');
  
  console.log("🔍 Buscando Service Account Key...");
  
  // OPCIÓN 1: Secret Files de Render
  if (fs.existsSync(secretFilePath)) {
    console.log("📁 Encontrado Secret File en:", secretFilePath);
    
    try {
      const fileContent = fs.readFileSync(secretFilePath, 'utf8');
      console.log("📄 Contenido leído, longitud:", fileContent.length, "caracteres");
      
      // Intentar parsear el JSON
      serviceAccount = JSON.parse(fileContent);
      
      // Verificar que tiene las propiedades necesarias
      if (!serviceAccount.project_id) {
        throw new Error("El JSON no contiene 'project_id'. Verifica el formato del Secret File.");
      }
      if (!serviceAccount.private_key) {
        throw new Error("El JSON no contiene 'private_key'. Verifica el formato del Secret File.");
      }
      
      console.log("✅ Firebase: Secret File parseado correctamente");
      console.log("📧 Project ID:", serviceAccount.project_id);
      console.log("👤 Client Email:", serviceAccount.client_email);
      
    } catch (parseError) {
      console.error("❌ Error al parsear el Secret File:");
      console.error("   ", parseError.message);
      throw new Error("Secret File tiene formato JSON inválido. Verifica que esté bien formateado.");
    }
  } 
  // OPCIÓN 2: Variable de entorno
  else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log("📁 Encontrado en: variable de entorno");
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log("✅ Firebase: Usando variable de entorno");
  } 
  // OPCIÓN 3: Archivo local
  else if (fs.existsSync(localFilePath)) {
    console.log("📁 Encontrado en:", localFilePath);
    serviceAccount = require(localFilePath);
    console.log("✅ Firebase: Usando archivo local (desarrollo)");
  }
  else {
    throw new Error("No se encontró el Service Account Key en ninguna ubicación");
  }
  
  // Inicializar Firebase Admin
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  console.log("✅ Firebase Admin SDK inicializado correctamente");
  
} catch (err) {
  console.error("⚠️  Error al inicializar Firebase Admin:");
  console.error("   ", err.message);
  console.error("");
  console.error("📋 Soluciones:");
  console.error("   1. Ve a Render → Environment → Secret Files");
  console.error("   2. Edita 'firebase-service-account.json'");
  console.error("   3. Asegúrate de que el JSON esté EN UNA SOLA LÍNEA");
  console.error("   4. O formateado correctamente con todos los campos");
  console.error("");
  
  throw err;
}
// =====================================================

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// 📧 Inicializar Mailgun
// =====================================================
initMailgun();

// ===================== DATABASE CONFIG =====================
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

// =====================================================
// 🔐 MIDDLEWARE DE AUTENTICACIÓN (ACTUALIZADO PARA FIREBASE)
// =====================================================
app.use((req, res, next) => {
  // Rutas públicas que NO requieren autenticación
  const openPaths = [
    "/api/firebase-login",      // ← NUEVO: Login con Firebase
    "/api/firebase-register",   // ← NUEVO: Registro con Firebase
    "/api/check-email",          // ← NUEVO: Verificar si email está autorizado
    "/api/me",
    "/login.html",
    "/firebase-config.js"        // ← NUEVO: Config de Firebase para frontend
  ];
  
  const openExtensions = [".png", ".jpg", ".jpeg", ".ico", ".svg", ".webp", ".css", ".js", ".woff", ".woff2"];
  const isOpenAsset = openExtensions.some(ext => req.path.endsWith(ext));
  
  // Ahora verificamos req.session.user en lugar de req.session.authenticated
  if (openPaths.includes(req.path) || isOpenAsset || req.session.user) return next();
  
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "No autenticado" });
  if (req.accepts("html")) return res.redirect("/login.html");
  res.status(401).json({ error: "No autenticado" });
});
// =====================================================

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
  
  // ========================================
  // 🔥 NUEVAS COLUMNAS PARA FIREBASE
  // ========================================
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS firebase_uid TEXT`);
  await pool.query(`ALTER TABLE players ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'player'`);
  
  // Índices para mejorar rendimiento
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_email ON players(email)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_players_firebase_uid ON players(firebase_uid)`);
  // ========================================
  
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
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1
    )
  `);
  
  await pool.query(`ALTER TABLE weeks ADD COLUMN IF NOT EXISTS home_team_id INTEGER`);
  await pool.query(`ALTER TABLE weeks ADD COLUMN IF NOT EXISTS away_team_id INTEGER`);
  
  console.log("✅ Base de datos lista");
}

// =====================================================
// 🔥 ENDPOINTS DE AUTENTICACIÓN CON FIREBASE
// =====================================================

// Verificar si un email está autorizado para registrarse
app.post("/api/check-email", async (req, res) => {
  const { email } = req.body;
  
  try {
    const { rows } = await pool.query(
      "SELECT id, name FROM players WHERE email = $1 AND active = 1",
      [email.toLowerCase().trim()]
    );
    
    if (rows.length > 0) {
      res.json({ 
        allowed: true, 
        playerId: rows[0].id,
        playerName: rows[0].name 
      });
    } else {
      res.json({ 
        allowed: false, 
        error: "Este email no está autorizado. Contacta con el administrador." 
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Login con Firebase
app.post("/api/firebase-login", async (req, res) => {
  const { idToken } = req.body;
  
  try {
    // Verificar el token de Firebase
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const email = decodedToken.email;
    
    // Buscar el jugador en la base de datos
    const { rows } = await pool.query(
      "SELECT id, name, role, firebase_uid FROM players WHERE email = $1",
      [email.toLowerCase()]
    );
    
    if (rows.length === 0) {
      return res.status(403).json({ 
        error: "Tu email no está asociado a ningún jugador. Contacta con el administrador." 
      });
    }
    
    const player = rows[0];
    
    // Actualizar firebase_uid si no existe
    if (!player.firebase_uid) {
      await pool.query(
        "UPDATE players SET firebase_uid = $1 WHERE id = $2",
        [decodedToken.uid, player.id]
      );
    }
    
    // Crear sesión
    req.session.user = {
      playerId: player.id,
      playerName: player.name,
      role: player.role || 'player',
      email: email,
      firebaseUid: decodedToken.uid
    };
    
    res.json({ 
      success: true,
      user: req.session.user
    });
    
  } catch (err) {
    console.error("Error en login:", err);
    res.status(401).json({ error: "Token inválido o expirado" });
  }
});

// Registro con Firebase
app.post("/api/firebase-register", async (req, res) => {
  const { idToken, email } = req.body;
  
  try {
    // Verificar el token de Firebase
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Verificar que el email del token coincide con el enviado
    if (decodedToken.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ error: "El email no coincide" });
    }
    
    // Buscar el jugador en la base de datos
    const { rows } = await pool.query(
      "SELECT id, name, role FROM players WHERE email = $1 AND active = 1",
      [email.toLowerCase()]
    );
    
    if (rows.length === 0) {
      // Si no está asociado, eliminar cuenta de Firebase
      await admin.auth().deleteUser(decodedToken.uid);
      return res.status(403).json({ 
        error: "Este email no está autorizado. Contacta con el administrador." 
      });
    }
    
    const player = rows[0];
    
    // Guardar el firebase_uid en la base de datos
    await pool.query(
      "UPDATE players SET firebase_uid = $1 WHERE id = $2",
      [decodedToken.uid, player.id]
    );
    
    // Crear sesión
    req.session.user = {
      playerId: player.id,
      playerName: player.name,
      role: player.role || 'player',
      email: email.toLowerCase(),
      firebaseUid: decodedToken.uid
    };
    
    res.json({ 
      success: true,
      playerName: player.name,
      user: req.session.user
    });
    
  } catch (err) {
    console.error("Error en registro:", err);
    res.status(500).json({ error: err.message });
  }
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Obtener información del usuario actual
app.get("/api/me", (req, res) => {
  if (req.session.user) {
    res.json({ 
      authenticated: true,
      ...req.session.user
    });
  } else {
    res.json({ authenticated: false });
  }
});

// ========================================
// 🔥 GESTIÓN DE USUARIOS (SOLO ADMIN)
// ========================================

// Asociar email a un jugador (solo admin)
app.post("/api/associate-email", async (req, res) => {
  // Verificar que el usuario es admin
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: "Solo administradores pueden hacer esto" });
  }
  
  const { player_id, email } = req.body;
  
  if (!player_id || !email) {
    return res.status(400).json({ error: "Datos incompletos" });
  }
  
  try {
    // Verificar que el email no esté ya asociado a otro jugador
    const { rows: existing } = await pool.query(
      "SELECT id, name FROM players WHERE email = $1 AND id != $2",
      [email.toLowerCase().trim(), player_id]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ 
        error: `Este email ya está asociado a ${existing[0].name}` 
      });
    }
    
    // Asociar el email al jugador
    await pool.query(
      "UPDATE players SET email = $1 WHERE id = $2",
      [email.toLowerCase().trim(), player_id]
    );
    
    res.json({ success: true });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cambiar rol de un jugador (solo admin)
app.post("/api/change-role", async (req, res) => {
  // Verificar que el usuario es admin
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: "Solo administradores pueden hacer esto" });
  }
  
  const { player_id, role } = req.body;
  
  if (!player_id || !role || !['admin', 'player'].includes(role)) {
    return res.status(400).json({ error: "Datos inválidos" });
  }
  
  try {
    await pool.query(
      "UPDATE players SET role = $1 WHERE id = $2",
      [role, player_id]
    );
    
    res.json({ success: true });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// FIN DE ENDPOINTS DE FIREBASE
// =====================================================

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
  const { match, match_date, round_number, excluded_players, home_team_id, away_team_id } = req.body;
  if (!match?.trim()) return res.status(400).json({ error: "Partido inválido" });
  try {
    const { rows } = await pool.query("SELECT next_pot FROM weeks WHERE finished = 1 ORDER BY id DESC LIMIT 1");
    const pot = rows[0]?.next_pot || 0;
    const now = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
    const excludedStr = Array.isArray(excluded_players) ? excluded_players.join(",") : (excluded_players || "");
    await pool.query(
      "INSERT INTO weeks (match, match_date, created_at, pot, finished, round_number, excluded_players, home_team_id, away_team_id) VALUES ($1, $2, $3, $4, 0, $5, $6, $7, $8)",
      [match.trim(), match_date || null, now, pot, round_number || null, excludedStr, home_team_id || null, away_team_id || null]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/current-week", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM weeks WHERE finished = 0 ORDER BY id DESC LIMIT 1");
  if (rows[0]) return res.json(rows[0]);
  const { rows: lastRows } = await pool.query("SELECT next_pot FROM weeks WHERE finished = 1 ORDER BY id DESC LIMIT 1");
  res.json({ none: true, pending_pot: lastRows[0]?.next_pot || 0 });
});

app.post("/edit-week", async (req, res) => {
  const { week_id, match, match_date, round_number, excluded_players, home_team_id, away_team_id } = req.body;
  if (!week_id || !match?.trim()) return res.status(400).json({ error: "Datos inválidos" });
  try {
    const excludedStr = Array.isArray(excluded_players) ? excluded_players.join(",") : (excluded_players || "");
    const { rowCount } = await pool.query(
      "UPDATE weeks SET match = $1, match_date = $2, round_number = $3, excluded_players = $4, home_team_id = $5, away_team_id = $6 WHERE id = $7 AND finished = 0",
      [match.trim(), match_date || null, round_number || null, excludedStr, home_team_id || null, away_team_id || null, week_id]
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
  
  // ========================================
  // 🔥 CONTROL DE PERMISOS
  // ========================================
  // Si el usuario NO es admin, solo puede apostar por sí mismo
  if (req.session.user && req.session.user.role !== 'admin') {
    if (parseInt(player_id) !== req.session.user.playerId) {
      return res.status(403).json({ error: "Solo puedes hacer tu propia apuesta" });
    }
  }
  // ========================================
  
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
    
    // 🔥 Permitir apuesta si:
    // 1. Es el turno del jugador (cualquiera puede apostar en su turno)
    // 2. Es Admin (Admin puede apostar por cualquiera)
    const isAdmin = req.session.user && req.session.user.role === 'admin';
    const isPlayerTurn = parseInt(player_id) === nextPlayer.id;
    
    if (!isPlayerTurn && !isAdmin) {
      return res.status(400).json({ error: "No es tu turno" });
    }
    
    // Insertar predicción
    await pool.query("INSERT INTO predictions (week_id, player_id, result) VALUES ($1, $2, $3)", [week_id, player_id, result.trim()]);
    
    // 📧 NUEVO: Enviar email al siguiente jugador (asincrónico, sin esperar)
    const currentPlayerIndex = players.findIndex(p => p.id === parseInt(player_id));
    const nextPlayerToPlay = players[currentPlayerIndex + 1];
    
    if (nextPlayerToPlay) {
      // Obtener info del partido
      const homeTeamName = week.home_team_id 
        ? (await pool.query("SELECT name FROM teams WHERE id = $1", [week.home_team_id])).rows[0]?.name || "Local"
        : "Local";
      const awayTeamName = week.away_team_id
        ? (await pool.query("SELECT name FROM teams WHERE id = $1", [week.away_team_id])).rows[0]?.name || "Visitante"
        : "Visitante";
      
      const matchInfo = week.match || `${homeTeamName} vs ${awayTeamName}`;
      
      // Enviar email sin esperar (async en background)
      sendTurnToPlayer(pool, nextPlayerToPlay.id, matchInfo, homeTeamName, awayTeamName)
        .then(success => {
          if (success) {
            console.log(`📧 Email de turno enviado a ${nextPlayerToPlay.name}`);
          } else {
            console.warn(`⚠️ Email de turno no enviado a ${nextPlayerToPlay.name}`);
          }
        })
        .catch(err => {
          console.error("❌ Error enviando email de turno:", err.message);
        });
    }
    
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Resultado ya elegido o jugador ya apostó" });
  }
});

// =====================================================
//  SALTAR JUGADOR (SOLO ADMIN)
// =====================================================
app.post("/skip-player", async (req, res) => {
  // Verificar que es admin
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: "Solo administradores pueden hacer esto" });
  }

  const { week_id, player_id } = req.body;
  if (!week_id || !player_id) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  try {
    const { rows: weekRows } = await pool.query("SELECT * FROM weeks WHERE id = $1", [week_id]);
    if (!weekRows.length) return res.status(404).json({ error: "Semana no encontrada" });
    const week = weekRows[0];

    // Obtener lista de excluidos actuales
    const excludedIds = week.excluded_players ? week.excluded_players.split(",").filter(Boolean).map(Number) : [];

    // Agregar este jugador a la lista de excluidos
    if (!excludedIds.includes(parseInt(player_id))) {
      excludedIds.push(parseInt(player_id));
    }

    // Actualizar en la BD
    await pool.query(
      "UPDATE weeks SET excluded_players = $1 WHERE id = $2",
      [excludedIds.join(","), week_id]
    );

    // Obtener el siguiente jugador para enviarle email
    const { rows: players } = await pool.query(
      "SELECT * FROM players WHERE active = 1 AND id != ALL($1) ORDER BY order_position ASC",
      [excludedIds.length ? excludedIds : [0]]
    );
    
    const { rows: preds } = await pool.query(
      "SELECT * FROM predictions WHERE week_id = $1 ORDER BY id ASC",
      [week_id]
    );
    const playerIdsWhoBet = new Set(preds.map(p => p.player_id));
    const nextPlayer = players.find(p => !playerIdsWhoBet.has(p.id));

    // Enviar email al siguiente jugador (si existe)
    if (nextPlayer) {
      const homeTeamName = week.home_team_id 
        ? (await pool.query("SELECT name FROM teams WHERE id = $1", [week.home_team_id])).rows[0]?.name || "Local"
        : "Local";
      const awayTeamName = week.away_team_id
        ? (await pool.query("SELECT name FROM teams WHERE id = $1", [week.away_team_id])).rows[0]?.name || "Visitante"
        : "Visitante";

      const matchInfo = week.match || `${homeTeamName} vs ${awayTeamName}`;

      sendTurnToPlayer(pool, nextPlayer.id, matchInfo, homeTeamName, awayTeamName)
        .then(success => {
          if (success) {
            console.log(`📧 Email de turno enviado a ${nextPlayer.name}`);
          }
        })
        .catch(err => {
          console.error("❌ Error enviando email de turno:", err.message);
        });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Error saltando jugador:", err);
    res.status(500).json({ error: err.message });
  }
});

// ===================== CLOSE WEEK =====================
app.post("/close-week", async (req, res) => {
  const { week_id, real_result, weekly_amount } = req.body;
  if (!week_id || !real_result) return res.status(400).json({ message: "Faltan datos" });

  const amountPerPerson = (weekly_amount !== undefined && weekly_amount !== "" && weekly_amount !== null && !isNaN(parseInt(weekly_amount)))
    ? parseInt(weekly_amount) : 1;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: weekRows } = await client.query("SELECT * FROM weeks WHERE id = $1 AND finished = 0 FOR UPDATE", [week_id]);
    if (!weekRows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "La semana ya fue cerrada o no existe" });
    }
    const week = weekRows[0];
    const excludedIds = week.excluded_players ? week.excluded_players.split(",").filter(Boolean).map(Number) : [];

    const { rows: activePlayers } = await client.query(
      "SELECT * FROM players WHERE active = 1 AND id != ALL($1) ORDER BY order_position ASC",
      [excludedIds.length ? excludedIds : [0]]
    );
    const totalPlayers = activePlayers.length;
    const newPot = (week.pot || 0) + amountPerPerson * totalPlayers;

    const { rows: preds } = await client.query("SELECT * FROM predictions WHERE week_id = $1", [week_id]);
    const winners = preds.filter(p => p.result === real_result.trim());
    const hasWinner = winners.length > 0;
    const nextPot = hasWinner ? 0 : newPot;

    await client.query(
      "UPDATE weeks SET real_result = $1, weekly_amount = $2, pot = $3, next_pot = $4, finished = 1 WHERE id = $5",
      [real_result.trim(), amountPerPerson, newPot, nextPot, week_id]
    );

    // Obtener TODOS los jugadores activos en su orden original
    const { rows: allActivePlayers } = await client.query(
      "SELECT * FROM players WHERE active = 1 ORDER BY order_position ASC"
    );
    
    // Rotar TODOS los jugadores (incluyendo los que fueron saltados esta semana)
    // El primero va al final, los demás avanzan un puesto
    const newOrder = [
      ...allActivePlayers.slice(1),
      allActivePlayers[0]
    ];
    
    // Actualizar posiciones
    for (let i = 0; i < newOrder.length; i++) {
      await client.query("UPDATE players SET order_position = $1 WHERE id = $2", [i + 1, newOrder[i].id]);
    }

    await client.query("COMMIT");
    client.release();

    if (hasWinner) {
      const { rows: allPlayers } = await pool.query("SELECT * FROM players");
      const winnerNames = winners.map(w => allPlayers.find(p => p.id === w.player_id)?.name || "?").join(", ");
      res.json({ message: `✅ Semana cerrada. Acertaron: ${winnerNames}. Bote: ${newPot}€`, winners: winnerNames, pot: newPot });
    } else {
      res.json({ message: `❌ Nadie acertó. El bote sube a ${newPot}€`, winners: null, pot: newPot });
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    res.status(500).json({ message: err.message });
  }
});

// ===================== HISTORY =====================
app.get("/history", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const offset = parseInt(req.query.offset) || 0;

    const { rows: countRows } = await pool.query("SELECT COUNT(*) as total FROM weeks WHERE finished = 1");
    const total = parseInt(countRows[0].total);

    const { rows: weeks } = await pool.query(`
      SELECT w.*, STRING_AGG(DISTINCT p.name, ',') as winners
      FROM weeks w
      LEFT JOIN predictions pr ON pr.week_id = w.id AND pr.result = w.real_result
      LEFT JOIN players p ON p.id = pr.player_id
      WHERE w.finished = 1
      GROUP BY w.id
      ORDER BY w.id DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const { rows: allPlayers } = await pool.query("SELECT * FROM players ORDER BY order_position ASC");
    let allPayments = [];
    try {
      const { rows } = await pool.query("SELECT * FROM payments");
      allPayments = rows;
    } catch {}

    const result = [];
    for (const w of weeks) {
      const { rows: preds } = await pool.query(`
        SELECT pr.*, p.name as player_name
        FROM predictions pr
        JOIN players p ON p.id = pr.player_id
        WHERE pr.week_id = $1
        ORDER BY pr.id ASC
      `, [w.id]);

      const excludedIds = w.excluded_players ? w.excluded_players.split(",").filter(Boolean).map(Number) : [];
      const excludedNames = excludedIds.map(id => allPlayers.find(p => p.id === id)?.name).filter(Boolean);
      const weekPayments = allPayments.filter(p => p.week_id === w.id);
      const playersWhoBet = preds.map(pr => ({ id: pr.player_id, name: pr.player_name }));
      const payments = playersWhoBet.map(p => ({
        player_id: p.id,
        name: p.name,
        paid: weekPayments.some(pay => pay.player_id === p.id && pay.paid)
      }));

      result.push({
        ...w,
        predictions: preds.map((pr, i) => ({
          order: i + 1,
          player_name: pr.player_name,
          result: pr.result,
          correct: pr.result === w.real_result
        })),
        excluded: excludedNames,
        payments
      });
    }

    res.json({ weeks: result, total, offset, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== RANKINGS =====================
app.get("/rankings", async (req, res) => {
  try {
    const { rows: allPlayers } = await pool.query("SELECT * FROM players ORDER BY order_position ASC, id ASC");
    const { rows: finishedWeeks } = await pool.query("SELECT * FROM weeks WHERE finished = 1");
    const { rows: allPreds } = await pool.query(`
      SELECT pr.*, w.real_result, w.pot, w.finished, w.excluded_players
      FROM predictions pr
      JOIN weeks w ON w.id = pr.week_id
      WHERE w.finished = 1
    `);

    const rankings = allPlayers.map(player => {
      const activeWeeks = finishedWeeks.filter(w => {
        const excluded = w.excluded_players ? w.excluded_players.split(",").filter(Boolean).map(Number) : [];
        return !excluded.includes(player.id);
      });

      const playerPreds = allPreds.filter(pr => pr.player_id === player.id);
      const wins = playerPreds.filter(pr => pr.result === pr.real_result).length;
      const moneyWon = playerPreds
        .filter(pr => pr.result === pr.real_result)
        .reduce((sum, pr) => sum + (parseInt(pr.pot) || 0), 0);

      const totalPredictions = playerPreds.length;

      const moneySpent = playerPreds.reduce((sum, pr) => {
        const week = finishedWeeks.find(w => w.id === pr.week_id);
        return sum + (parseInt(week?.weekly_amount) || 1);
      }, 0);

      return {
        id: player.id,
        name: player.name,
        active: player.active,
        total_predictions: totalPredictions,
        active_weeks: activeWeeks.length,
        wins,
        money_won: moneyWon,
        money_spent: moneySpent
      };
    });

    rankings.sort((a, b) => b.wins - a.wins || (b.money_won || 0) - (a.money_won || 0));
    res.json(rankings);
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
    const { rows: teams } = await pool.query("SELECT * FROM teams ORDER BY id ASC");
    const { rows: payments } = await pool.query("SELECT * FROM payments ORDER BY id ASC").catch(() => ({ rows: [] }));
    const backup = { exported_at: new Date().toISOString(), version: 1, players, weeks, predictions, teams, payments };
    const filename = `porrids_backup_${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    res.json(backup);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/import", async (req, res) => {
  const { players, weeks, predictions, teams, payments } = req.body;
  if (!players || !weeks || !predictions) return res.status(400).json({ error: "JSON inválido: faltan datos" });
  try {
    await pool.query("DELETE FROM predictions");
    await pool.query("DELETE FROM payments").catch(() => {});
    await pool.query("DELETE FROM weeks");
    await pool.query("DELETE FROM players");
    await pool.query("DELETE FROM teams");

    for (const p of players) {
      // ========================================
      // 🔥 IMPORTAR TAMBIÉN LOS NUEVOS CAMPOS
      // ========================================
      await pool.query(
        "INSERT INTO players (id, name, order_position, active, email, firebase_uid, role) VALUES ($1, $2, $3, $4, $5, $6, $7)", 
        [p.id, p.name, p.order_position, p.active ?? 1, p.email || null, p.firebase_uid || null, p.role || 'player']
      );
      // ========================================
    }
    for (const w of weeks) {
      await pool.query(
        "INSERT INTO weeks (id, match, match_date, created_at, real_result, pot, next_pot, weekly_amount, finished, round_number, excluded_players, home_team_id, away_team_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
        [w.id, w.match, w.match_date || null, w.created_at || null, w.real_result || null, w.pot || 0, w.next_pot || 0, w.weekly_amount || 0, w.finished || 0, w.round_number || null, w.excluded_players || '', w.home_team_id || null, w.away_team_id || null]
      );
    }
    for (const p of predictions) {
      await pool.query("INSERT INTO predictions (id, week_id, player_id, result) VALUES ($1, $2, $3, $4)", [p.id, p.week_id, p.player_id, p.result]);
    }
    if (teams?.length) {
      for (const t of teams) {
        await pool.query("INSERT INTO teams (id, slug, name, active) VALUES ($1, $2, $3, $4)", [t.id, t.slug, t.name, t.active ?? 1]);
      }
      await pool.query("SELECT setval('teams_id_seq', (SELECT MAX(id) FROM teams))");
    }
    if (payments?.length) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          week_id INTEGER,
          player_id INTEGER,
          paid INTEGER DEFAULT 0,
          UNIQUE(week_id, player_id)
        )
      `);
      for (const p of payments) {
        await pool.query("INSERT INTO payments (id, week_id, player_id, paid) VALUES ($1, $2, $3, $4)", [p.id, p.week_id, p.player_id, p.paid ?? 0]);
      }
      await pool.query("SELECT setval('payments_id_seq', (SELECT MAX(id) FROM payments))");
    }

    await pool.query("SELECT setval('players_id_seq', (SELECT MAX(id) FROM players))");
    await pool.query("SELECT setval('weeks_id_seq', (SELECT MAX(id) FROM weeks))");
    await pool.query("SELECT setval('predictions_id_seq', (SELECT MAX(id) FROM predictions))");

    res.json({ success: true, message: `Importados: ${players.length} jugadores, ${weeks.length} semanas, ${predictions.length} apuestas, ${teams?.length || 0} equipos, ${payments?.length || 0} pagos` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/reset", async (req, res) => {
  try {
    await pool.query("DELETE FROM predictions");
    await pool.query("DELETE FROM payments").catch(() => {});
    await pool.query("DELETE FROM weeks");
    await pool.query("DELETE FROM players");
    await pool.query("DELETE FROM teams");
    await pool.query("ALTER SEQUENCE players_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE weeks_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE predictions_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE teams_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE payments_id_seq RESTART WITH 1").catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =====================================================
// 🗳️ SISTEMA DE VOTACIÓN DE PARTIDOS
// =====================================================

// Obtener votación activa con opciones y votos
app.get("/api/active-poll", async (req, res) => {
  try {
    // Buscar votación activa
    const { rows: polls } = await pool.query(
      "SELECT * FROM match_polls WHERE active = true ORDER BY id DESC LIMIT 1"
    );
    
    if (polls.length === 0) {
      return res.json({ active: false });
    }
    
    const poll = polls[0];
    
    // Obtener opciones con información de equipos
    const { rows: options } = await pool.query(`
      SELECT 
        po.id,
        po.home_team_id,
        po.away_team_id,
        ht.name as home_team_name,
        ht.slug as home_team_slug,
        at.name as away_team_name,
        at.slug as away_team_slug,
        COUNT(pv.id) as votes
      FROM poll_options po
      LEFT JOIN teams ht ON po.home_team_id = ht.id
      LEFT JOIN teams at ON po.away_team_id = at.id
      LEFT JOIN poll_votes pv ON po.id = pv.option_id
      WHERE po.poll_id = $1
      GROUP BY po.id, ht.name, ht.slug, at.name, at.slug
      ORDER BY po.id
    `, [poll.id]);
    
    // Obtener quién ha votado (para mostrar check)
    const { rows: votes } = await pool.query(
      "SELECT player_id, option_id FROM poll_votes WHERE poll_id = $1",
      [poll.id]
    );
    
    res.json({
      active: true,
      poll: {
        id: poll.id,
        title: poll.title,
        created_at: poll.created_at
      },
      options,
      votes
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Crear nueva votación (SOLO ADMIN)
app.post("/api/create-poll", async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: "Solo administradores pueden hacer esto" });
  }
  
  const { title, options } = req.body;
  // options = [{home_team_id, away_team_id}, ...]
  
  if (!options || options.length === 0) {
    return res.status(400).json({ error: "Debes agregar al menos un partido" });
  }
  
  try {
    // 1. Eliminar votaciones cerradas antiguas
    await pool.query("DELETE FROM match_polls WHERE active = false");
    
    // 2. Cerrar votación activa actual
    await pool.query("UPDATE match_polls SET active = false WHERE active = true");
    
    // 3. Crear nueva votación
    const { rows: pollRows } = await pool.query(
      "INSERT INTO match_polls (title, active) VALUES ($1, true) RETURNING *",
      [title || 'Vota el próximo partido']
    );
    
    const pollId = pollRows[0].id;
    
    // 4. Insertar opciones y obtener información de equipos
    const pollOptions = [];
    for (const opt of options) {
      const { rows: teamData } = await pool.query(`
        SELECT 
          ht.name as home_team_name,
          ht.slug as home_team_slug,
          at.name as away_team_name,
          at.slug as away_team_slug
        FROM teams ht
        JOIN teams at ON at.id = $2
        WHERE ht.id = $1
      `, [opt.home_team_id, opt.away_team_id]);
      
      if (teamData.length > 0) {
        pollOptions.push(teamData[0]);
      }
      
      await pool.query(
        "INSERT INTO poll_options (poll_id, home_team_id, away_team_id) VALUES ($1, $2, $3)",
        [pollId, opt.home_team_id, opt.away_team_id]
      );
    }
    
    // 5. 📧 Enviar emails a jugadores activos (async, sin esperar)
    if (pollOptions.length > 0) {
      sendPollToActivePlayers(pool, title || 'Vota el próximo partido', pollOptions)
        .then(result => {
          console.log(`📧 Votación enviada: ${result.sent} emails enviados, ${result.failed} fallidos`);
        })
        .catch(err => {
          console.error("❌ Error enviando emails de votación:", err.message);
        });
    }
    
    res.json({ success: true, poll_id: pollId });
    
  } catch (err) {
    console.error("❌ Error creating poll:", err);
    res.status(500).json({ error: err.message });
  }
});

// Votar en una opción
app.post("/api/vote-poll", async (req, res) => {
  const { poll_id, option_id } = req.body;
  const player_id = req.session.user.playerId;
  
  if (!poll_id || !option_id) {
    return res.status(400).json({ error: "Datos incompletos" });
  }
  
  try {
    // Verificar que la votación está activa
    const { rows: pollRows } = await pool.query(
      "SELECT active FROM match_polls WHERE id = $1",
      [poll_id]
    );
    
    if (pollRows.length === 0 || !pollRows[0].active) {
      return res.status(400).json({ error: "Esta votación ya no está activa" });
    }
    
    // Verificar que la opción pertenece a esta votación
    const { rows: optionRows } = await pool.query(
      "SELECT id FROM poll_options WHERE id = $1 AND poll_id = $2",
      [option_id, poll_id]
    );
    
    if (optionRows.length === 0) {
      return res.status(400).json({ error: "Opción no válida" });
    }
    
    // Insertar o actualizar voto (UPSERT)
    await pool.query(`
      INSERT INTO poll_votes (poll_id, option_id, player_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (poll_id, player_id)
      DO UPDATE SET option_id = $2
    `, [poll_id, option_id, player_id]);
    
    res.json({ success: true });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cerrar votación actual (SOLO ADMIN)
app.post("/api/close-poll", async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: "Solo administradores pueden hacer esto" });
  }
  
  try {
    await pool.query("UPDATE match_polls SET active = false WHERE active = true");
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
// 🗳️ ESTABLECER GANADOR DE VOTACIÓN Y CREAR SEMANA
// =====================================================
app.post("/api/set-poll-winner", async (req, res) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: "Solo administradores pueden hacer esto" });
  }

  const { home_team_id, away_team_id, round_number, match_name, match_date } = req.body;
  
  if (!home_team_id || !away_team_id || !round_number) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  try {
    // Obtener la votación activa (o la última)
    const { rows: pollRows } = await pool.query(
      "SELECT * FROM match_polls WHERE active = false ORDER BY id DESC LIMIT 1"
    );
    
    if (!pollRows.length) {
      return res.status(404).json({ error: "No hay votación cerrada" });
    }

    const poll = pollRows[0];

    // Guardar el ganador en la votación
    await pool.query(
      "UPDATE match_polls SET winning_home_team = $1, winning_away_team = $2, winning_round = $3, winning_match = $4, winning_date = $5 WHERE id = $6",
      [home_team_id, away_team_id, round_number, match_name || null, match_date || null, poll.id]
    );

    res.json({ success: true, message: "Ganador de votación establecido" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================


// ===================== TEAMS =====================
app.get("/teams", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM teams ORDER BY name ASC");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/add-team", async (req, res) => {
  const { slug, name } = req.body;
  if (!slug?.trim() || !name?.trim()) return res.status(400).json({ error: "Datos inválidos" });
  try {
    await pool.query("INSERT INTO teams (slug, name, active) VALUES ($1, $2, 1)", [slug.trim().toLowerCase(), name.trim()]);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: "Equipo ya existe" });
  }
});

app.post("/deactivate-team", async (req, res) => {
  const { team_id } = req.body;
  if (!team_id) return res.status(400).json({ error: "ID requerido" });
  try {
    await pool.query("UPDATE teams SET active = 0 WHERE id = $1", [team_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/reactivate-team", async (req, res) => {
  const { team_id } = req.body;
  if (!team_id) return res.status(400).json({ error: "ID requerido" });
  try {
    await pool.query("UPDATE teams SET active = 1 WHERE id = $1", [team_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/edit-team", async (req, res) => {
  const { team_id, name } = req.body;
  if (!team_id || !name?.trim()) return res.status(400).json({ error: "Datos inválidos" });
  try {
    const { rowCount } = await pool.query("UPDATE teams SET name = $1 WHERE id = $2", [name.trim(), team_id]);
    if (rowCount === 0) return res.status(404).json({ error: "Equipo no encontrado" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/delete-team", async (req, res) => {
  const { team_id } = req.body;
  if (!team_id) return res.status(400).json({ error: "ID requerido" });
  try {
    await pool.query("UPDATE weeks SET home_team_id = NULL WHERE home_team_id = $1", [team_id]);
    await pool.query("UPDATE weeks SET away_team_id = NULL WHERE away_team_id = $1", [team_id]);
    await pool.query("DELETE FROM teams WHERE id = $1", [team_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== START =====================
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`✅ Servidor en http://localhost:${PORT}`);
    console.log(`🔐 Sistema de autenticación: Firebase`);
    console.log(`📧 Admin inicial: lucas@idsplus.net`);
  });
}).catch(err => {
  console.error("❌ Error conectando a la base de datos:", err);
  process.exit(1);
});