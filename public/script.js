// ===================== STATE =====================
let currentWeek = null;
let players = [];
let predictions = [];
let currentTurnPlayer = null;
let historyVisible = false;
let rankingsData = [];
let allHistoryData = [];
let currentTab = "wins";
let currentSeason = "all";
let payments = [];
let newExcludedPlayers = [];
let showActiveOnly = true;
let editExcludedPlayers = [];
let teams = [];

// =====================================================
// 🔥 FIREBASE: Info del usuario actual
// =====================================================
let currentUser = null; // {playerId, playerName, role, email}

// ===================== INIT =====================
let isRedirecting = false;

(async () => {
  try {
    const me = await fetch("/api/me").then(r => r.json());
    if (!me || !me.authenticated) {
      if (!isRedirecting) {
        isRedirecting = true;
        window.location.replace("/login.html");
      }
      return;
    }
    
    // =====================================================
    // 🔥 FIREBASE: Guardar info del usuario
    // =====================================================
    currentUser = {
      playerId: me.playerId,
      playerName: me.playerName,
      role: me.role,
      email: me.email
    };
    
    // Mostrar mensaje de bienvenida en consola
    if (currentUser.playerName) {
      console.log(`👋 Bienvenid@ ${currentUser.playerName} (${currentUser.role})`);
    }
    
    // 🔥 FIREBASE: Ocultar botón Admin si no es admin
    if (currentUser.role !== 'admin') {
      const adminBtn = document.querySelector('.btn-admin-toggle');
      if (adminBtn) adminBtn.style.display = 'none';
    }
    // =====================================================
    
    loadData();
  } catch(e) {
    console.error("Error checking auth:", e);
    // Don't redirect on network error, just show empty state
  }
})();

async function loadData() {
  await loadPlayers();
  await loadTeams();
  await loadWeek();
  await loadPredictions();
  await loadPayments();
  reorderList = []; // reset so renderReorder picks up fresh DB order
  calculateTurn();
  renderPlayers();
  renderReorder();
  renderManagePlayers();
  renderExcludeLists();
  await loadRankings();
  await loadHistory();
  document.getElementById("playersCount").textContent = players.filter(p => p.active).length;
  
  // =====================================================
  // 🔥 FIREBASE: Renderizar gestión de usuarios si es admin
  // =====================================================
  if (currentUser && currentUser.role === 'admin') {
    renderUserManagement();
  }
  // =====================================================
}

// ===================== FETCH =====================
async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    if (!isRedirecting) {
      isRedirecting = true;
      window.location.replace("/login.html");
    }
    throw new Error("No autenticado");
  }
  return res.json();
}

async function post(url, body) {
  return api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// ===================== AUTH =====================
async function doLogout() {
  await post("/api/logout", {});
  window.location.replace("/login.html");
}

// ===================== LOADERS =====================
async function loadPlayers() {
  players = await api("/players");
}

async function loadWeek() {
  currentWeek = await api("/current-week");

  if (!currentWeek || currentWeek.none) {
    document.getElementById("weekInfo").textContent = "Sin semana activa";
    document.getElementById("weekDatetime").textContent = "";
    document.getElementById("weekStatus").textContent = "Crea una nueva semana desde Admin";
    document.getElementById("weekRound").textContent = "";
    document.getElementById("turnBanner").classList.add("hidden");
    const pendingPot = currentWeek?.pending_pot || 0;
    const potEl = document.getElementById("potInfo");
    if (pendingPot > 0) {
      potEl.innerHTML = `<span class="pot-pending">💰 Bote acumulado: <strong>${pendingPot}€</strong></span>`;
    } else {
      potEl.textContent = "";
    }
    currentWeek = null;
    return;
  }

  const homeTeam = teams.find(t => t.id === currentWeek.home_team_id);
  const awayTeam = teams.find(t => t.id === currentWeek.away_team_id);
  const weekInfoEl = document.getElementById("weekInfo");
  if (homeTeam && awayTeam) {
    weekInfoEl.innerHTML = `
      <span class="scoreboard-teams">
        <img src="/Escudos/${homeTeam.slug}.svg" class="scoreboard-badge" onerror="this.style.display='none'">
        <span class="scoreboard-vs">VS</span>
        <img src="/Escudos/${awayTeam.slug}.svg" class="scoreboard-badge" onerror="this.style.display='none'">
      </span>`;
  } else {
    weekInfoEl.textContent = currentWeek.match;
  }
  
  // Calcular el bote total: bote acumulado + dinero de esta semana (1€ por jugador activo no excluido)
  const excludedIds = currentWeek.excluded_players ? currentWeek.excluded_players.split(",").filter(Boolean).map(Number) : [];
  const activePlayers = players.filter(p => p.active && !excludedIds.includes(p.id));
  const weeklyContribution = activePlayers.length * 1; // 1€ por persona
  const totalPot = (currentWeek.pot || 0) + weeklyContribution;
  
  document.getElementById("potInfo").textContent =
    totalPot > 0 ? `💰 Bote: ${totalPot} €` : "";
  document.getElementById("weekStatus").textContent = "SEMANA EN CURSO";
  document.getElementById("turnBanner").classList.remove("hidden");

  // Jornada
  const roundEl = document.getElementById("weekRound");
  if (currentWeek.round_number) {
    // If it already contains "JORNADA" show as-is, otherwise prefix it
    const rn = currentWeek.round_number.toUpperCase();
    roundEl.textContent = rn.startsWith("JORNADA") ? rn : `JORNADA ${rn}`;
  } else {
    roundEl.textContent = "";
  }

  // Fecha del partido
  const dtEl = document.getElementById("weekDatetime");
  if (currentWeek.match_date) {
    const dt = new Date(currentWeek.match_date);
    dtEl.textContent = "📅 " + dt.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) +
      " · " + dt.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) + "h";
  } else {
    dtEl.textContent = "";
  }
}

async function loadPredictions() {
  if (!currentWeek) { predictions = []; return; }
  predictions = await api("/predictions/" + currentWeek.id);
}

async function loadPayments() {
  if (!currentWeek) { payments = []; return; }
  payments = await api("/payments/" + currentWeek.id).catch(() => []);
}

// ===================== TEAMS =====================
async function loadTeams() {
  teams = await api("/teams");
}

