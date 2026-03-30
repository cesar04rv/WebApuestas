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
let editExcludedPlayers = [];
let teams = [];

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
  calculateTurn();
  renderPlayers();
  renderReorder();
  renderManagePlayers();
  renderExcludeLists();
  await loadRankings();
  await loadHistoryData();
  document.getElementById("playersCount").textContent = players.filter(p => p.active).length;
  if (historyVisible) renderHistory(filterWeeksBySeason(allHistoryData));
}

async function loadHistoryData() {
  const weeks = await api("/history");
  allHistoryData = weeks || [];
  renderSeasonFilter(allHistoryData);
  renderRankingsFromWeeks(filterWeeksBySeason(allHistoryData));
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
  document.getElementById("potInfo").textContent =
    currentWeek.pot > 0 ? `💰 Bote: ${currentWeek.pot} €` : "";
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
  return `<img src="/Escudos/${slug}.svg" width="${size}" height="${size}" style="vertical-align:middle;object-fit:contain;margin:0 2px" onerror="this.style.display='none'">`;
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
  const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name));
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
    return;
  }
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

  players.forEach(p => {
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
function renderReorder() {
  const container = document.getElementById("reorderList");
  container.innerHTML = "";
  const activePlayers = players.filter(p => p.active).sort((a, b) => a.order_position - b.order_position);

  activePlayers.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "reorder-item";
    div.innerHTML = `
      <span class="reorder-pos">${i + 1}</span>
      <span class="reorder-name">${p.name}</span>
      <button type="button" class="btn-move" onclick="moveUp(${p.id})">▲</button>
      <button type="button" class="btn-move" onclick="moveDown(${p.id})">▼</button>
    `;
    container.appendChild(div);
  });
}

function moveUp(id) {
  const activePlayers = players.filter(p => p.active).sort((a, b) => a.order_position - b.order_position);
  const index = activePlayers.findIndex(p => p.id === id);
  if (index > 0) {
    [activePlayers[index].order_position, activePlayers[index - 1].order_position] =
      [activePlayers[index - 1].order_position, activePlayers[index].order_position];
    players.sort((a, b) => a.order_position - b.order_position);
    renderReorder(); renderPlayers();
  }
}

function moveDown(id) {
  const activePlayers = players.filter(p => p.active).sort((a, b) => a.order_position - b.order_position);
  const index = activePlayers.findIndex(p => p.id === id);
  if (index < activePlayers.length - 1) {
    [activePlayers[index].order_position, activePlayers[index + 1].order_position] =
      [activePlayers[index + 1].order_position, activePlayers[index].order_position];
    players.sort((a, b) => a.order_position - b.order_position);
    renderReorder(); renderPlayers();
  }
}

async function saveOrder() {
  const orders = players.filter(p => p.active).map(p => ({ id: p.id, order_position: p.order_position }));
  await post("/reorder-players", { orders });
  toast("Orden guardado ✓", "success");
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
  if (historyVisible) loadHistory();
}

// ===================== HISTORY =====================
async function toggleHistory() {
  historyVisible = !historyVisible;
  const container = document.getElementById("historyList");
  if (historyVisible) {
    container.classList.remove("hidden");
    loadHistory();
  } else {
    container.classList.add("hidden");
  }
}


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

  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "season-btn" + (currentSeason === "all" ? " active" : "");
  allBtn.textContent = "Todas";
  allBtn.onclick = () => { currentSeason = "all"; applySeasonFilter(); };
  container.appendChild(allBtn);

  seasons.forEach(s => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "season-btn" + (currentSeason === s ? " active" : "");
    btn.textContent = s;
    btn.onclick = () => { currentSeason = s; applySeasonFilter(); };
    container.appendChild(btn);
  });
}

function filterWeeksBySeason(weeks) {
  if (currentSeason === "all") return weeks;
  return weeks.filter(w => getSeason(w.match_date || w.created_at) === currentSeason);
}

function applySeasonFilter() {
  // Update season buttons
  document.querySelectorAll(".season-btn").forEach(btn => {
    btn.classList.toggle("active", btn.textContent === currentSeason || (currentSeason === "all" && btn.textContent === "Todas"));
  });
  // Re-render history and rankings with filter
  renderHistory(filterWeeksBySeason(allHistoryData));
  renderRankingsFromWeeks(filterWeeksBySeason(allHistoryData));
}

async function loadHistory() {
  if (!allHistoryData.length) {
    const weeks = await api("/history");
    allHistoryData = weeks || [];
    renderSeasonFilter(allHistoryData);
    renderRankingsFromWeeks(filterWeeksBySeason(allHistoryData));
  }
  renderHistory(filterWeeksBySeason(allHistoryData));
}