function teamBadge(slug, size = 28) {
  if (!slug) return "";
  return `<img src="/Escudos/${slug}.svg" width="${size}" height="${size}" loading="lazy" decoding="async" style="vertical-align:middle;object-fit:contain;margin:0 2px" onerror="this.style.display='none'">`;
}

function renderTeamSelectors(homeId, awayId, homeVal, awayVal) {
  const active = teams.filter(t => t.active);
  [homeId, awayId].forEach((id, idx) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const val = idx === 0 ? homeVal : awayVal;
    sel.innerHTML = (idx === 0 ? `<option value="">— Local —</option>` : `<option value="">— Visitante —</option>`) +
      active.map(t => `<option value="${t.id}" ${t.id == val ? "selected" : ""}>${t.name}</option>`).join("");
    sel.onchange = () => {
      const prefix = id.startsWith("new") ? "new" : "edit";
      const hId = parseInt(document.getElementById(prefix + "HomeTeam")?.value);
      const aId = parseInt(document.getElementById(prefix + "AwayTeam")?.value);
      const h = teams.find(t => t.id === hId);
      const a = teams.find(t => t.id === aId);
      const inp = document.getElementById(prefix + "Match");
      if (inp && h && a) inp.value = `${h.name}-${a.name}`;
    };
  });
}

function renderManageTeams() {
  const container = document.getElementById("manageTeamsList");
  if (!container) return;
  container.innerHTML = "";
  if (!teams.length) {
    container.innerHTML = '<p class="empty-state">No hay equipos.</p>';
    return;
  }
  const sorted = [...teams].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  sorted.forEach(t => {
    const div = document.createElement("div");
    div.className = "manage-player-item" + (t.active ? "" : " inactive");
    div.innerHTML = `
      <span class="manage-player-name">
        ${teamBadge(t.slug, 22)} ${t.name}
        ${!t.active ? '<span class="inactive-tag">inactivo</span>' : ""}
      </span>
      <div style="display:flex;gap:6px">
        <button type="button" class="btn-move" onclick="startEditTeam(${t.id}, '${t.name}')" title="Editar nombre">✏️</button>
        ${t.active
          ? `<button type="button" class="btn-deactivate" onclick="deactivateTeam(${t.id}, '${t.name}')">Descender</button>`
          : `<button type="button" class="btn-reactivate" onclick="reactivateTeam(${t.id}, '${t.name}')">Ascender</button>`
        }
        <button type="button" class="btn-deactivate" onclick="deleteTeam(${t.id}, '${t.name}')" title="Eliminar definitivamente" style="background:rgba(244,67,54,0.15);border-color:rgba(244,67,54,0.4);color:#f44336">🗑</button>
      </div>
    `;
    container.appendChild(div);
  });
}

async function addTeam() {
  const slug = document.getElementById("newTeamSlug")?.value.trim().toLowerCase();
  const name = document.getElementById("newTeamName")?.value.trim();
  if (!slug || !name) return toast("Rellena acrónimo y nombre", "error");
  const res = await post("/add-team", { slug, name });
  if (res.error) { toast(res.error, "error"); return; }
  toast(`✓ ${name} añadido`, "success");
  document.getElementById("newTeamSlug").value = "";
  document.getElementById("newTeamName").value = "";
  await loadTeams();
  renderManageTeams();
  renderTeamSelectors("newHomeTeam", "newAwayTeam");
  renderTeamSelectors("editHomeTeam", "editAwayTeam", currentWeek?.home_team_id, currentWeek?.away_team_id);
}

async function deactivateTeam(id, name) {
  showModal({
    icon: "⬇️",
    title: "¿Descender equipo?",
    body: `<strong>${name}</strong> quedará inactivo. Puedes reactivarlo si sube.`,
    confirmText: "Descender",
    danger: true,
    onConfirm: async () => {
      const res = await post("/deactivate-team", { team_id: id });
      if (res.error) { toast(res.error, "error"); return; }
      toast(`${name} descendido`, "info");
      await loadTeams(); renderManageTeams();
    }
  });
}

function startEditTeam(id, currentName) {
  showModal({
    icon: "✏️",
    title: "Editar nombre del equipo",
    body: `<input type="text" id="editTeamNameInput" value="${currentName}" style="width:100%;margin-top:8px" placeholder="Nuevo nombre">`,
    confirmText: "Guardar",
    danger: false,
    onConfirm: async () => {
      const name = document.getElementById("editTeamNameInput")?.value.trim();
      if (!name) return toast("El nombre no puede estar vacío", "error");
      const res = await post("/edit-team", { team_id: id, name });
      if (res.error) { toast(res.error, "error"); return; }
      toast(`✓ Nombre actualizado`, "success");
      await loadTeams();
      renderManageTeams();
      renderTeamSelectors("newHomeTeam", "newAwayTeam");
      renderTeamSelectors("editHomeTeam", "editAwayTeam", currentWeek?.home_team_id, currentWeek?.away_team_id);
    }
  });
}

async function reactivateTeam(id, name) {
  showModal({
    icon: "⬆️",
    title: "¿Ascender equipo?",
    body: `<strong>${name}</strong> volverá a estar disponible.`,
    confirmText: "Ascender",
    danger: false,
    onConfirm: async () => {
      const res = await post("/reactivate-team", { team_id: id });
      if (res.error) { toast(res.error, "error"); return; }
      toast(`${name} ascendido ✓`, "success");
      await loadTeams(); renderManageTeams();
    }
  });
}

async function deleteTeam(id, name) {
  showModal({
    icon: "🗑️",
    title: "¿Eliminar equipo?",
    body: `Se eliminará <strong>${name}</strong> definitivamente de la base de datos.<br><br>Los partidos que lo usaban quedarán sin escudo asignado.`,
    confirmText: "Eliminar",
    danger: true,
    onConfirm: async () => {
      const res = await post("/delete-team", { team_id: id });
      if (res.error) { toast(res.error, "error"); return; }
      toast(`${name} eliminado`, "info");
      await loadTeams();
      renderManageTeams();
      renderTeamSelectors("newHomeTeam", "newAwayTeam");
      renderTeamSelectors("editHomeTeam", "editAwayTeam", currentWeek?.home_team_id, currentWeek?.away_team_id);
    }
  });
}

// ===================== EXCLUDED PLAYERS HELPERS =====================
function getExcludedForCurrentWeek() {
  if (!currentWeek || !currentWeek.excluded_players) return [];
  return currentWeek.excluded_players.split(",").filter(Boolean).map(Number);
}

function getActivePlayers() {
  const excluded = getExcludedForCurrentWeek();
  return players.filter(p => p.active && !excluded.includes(p.id));
}

// ===================== TURN =====================
function calculateTurn() {
  if (!currentWeek || players.length === 0) {
    currentTurnPlayer = null;
    document.getElementById("currentTurnName").textContent = "—";
    return;
  }

  const activePlayers = getActivePlayers();
  if (!activePlayers.length) {
    currentTurnPlayer = null;
    document.getElementById("currentTurnName").textContent = "Sin jugadores activos";
    return;
  }

  const playerIdsWhoBet = new Set(predictions.map(pr => pr.player_id));
  currentTurnPlayer = activePlayers.find(p => !playerIdsWhoBet.has(p.id)) || null;

  if (!currentTurnPlayer) {
    document.getElementById("currentTurnName").textContent = "Todos han apostado";
    document.getElementById("shareContainer")?.classList.remove("hidden");
    return;
  }
  document.getElementById("shareContainer")?.classList.add("hidden");
  document.getElementById("currentTurnName").textContent = currentTurnPlayer.name.toUpperCase();
}

// ===================== RENDER PLAYERS =====================
function renderPlayers() {
  const container = document.getElementById("playersList");
  container.innerHTML = "";

  const activePlayers = getActivePlayers();

  if (activePlayers.length === 0) {
    container.innerHTML = '<p class="empty-state">No hay jugadores activos. Añade desde Admin.</p>';
    return;
  }

  activePlayers.forEach((p, i) => {
    const prediction = predictions.find(pr => pr.player_id === p.id);
    const isTurn = currentTurnPlayer && p.id === currentTurnPlayer.id;
    const isPaid = payments.find(pay => pay.player_id === p.id && pay.paid);

    const div = document.createElement("div");
    div.className = "player-card" + (isTurn ? " turn" : "") + (prediction ? " played" : "");
    div.innerHTML = `
      <div class="player-position">#${i + 1}</div>
      <div class="player-name">${p.name}</div>
      <div class="player-result ${prediction ? "" : "empty"}">
        ${prediction ? prediction.result : "Sin apostar"}
      </div>
      ${currentWeek ? `
      <div class="player-payment">
        <button type="button" class="btn-pay ${isPaid ? 'paid' : ''}" onclick="togglePayment(${p.id}, ${isPaid ? 1 : 0})" title="${isPaid ? 'Pagado ✓' : 'Marcar como pagado'}">
          ${isPaid ? '✓ Pagado' : '€ Pagar'}
        </button>
      </div>` : ''}
    `;
    container.appendChild(div);
  });
}

// ===================== PAYMENT =====================
function togglePayment(playerId, currentPaid) {
  const player = players.find(p => p.id === playerId);
  if (!player) return;

  if (!currentPaid) {
    // Confirmar pago
    showModal({
      icon: "💶",
      title: "¿Confirmar pago?",
      body: `¿Marcar a <strong>${player.name}</strong> como pagado esta semana?`,
      confirmText: "Sí, ha pagado",
      danger: false,
      onConfirm: async () => {
        await post("/payment-toggle", { week_id: currentWeek.id, player_id: playerId, paid: true });
        toast(`✓ ${player.name} marcado como pagado`, "success");
        await loadPayments();
        renderPlayers();
      }
    });
  } else {
    // Confirmar desmarcar
    showModal({
      icon: "↩️",
      title: "¿Desmarcar pago?",
      body: `¿Quitar el pago de <strong>${player.name}</strong>?`,
      confirmText: "Sí, desmarcar",
      danger: true,
      onConfirm: async () => {
        await post("/payment-toggle", { week_id: currentWeek.id, player_id: playerId, paid: false });
        toast(`${player.name} desmarcado`, "info");
        await loadPayments();
        renderPlayers();
      }
    });
  }
}

// ===================== RENDER EXCLUDE LISTS =====================
function renderExcludeLists() {
  renderExcludeList("newExcludeList", newExcludedPlayers, (id) => {
    const idx = newExcludedPlayers.indexOf(id);
    if (idx > -1) newExcludedPlayers.splice(idx, 1);
    else newExcludedPlayers.push(id);
    renderExcludeList("newExcludeList", newExcludedPlayers, arguments.callee);
  });

  const currentExcluded = getExcludedForCurrentWeek();
  if (editExcludedPlayers.length === 0 && currentExcluded.length > 0) {
    editExcludedPlayers = [...currentExcluded];
  }

  renderExcludeList("editExcludeList", editExcludedPlayers, (id) => {
    const idx = editExcludedPlayers.indexOf(id);
    if (idx > -1) editExcludedPlayers.splice(idx, 1);
    else editExcludedPlayers.push(id);
    renderExcludeList("editExcludeList", editExcludedPlayers, arguments.callee);
  });
}