function renderHistory(weeks) {
  const container = document.getElementById("historyList");

  if (!weeks?.length) {
    container.innerHTML = '<p class="empty-state">No hay semanas cerradas todavía.</p>';
    return;
  }

  container.innerHTML = "";
  weeks.forEach(w => {
    let dateStr = "";
    if (w.created_at) {
      try {
        const d = new Date(w.created_at);
        dateStr = d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
      } catch(e) { dateStr = w.created_at; }
    }

    let matchDateStr = "";
    if (w.match_date) {
      try {
        const d = new Date(w.match_date);
        matchDateStr = " · " + d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
      } catch(e) {}
    }

    const roundLabel = w.round_number
      ? (w.round_number.toUpperCase().startsWith("JORNADA") ? w.round_number.toUpperCase() : `JORNADA ${w.round_number.toUpperCase()}`)
      : "";
    const roundStr = roundLabel ? `<span class="history-round">${roundLabel}</span>` : "";

    const hHome = teams.find(t => t.id === w.home_team_id);
    const hAway = teams.find(t => t.id === w.away_team_id);
    const hasWinner = !!w.winners;

    // Predictions
    const predsHTML = w.predictions?.length
      ? w.predictions.map(pr => `
          <div class="hist-pred ${pr.correct ? "correct" : ""}">
            <span class="hist-pred-order">#${pr.order}</span>
            <span class="hist-pred-name">${pr.player_name}</span>
            <span class="hist-pred-result">${pr.result}</span>
            ${pr.correct ? '<span class="hist-pred-badge">&#10003;</span>' : ''}
          </div>`).join("")
      : '<p class="empty-state" style="padding:6px 0;font-size:12px">Nadie apost&#243;</p>';

    // Excluded
    const excludedHTML = w.excluded?.length
      ? `<div class="hist-excluded">No jugaron: ${w.excluded.join(", ")}</div>`
      : "";

    // Payments
    const payList = w.payments || [];
    const paidCount = payList.filter(pay => pay.paid).length;
    const paymentsHTML = payList.length
      ? '<div class="history-payments">' + payList.map(pay =>
          '<span class="history-pay-badge ' + (pay.paid ? "paid" : "unpaid") + '">' + (pay.paid ? "&#10003;" : "&#10007;") + " " + pay.name + '</span>'
        ).join("") + '</div>'
      : "";

    const div = document.createElement("div");
    div.className = "history-item history-accordion";
    div.innerHTML = `
      <div class="history-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="history-header-left">
          ${roundStr ? '<div class="history-round-row">' + roundStr + '</div>' : ""}
          <div class="history-match">
            ${hHome ? teamBadge(hHome.slug, 18) : ""}
            ${w.match}
            ${hAway ? teamBadge(hAway.slug, 18) : ""}
          </div>
          <div class="history-result-row">
            <span class="history-result ${hasWinner ? "winner" : "no-winner"}">${w.real_result || "—"}</span>
            ${w.pot ? '<span class="history-pot">💰 ' + w.pot + '€</span>' : ""}
            <span class="history-chevron">▾</span>
          </div>
          <div class="history-meta">
            ${dateStr}${matchDateStr} · ${hasWinner ? "🏆 " + w.winners : "Sin acertantes"}
          </div>
        </div>
      </div>
      <div class="history-body">
        <div class="hist-section-title">⚽ Apuestas · <span style="color:var(--text-muted);font-size:12px">${w.weekly_amount || 1}€/persona${excludedHTML ? " · " + w.excluded?.join(", ") + " no jugaron" : ""}</span></div>
        <div class="hist-preds-grid">${predsHTML}</div>
        ${payList.length ? `<div class="hist-section-title" style="margin-top:10px">💶 Pagos (${paidCount}/${payList.length})</div>${paymentsHTML}` : ""}
      </div>
    `;
    container.appendChild(div);
  });
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

function switchTab(tab, e) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  if (e?.target) e.target.classList.add("active");
  renderRankings();
}

function renderRankings(data) {
  const container = document.getElementById("rankingsList");
  const displayData = data || rankingsData;

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
    const subText = currentTab === "wins"
      ? `${p.money_won || 0}€ ganados · ${rate}% acierto · ${p.total_predictions} apuestas`
      : currentTab === "money"
      ? `${p.wins} victorias · ${rate}% acierto`
      : `${p.wins} victorias · ${p.total_predictions} apuestas`;

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