function renderExcludeList(containerId, excludedArr, toggleFn) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const activePlayers = players.filter(p => p.active);
  if (!activePlayers.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `<div class="exclude-label">No juegan esta semana:</div>`;
  activePlayers.forEach(p => {
    const excluded = excludedArr.includes(p.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-exclude" + (excluded ? " excluded" : "");
    btn.textContent = (excluded ? "✗ " : "") + p.name;
    btn.onclick = () => toggleFn(p.id);
    container.appendChild(btn);
  });
}

// ===================== RENDER MANAGE PLAYERS =====================
function renderManagePlayers() {
  const container = document.getElementById("managePlayersList");
  if (!container) return;
  container.innerHTML = "";

  if (!players.length) {
    container.innerHTML = '<p class="empty-state">No hay jugadores.</p>';
    return;
  }

  const sortedPlayers = [...players].sort((a, b) => (b.active - a.active) || a.order_position - b.order_position || a.id - b.id);
  sortedPlayers.forEach(p => {
    const div = document.createElement("div");
    div.className = "manage-player-item" + (p.active ? "" : " inactive");
    div.innerHTML = `
      <span class="manage-player-name">${p.name}${!p.active ? ' <span class="inactive-tag">inactivo</span>' : ''}</span>
      ${p.active
        ? `<button type="button" class="btn-deactivate" onclick="deactivatePlayer(${p.id}, '${p.name}')">Desactivar</button>`
        : `<button type="button" class="btn-reactivate" onclick="reactivatePlayer(${p.id}, '${p.name}')">Reactivar</button>`
      }
    `;
    container.appendChild(div);
  });
}

async function deactivatePlayer(id, name) {
  showModal({
    icon: "⏸️",
    title: "¿Desactivar jugador?",
    body: `<strong>${name}</strong> quedará inactivo. No participará en futuras semanas pero se conserva su historial.<br><br>Puedes reactivarlo cuando quieras.`,
    confirmText: "Desactivar",
    danger: true,
    onConfirm: async () => {
      const res = await post("/deactivate-player", { player_id: id });
      if (res.error) { toast(res.error, "error"); return; }
      toast(`${name} desactivado`, "info");
      loadData();
    }
  });
}

async function reactivatePlayer(id, name) {
  showModal({
    icon: "▶️",
    title: "¿Reactivar jugador?",
    body: `<strong>${name}</strong> volverá a participar en las semanas.`,
    confirmText: "Reactivar",
    danger: false,
    onConfirm: async () => {
      const res = await post("/reactivate-player", { player_id: id });
      if (res.error) { toast(res.error, "error"); return; }
      toast(`${name} reactivado ✓`, "success");
      loadData();
    }
  });
}

// ===================== RENDER REORDER =====================
// Orden visual local (array de ids) — independiente de order_position en BD
let reorderList = [];

function renderReorder() {
  const container = document.getElementById("reorderList");
  container.innerHTML = "";

  // Inicializar reorderList si está vacío o desactualizado
  const activePlayers = players.filter(p => p.active);
  if (!reorderList.length || !reorderList.every(id => activePlayers.find(p => p.id === id))) {
    reorderList = [...activePlayers].sort((a, b) => a.order_position - b.order_position || a.id - b.id).map(p => p.id);
  }

  reorderList.forEach((id, i) => {
    const p = players.find(pl => pl.id === id);
    if (!p) return;
    const div = document.createElement("div");
    div.className = "reorder-item";
    div.innerHTML = `
      <span class="reorder-pos">${i + 1}</span>
      <span class="reorder-name">${p.name}</span>
      <button type="button" class="btn-move" onclick="moveUp(${id})">▲</button>
      <button type="button" class="btn-move" onclick="moveDown(${id})">▼</button>
    `;
    container.appendChild(div);
  });
}

function moveUp(id) {
  const index = reorderList.indexOf(id);
  if (index > 0) {
    [reorderList[index], reorderList[index - 1]] = [reorderList[index - 1], reorderList[index]];
    renderReorder();
  }
}

function moveDown(id) {
  const index = reorderList.indexOf(id);
  if (index < reorderList.length - 1) {
    [reorderList[index], reorderList[index + 1]] = [reorderList[index + 1], reorderList[index]];
    renderReorder();
  }
}

async function saveOrder() {
  // Reasignar order_position consecutivos según el orden visual actual
  const orders = reorderList.map((id, i) => ({ id, order_position: i + 1 }));
  // Actualizar también el array local
  orders.forEach(o => {
    const p = players.find(pl => pl.id === o.id);
    if (p) p.order_position = o.order_position;
  });
  await post("/reorder-players", { orders });
  toast("Orden guardado ✓", "success");
  reorderList = [];
  loadData();
}

// ===================== ACTIONS =====================

function sendPrediction() {
  if (!currentWeek) return toast("No hay semana activa", "error");
  if (!currentTurnPlayer) return toast("No hay turno activo", "error");

  const local = document.getElementById("resultLocal").value.trim();
  const visit = document.getElementById("resultVisit").value.trim();
  if (local === "" || visit === "") return toast("Introduce los dos goles", "error");

  const result = `${local}-${visit}`;

  showModal({
    icon: "⚽",
    title: "¿Confirmar apuesta?",
    body: `<strong>${currentTurnPlayer.name}</strong> apuesta <strong>${result}</strong>.<br><br>Una vez enviada no se puede modificar.`,
    confirmText: "Confirmar apuesta",
    danger: false,
    onConfirm: async () => {
      const data = await post("/predict", {
        week_id: currentWeek.id,
        player_id: currentTurnPlayer.id,
        result
      });
      if (data.error) {
        toast(data.error, "error");
      } else {
        toast(`✓ ${currentTurnPlayer.name} apostó ${result}`, "success");
        document.getElementById("resultLocal").value = "";
        document.getElementById("resultVisit").value = "";
        loadData();
      }
    }
  });
}

async function addPlayer() {
  const name = document.getElementById("newPlayerName").value.trim();
  if (!name) return toast("Escribe un nombre", "error");

  const data = await post("/add-player", { name });
  if (data.error) { toast(data.error, "error"); return; }
  toast(`✓ ${name} añadido`, "success");
  document.getElementById("newPlayerName").value = "";
  loadData();
}

async function createWeek() {
  const match = document.getElementById("newMatch").value.trim();
  if (!match) return toast("Escribe el partido", "error");
  const match_date = document.getElementById("newMatchDate").value || null;
  const round_number = document.getElementById("newRound").value.trim() || null;

  const home_team_id = parseInt(document.getElementById("newHomeTeam")?.value) || null;
  const away_team_id = parseInt(document.getElementById("newAwayTeam")?.value) || null;
  const data = await post("/new-week", { match, match_date, round_number, excluded_players: newExcludedPlayers, home_team_id, away_team_id });
  if (data.error) { toast(data.error, "error"); return; }
  toast("✓ Semana creada", "success");
  document.getElementById("newMatch").value = "";
  document.getElementById("newMatchDate").value = "";
  document.getElementById("newRound").value = "";
  newExcludedPlayers = [];
  toggleAdmin();
  loadData();
}

function editWeek() {
  if (!currentWeek) return toast("No hay semana activa", "error");
  const match = document.getElementById("editMatch").value.trim();
  if (!match) return toast("Escribe el nuevo nombre del partido", "error");
  const match_date = document.getElementById("editMatchDate").value || null;
  const round_number = document.getElementById("editRound").value.trim() || null;

  showModal({
    icon: "✏️",
    title: "¿Editar partido?",
    body: `El partido cambiará a <strong>${match}</strong>.<br><br>⚠️ Todas las apuestas actuales se eliminarán y se empezará desde cero.`,
    confirmText: "Sí, editar y borrar apuestas",
    danger: true,
    onConfirm: async () => {
      const home_team_id = parseInt(document.getElementById("editHomeTeam")?.value) || null;
      const away_team_id = parseInt(document.getElementById("editAwayTeam")?.value) || null;
      const data = await post("/edit-week", {
        week_id: currentWeek.id, match, match_date, round_number,
        excluded_players: editExcludedPlayers, home_team_id, away_team_id
      });
      if (data.error) { toast(data.error, "error"); return; }
      toast("✓ Partido actualizado y apuestas reiniciadas", "info");
      document.getElementById("editMatch").value = "";
      document.getElementById("editMatchDate").value = "";
      document.getElementById("editRound").value = "";
      editExcludedPlayers = [];
      loadData();
    }
  });
}

function deleteWeek() {
  if (!currentWeek) return toast("No hay semana activa", "error");

  showModal({
    icon: "🗑️",
    title: "¿Eliminar semana?",
    body: `Se eliminará <strong>${currentWeek.match}</strong> y todas sus apuestas permanentemente.<br><br>Esta acción no se puede deshacer.`,
    confirmText: "Eliminar definitivamente",
    danger: true,
    onConfirm: async () => {
      const data = await post("/delete-week", { week_id: currentWeek.id });
      if (data.error) { toast(data.error, "error"); return; }
      toast("Semana eliminada", "info");
      loadData();
    }
  });
}

async function closeWeek() {
  if (!currentWeek) return toast("No hay semana activa", "error");

  const local = document.getElementById("realLocal").value.trim();
  const visit = document.getElementById("realVisit").value.trim();
  if (local === "" || visit === "") return toast("Introduce el resultado real", "error");

  const real_result = `${local}-${visit}`;
  const weeklyRaw = document.getElementById("weeklyAmount").value;
  const weekly_amount = weeklyRaw === "" ? null : parseInt(weeklyRaw);

  const data = await post("/close-week", { week_id: currentWeek.id, real_result, weekly_amount });
  toast(data.message || "Semana cerrada", "info");
  document.getElementById("realLocal").value = "";
  document.getElementById("realVisit").value = "";
  document.getElementById("weeklyAmount").value = "";
  payments = [];
  toggleAdmin();
  loadData();

}

// ===================== HISTORY =====================



// ===================== SEASONS =====================
function getSeason(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12
  return month >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

function getSeasons(weeks) {
  const seasons = new Set();
  weeks.forEach(w => {
    const s = getSeason(w.match_date || w.created_at);
    if (s) seasons.add(s);
  });
  return [...seasons].sort().reverse();
}

function renderSeasonFilter(weeks) {
  const seasons = getSeasons(weeks);
  const container = document.getElementById("seasonFilter");
  if (!container) return;
  container.innerHTML = "";

  const label = document.createElement("span");
  label.className = "season-label";
  label.textContent = "⚽ Temporada:";
  container.appendChild(label);

  const sel = document.createElement("select");
  sel.className = "season-select";
  sel.innerHTML = '<option value="all">Todas</option>' +
    seasons.map(s => '<option value="' + s + '"' + (currentSeason === s ? ' selected' : '') + '>' + s + '</option>').join("");
  sel.value = currentSeason;
  sel.onchange = () => { currentSeason = sel.value; applySeasonFilter(); };
  container.appendChild(sel);
}

function filterWeeksBySeason(weeks) {
  if (currentSeason === "all") return weeks;
  return weeks.filter(w => getSeason(w.match_date || w.created_at) === currentSeason);
}

function applySeasonFilter() {
  const filtered = filterWeeksBySeason(allHistoryData);
  renderHistory(filtered);
  renderRankingsFromWeeks(filtered);
}

async function loadHistory() {
  historyPage = 5;
  const res = await api("/history?limit=100&offset=0");
  const weeks = res.weeks || (Array.isArray(res) ? res : []);
  allHistoryData = weeks;
  document.getElementById("historyList")?.classList.remove("hidden");
  renderSeasonFilter(allHistoryData);
  renderRankingsFromWeeks(filterWeeksBySeason(allHistoryData));
  renderHistory(filterWeeksBySeason(allHistoryData));
}

function buildHistoryBody(w) {
  const predsHTML = w.predictions?.length
    ? w.predictions.map(pr => `
        <div class="hist-pred ${pr.correct ? "correct" : ""}">
          <span class="hist-pred-order">#${pr.order}</span>
          <span class="hist-pred-name">${pr.player_name}</span>
          <span class="hist-pred-result">${pr.result}</span>
          ${pr.correct ? '<span class="hist-pred-badge">&#10003;</span>' : ''}
        </div>`).join("")
    : '<p class="empty-state" style="padding:6px 0;font-size:12px">Nadie apostó</p>';

  const excludedHTML = w.excluded?.length
    ? `<div class="hist-excluded">No jugaron: ${w.excluded.join(", ")}</div>` : "";

  const payList = w.payments || [];
  const paidCount = payList.filter(pay => pay.paid).length;
  const paymentsHTML = payList.length
    ? '<div class="history-payments">' + payList.map(pay =>
        '<span class="history-pay-badge ' + (pay.paid ? "paid" : "unpaid") + '">' +
        (pay.paid ? "&#10003;" : "&#10007;") + " " + pay.name + '</span>'
      ).join("") + '</div>'
    : "";

  return `
    <div class="hist-section-title">⚽ Apuestas · <span style="color:var(--text-muted);font-size:12px">${w.weekly_amount || 1}€/persona${excludedHTML ? " · " + w.excluded?.join(", ") + " no jugaron" : ""}</span></div>
    <div class="hist-preds-grid">${predsHTML}</div>
    ${payList.length ? `<div class="hist-section-title" style="margin-top:10px">💶 Pagos (${paidCount}/${payList.length})</div>${paymentsHTML}` : ""}
  `;
}

function renderHistory(weeks) {
  const container = document.getElementById("historyList");

  if (!weeks?.length) {
    container.innerHTML = '<p class="empty-state">No hay semanas cerradas todavía.</p>';
    return;
  }

  container.innerHTML = "";
  const teamsMap = {};
  teams.forEach(t => { teamsMap[t.id] = t; });
  const visible = weeks.slice(0, historyPage);
  const fragment = document.createDocumentFragment();

  visible.forEach(w => {
    let matchDateStr = "";
    if (w.match_date) {
      try {
        const d = new Date(w.match_date.length === 16 ? w.match_date + ":00" : w.match_date);
        if (!isNaN(d)) matchDateStr = d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
      } catch(e) {}
    }

    const roundLabel = w.round_number
      ? (w.round_number.toUpperCase().startsWith("JORNADA") ? w.round_number.toUpperCase() : `JORNADA ${w.round_number.toUpperCase()}`)
      : "";
    const roundStr = roundLabel ? `<span class="history-round">${roundLabel}</span>` : "";
    const hHome = teamsMap[w.home_team_id];
    const hAway = teamsMap[w.away_team_id];
    const hasWinner = !!w.winners;

    const div = document.createElement("div");
    div.className = "history-item history-accordion";
    div.innerHTML = `
      <div class="history-header">
        ${roundStr ? '<div class="history-round-row">' + roundStr + '</div>' : ""}
        <div class="history-teams-row">
          <div class="history-badge-left">${hHome ? teamBadge(hHome.slug, 44) : '<div class="hist-badge-empty"></div>'}</div>
          <div class="history-center-inline">
            <div class="history-match-name">${w.match}</div>
            <div class="history-result-row">
              <span class="history-result ${hasWinner ? "winner" : "no-winner"}">${w.real_result || "—"}</span>
              ${w.pot ? '<span class="history-pot">💰 ' + w.pot + '€</span>' : ""}
            </div>
          </div>
          <div class="history-badge-right">${hAway ? teamBadge(hAway.slug, 44) : '<div class="hist-badge-empty"></div>'}</div>
        </div>
        <div class="history-meta-row">
          <span class="history-meta">${matchDateStr ? matchDateStr + " · " : ""}${hasWinner ? "🏆 " + w.winners : "Sin acertantes"}</span>
          <span class="history-chevron">▾</span>
        </div>
      </div>
      <div class="history-body"></div>
    `;

    // Lazy body: only build content when accordion opens
    div.addEventListener("click", () => {
      const body = div.querySelector(".history-body");
      if (!body.dataset.loaded) {
        body.innerHTML = buildHistoryBody(w);
        body.dataset.loaded = "1";
      }
      div.classList.toggle("open");
    });

    fragment.appendChild(div);
  });

  container.appendChild(fragment);

  const btnBar = document.createElement("div");
  btnBar.style.cssText = "display:flex;gap:8px;margin-top:10px;";

  if (weeks.length > historyPage) {
    const btnMore = document.createElement("button");
    btnMore.type = "button";
    btnMore.className = "btn btn-ghost";
    btnMore.style.cssText = "flex:1;font-size:13px;";
    btnMore.textContent = `Ver más (${weeks.length - historyPage} restantes)`;
    btnMore.onclick = () => { historyPage += 10; renderHistory(weeks); };
    btnBar.appendChild(btnMore);
  }

  if (historyPage > 5) {
    const btnLess = document.createElement("button");
    btnLess.type = "button";
    btnLess.className = "btn btn-ghost";
    btnLess.style.cssText = "flex:1;font-size:13px;";
    btnLess.textContent = "Ver menos";
    btnLess.onclick = () => { historyPage = 5; renderHistory(weeks); container.scrollIntoView({ behavior: "smooth" }); };
    btnBar.appendChild(btnLess);
  }

  if (btnBar.children.length) container.appendChild(btnBar);
}

// ===================== RANKINGS =====================
async function loadRankings() {
  rankingsData = await api("/rankings");
  renderRankings();
}

function renderRankingsFromWeeks(weeks) {
  // Recalculate rankings based on filtered weeks
  const weekIds = new Set(weeks.map(w => w.id));
  const filtered = rankingsData.map(player => {
    // Filter predictions to only those in selected weeks
    const wins = weeks.filter(w =>
      w.predictions?.some(pr => pr.player_name === player.name && pr.correct)
    ).length;
    const moneyWon = weeks
      .filter(w => w.predictions?.some(pr => pr.player_name === player.name && pr.correct))
      .reduce((sum, w) => sum + (parseInt(w.pot) || 0), 0);
    const totalPredictions = weeks.filter(w =>
      w.predictions?.some(pr => pr.player_name === player.name)
    ).length;
    return { ...player, wins, money_won: moneyWon, total_predictions: totalPredictions };
  });
  filtered.sort((a, b) => b.wins - a.wins || (b.money_won || 0) - (a.money_won || 0));
  renderRankings(filtered);
}

function toggleActiveOnly() {
  showActiveOnly = !showActiveOnly;
  const btn = document.getElementById("activeOnlySwitch");
  if (btn) btn.classList.toggle("active", showActiveOnly);
  applySeasonFilter();
}

function switchTab(tab, e) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  if (e?.target) e.target.classList.add("active");
  renderRankings();
}

function renderRankings(data) {
  const container = document.getElementById("rankingsList");
  let displayData = data || rankingsData;
  if (showActiveOnly) displayData = displayData.filter(p => p.active != 0);

  if (!displayData.length) {
    container.innerHTML = '<p class="empty-state">Aún no hay datos de ranking.</p>';
    return;
  }

  let sorted;
  if (currentTab === "wins") {
    sorted = [...displayData].sort((a, b) => b.wins - a.wins);
  } else if (currentTab === "money") {
    sorted = [...displayData].sort((a, b) => (b.money_won || 0) - (a.money_won || 0));
  } else {
    sorted = [...displayData].sort((a, b) => {
      const rA = a.total_predictions > 0 ? a.wins / a.total_predictions : 0;
      const rB = b.total_predictions > 0 ? b.wins / b.total_predictions : 0;
      return rB - rA;
    });
  }

  const medals = ["🥇", "🥈", "🥉"];

  container.innerHTML = "";
  sorted.forEach((p, i) => {
    const rate = p.total_predictions > 0 ? ((p.wins / p.total_predictions) * 100).toFixed(0) : 0;
    const displayValue = currentTab === "wins" ? p.wins : currentTab === "money" ? (p.money_won || 0) + "€" : rate + "%";
    const spent = p.money_spent || 0;
    const subText = currentTab === "wins"
      ? `${p.money_won || 0}€ ganados · ${rate}% acierto · ${p.total_predictions} apuestas · ${spent}€ invertidos`
      : currentTab === "money"
      ? `${p.wins} victorias · ${rate}% acierto · ${spent}€ invertidos`
      : `${p.wins} victorias · ${p.total_predictions} apuestas · ${spent}€ invertidos`;

    const div = document.createElement("div");
    div.className = "ranking-item" + (p.active == 0 ? " inactive-player" : "");
    div.innerHTML = `
      <span class="ranking-pos">${i + 1}</span>
      <span class="ranking-medal">${medals[i] || ""}</span>
      <span class="ranking-name">${p.name}${p.active == 0 ? ' <span class="inactive-tag">inactivo</span>' : ''}</span>
      <div style="text-align:right">
        <div class="ranking-value">${displayValue}</div>
        <div class="ranking-sub">${subText}</div>
      </div>
    `;
    container.appendChild(div);
  });
}


// ===================== SHARE / CAPTURE =====================
async function captureAndShare() {
  const btn = document.querySelector(".btn-share");
  if (btn) { btn.disabled = true; btn.textContent = "⏳ Generando..."; }

  const firma = document.getElementById("scoreboardFirma");
  if (firma) firma.classList.add("visible");

  const scoreboard = document.getElementById("scoreboard");
  const playersCard = document.getElementById("playersList").closest(".card");

  const wrapper = document.createElement("div");
  wrapper.style.cssText = "background:#0a0e1a;padding:20px;display:flex;flex-direction:column;gap:20px;width:" + scoreboard.offsetWidth + "px;position:fixed;left:-9999px;top:0;";
  wrapper.appendChild(scoreboard.cloneNode(true));
  wrapper.appendChild(playersCard.cloneNode(true));
  document.body.appendChild(wrapper);

  try {
    // 🔧 FIX: Convertir SVGs a PNG para móviles
    const svgElements = wrapper.querySelectorAll('img[src$=".svg"]');
    const conversionPromises = [];
    
    svgElements.forEach(img => {
      const promise = new Promise((resolve) => {
        if (img.complete && img.naturalWidth > 0) {
          convertSvgToDataUrl(img).then(() => resolve());
        } else {
          img.onload = () => {
            convertSvgToDataUrl(img).then(() => resolve());
          };
          img.onerror = () => resolve();
        }
      });
      conversionPromises.push(promise);
    });
    
    await Promise.all(conversionPromises);
    await new Promise(resolve => setTimeout(resolve, 300));

    const canvas = await html2canvas(wrapper, {
      backgroundColor: "#0a0e1a",
      scale: 2,
      useCORS: true,
      allowTaint: true,
      logging: false,
      imageTimeout: 0,
      removeContainer: false
    });

    const link = document.createElement("a");
    link.download = "porra_" + (currentWeek?.match || "semana").replace(/[^a-z0-9]/gi, "_").toLowerCase() + ".png";
    link.href = canvas.toDataURL("image/png");
    link.click();

    toast("✓ Imagen descargada", "success");
  } catch(err) {
    toast("Error al generar imagen", "error");
    console.error(err);
  } finally {
    document.body.removeChild(wrapper);
    if (firma) firma.classList.remove("visible");
    if (btn) { btn.disabled = false; btn.textContent = "📸 Compartir apuestas"; }
  }
}

async function convertSvgToDataUrl(imgElement) {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.crossOrigin = 'anonymous';
      
      img.onload = () => {
        canvas.width = imgElement.width || imgElement.offsetWidth || 50;
        canvas.height = imgElement.height || imgElement.offsetHeight || 50;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        try {
          const dataUrl = canvas.toDataURL('image/png');
          imgElement.src = dataUrl;
          resolve();
        } catch (e) {
          console.warn('Error converting SVG:', e);
          resolve();
        }
      };
      
      img.onerror = () => {
        console.warn('Error loading SVG');
        resolve();
      };
      
      img.src = imgElement.src;
    } catch (e) {
      console.warn('Error in convertSvgToDataUrl:', e);
      resolve();
    }
  });
}

// ===================== ADMIN DRAWER =====================
function toggleAdmin() {
  if (currentUser && currentUser.role !== 'admin') {
    return toast("No tienes permisos de administrador", "error");
  }
  
  const drawer = document.getElementById("adminDrawer");
  const overlay = document.getElementById("drawerOverlay");
  const isOpen = drawer.classList.contains("open");

  if (isOpen) {
    drawer.classList.remove("open");
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
  } else {
    if (currentWeek) {
      document.getElementById("editMatch").value = currentWeek.match || "";
      document.getElementById("editRound").value = currentWeek.round_number || "";
      if (currentWeek.match_date) {
        document.getElementById("editMatchDate").value = currentWeek.match_date.slice(0, 16);
      }
      editExcludedPlayers = getExcludedForCurrentWeek();
    }
    renderExcludeLists();
    renderManagePlayers();
    renderManageTeams();
    renderTeamSelectors("newHomeTeam", "newAwayTeam");
    renderTeamSelectors("editHomeTeam", "editAwayTeam", currentWeek?.home_team_id, currentWeek?.away_team_id);
    drawer.classList.add("open");
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
}
// ===================== ADMIN DRAWER =====================
function toggleAdmin() {
  const drawer = document.getElementById("adminDrawer");
  const overlay = document.getElementById("drawerOverlay");
  const isOpen = drawer.classList.contains("open");

  if (isOpen) {
    drawer.classList.remove("open");
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
  } else {
    // Pre-fill edit fields with current week data
    if (currentWeek) {
      document.getElementById("editMatch").value = currentWeek.match || "";
      document.getElementById("editRound").value = currentWeek.round_number || "";
      if (currentWeek.match_date) {
        document.getElementById("editMatchDate").value = currentWeek.match_date.slice(0, 16);
      }
      editExcludedPlayers = getExcludedForCurrentWeek();
    }
    renderExcludeLists();
    renderManagePlayers();
    renderManageTeams();
    renderTeamSelectors("newHomeTeam", "newAwayTeam");
    renderTeamSelectors("editHomeTeam", "editAwayTeam", currentWeek?.home_team_id, currentWeek?.away_team_id);
    drawer.classList.add("open");
    overlay.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }
}

// ===================== MODAL =====================
let modalCallback = null;

function showModal({ icon, title, body, confirmText, danger, onConfirm }) {
  document.getElementById("modalIcon").textContent = icon || "⚠️";
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = body;
  const btn = document.getElementById("modalConfirmBtn");
  btn.textContent = confirmText || "Confirmar";
  btn.className = "btn btn-confirm" + (danger ? " danger" : "");
  modalCallback = onConfirm;
  document.getElementById("modalOverlay").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.add("hidden");
  modalCallback = null;
}

document.getElementById("modalConfirmBtn").addEventListener("click", () => {
  if (modalCallback) modalCallback();
  closeModal();
});

document.getElementById("modalOverlay").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ===================== BACKUP / RESTORE / RESET =====================
function exportData() {
  window.location.href = "/api/export";
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch {
      return toast("Archivo JSON inválido", "error");
    }

    showModal({
      icon: "⬆️",
      title: "¿Restaurar datos?",
      body: `Se importarán <strong>${data.players?.length || 0} jugadores</strong>, <strong>${data.weeks?.length || 0} semanas</strong> y <strong>${data.predictions?.length || 0} apuestas</strong>.<br><br>⚠️ Los datos actuales se reemplazarán completamente.`,
      confirmText: "Sí, restaurar",
      danger: true,
      onConfirm: async () => {
        const res = await post("/api/import", data);
        if (res.error) {
          toast(res.error, "error");
        } else {
          toast(`✓ ${res.message}`, "success");
          toggleAdmin();
          loadData();
        }
        document.getElementById("importFile").value = "";
      }
    });
  };
  reader.readAsText(file);
}

function resetAll() {
  showModal({
    icon: "☢️",
    title: "¿Borrar todo?",
    body: "Se eliminarán <strong>todos los jugadores, semanas y apuestas</strong> de la base de datos.<br><br>Esta acción es <strong>irreversible</strong>. Descarga una copia antes si no quieres perder los datos.",
    confirmText: "Borrar todo",
    danger: true,
    onConfirm: async () => {
      const res = await post("/api/reset", {});
      if (res.error) {
        toast(res.error, "error");
      } else {
        toast("Base de datos limpiada", "info");
        toggleAdmin();
        loadData();
      }
    }
  });
}

// ===================== TOAST =====================
let toastTimer;
function toast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

// ===================== KEYBOARD & AUTO-JUMP =====================
document.addEventListener("DOMContentLoaded", () => {
  const autoJump = (fromId, toId) => {
    const el = document.getElementById(fromId);
    if (!el) return;
    el.addEventListener("input", () => {
      if (el.value.length >= 2 || (el.value !== "" && parseInt(el.value) >= 10)) {
        document.getElementById(toId)?.focus();
      }
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "-") {
        e.preventDefault();
        document.getElementById(toId)?.focus();
      }
    });
  };

  autoJump("resultLocal", "resultVisit");
  autoJump("realLocal", "realVisit");

  document.getElementById("resultVisit")?.addEventListener("keydown", e => {
    if (e.key === "Enter") sendPrediction();
  });

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const drawer = document.getElementById("adminDrawer");
    if (drawer?.classList.contains("open")) toggleAdmin();
    else closeModal();
  });
});

// =====================================================
// 🔥 FIREBASE: GESTIÓN DE USUARIOS (SOLO ADMIN)
// =====================================================

function renderUserManagement() {
  // Llenar select de jugadores
  const select = document.getElementById("userPlayerSelect");
  if (!select) return;
  
  select.innerHTML = '<option value="">Selecciona un jugador...</option>';
  players.forEach(p => {
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = `${p.name}${p.email ? ' (' + p.email + ')' : ''}`;
    select.appendChild(option);
  });
  
  // Renderizar lista de usuarios
  renderUserList();
}

async function associateEmail() {
  const playerId = document.getElementById("userPlayerSelect").value;
  const email = document.getElementById("userEmail").value.trim().toLowerCase();
  
  if (!playerId || !email) {
    return toast("Selecciona un jugador e introduce un email", "error");
  }
  
  if (!email.includes("@")) {
    return toast("Email inválido", "error");
  }
  
  try {
    const data = await post("/api/associate-email", { player_id: parseInt(playerId), email });
    if (data.error) {
      return toast(data.error, "error");
    }
    toast("✓ Email asociado correctamente", "success");
    document.getElementById("userEmail").value = "";
    document.getElementById("userPlayerSelect").value = "";
    await loadPlayers();
    renderManagePlayers();
    renderUserManagement();
  } catch (err) {
    toast(err.message || "Error al asociar email", "error");
  }
}

async function changeUserRole(playerId, newRole) {
  const player = players.find(p => p.id === playerId);
  if (!player) return;
  
  const confirmMsg = newRole === 'admin' 
    ? `¿Hacer a ${player.name} administrador? Tendrá acceso total al panel de administración.`
    : `¿Quitar permisos de administrador a ${player.name}? Solo podrá hacer sus propias apuestas.`;
  
  showModal({
    icon: "👤",
    title: "Cambiar rol de usuario",
    body: confirmMsg,
    confirmText: "Sí, cambiar rol",
    danger: newRole === 'player',
    onConfirm: async () => {
      try {
        const data = await post("/api/change-role", { player_id: playerId, role: newRole });
        if (data.error) {
          return toast(data.error, "error");
        }
        toast(`✓ Rol de ${player.name} actualizado a ${newRole === 'admin' ? 'Administrador' : 'Jugador'}`, "success");
        await loadPlayers();
        renderUserManagement();
      } catch (err) {
        toast("Error al cambiar rol", "error");
      }
    }
  });
}

function renderUserList() {
  const container = document.getElementById("usersList");
  if (!container) return;
  
  container.innerHTML = "";
  
  // Ordenar: primero admins, luego jugadores con email, luego sin email
  const sorted = [...players].sort((a, b) => {
    if (a.role === 'admin' && b.role !== 'admin') return -1;
    if (a.role !== 'admin' && b.role === 'admin') return 1;
    if (a.email && !b.email) return -1;
    if (!a.email && b.email) return 1;
    return 0;
  });
  
  sorted.forEach(p => {
    const div = document.createElement("div");
    div.className = "user-item";
    div.innerHTML = `
      <div class="user-info">
        <div class="user-name">${p.name}</div>
        <div class="user-email">${p.email || '<span style="color:#6b7a99">Sin email asociado</span>'}</div>
      </div>
      <div class="user-actions">
        <span class="user-role-badge ${p.role === 'admin' ? 'admin' : ''}">${p.role === 'admin' ? 'ADMIN' : 'Jugador'}</span>
        ${p.role === 'admin' 
          ? `<button class="btn-mini btn-red" onclick="changeUserRole(${p.id}, 'player')">Quitar Admin</button>`
          : `<button class="btn-mini btn-green" onclick="changeUserRole(${p.id}, 'admin')">Hacer Admin</button>`
        }
      </div>
    `;
    container.appendChild(div);
  });
  
  if (sorted.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:#6b7a99;font-size:13px">No hay jugadores</div>';
  }
}