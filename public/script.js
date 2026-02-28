// ===================== STATE =====================
let currentWeek = null;
let players = [];
let predictions = [];
let currentTurnPlayer = null;
let historyVisible = false;

// ===================== INIT =====================
loadData();

async function loadData() {
  await loadPlayers();
  await loadWeek();
  await loadPredictions();
  calculateTurn();
  renderPlayers();
  renderReorder();
  loadRankings();
  document.getElementById("playersCount").textContent = players.length;
}

// ===================== FETCH HELPERS =====================
async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  return res.json();
}

async function post(url, body) {
  return api(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

// ===================== LOADERS =====================
async function loadPlayers() {
  players = await api("/players");
}

async function loadWeek() {
  currentWeek = await api("/current-week");

  if (!currentWeek) {
    document.getElementById("weekInfo").textContent = "Sin semana activa";
    document.getElementById("potInfo").textContent = "";
    document.getElementById("weekStatus").textContent = "Crea una nueva semana desde Admin";
    document.getElementById("turnBanner").classList.add("hidden");
    return;
  }

  document.getElementById("weekInfo").textContent = currentWeek.match;
  document.getElementById("potInfo").textContent =
    currentWeek.pot > 0 ? `💰 Bote: ${currentWeek.pot} €` : "";
  document.getElementById("weekStatus").textContent = "SEMANA EN CURSO";
  document.getElementById("turnBanner").classList.remove("hidden");
}

async function loadPredictions() {
  if (!currentWeek) { predictions = []; return; }
  predictions = await api("/predictions/" + currentWeek.id);
}

// ===================== TURN =====================
function calculateTurn() {
  if (!currentWeek || players.length === 0) {
    currentTurnPlayer = null;
    document.getElementById("currentTurnName").textContent = "—";
    return;
  }

  const pending = players.filter(p => !predictions.find(pr => pr.player_id === p.id));

  if (pending.length === 0) {
    currentTurnPlayer = null;
    document.getElementById("currentTurnName").textContent = "Todos han apostado";
    return;
  }

  const turnIndex = predictions.length % players.length;
  currentTurnPlayer = players[turnIndex];
  document.getElementById("currentTurnName").textContent = currentTurnPlayer.name.toUpperCase();
}

// ===================== RENDER PLAYERS =====================
function renderPlayers() {
  const container = document.getElementById("playersList");
  container.innerHTML = "";

  if (players.length === 0) {
    container.innerHTML = '<p class="empty-state">No hay jugadores todavía. Añade desde Admin.</p>';
    return;
  }

  players.forEach((p, i) => {
    const prediction = predictions.find(pr => pr.player_id === p.id);
    const isTurn = currentTurnPlayer && p.id === currentTurnPlayer.id;

    const div = document.createElement("div");
    div.className = "player-card" +
      (isTurn ? " turn" : "") +
      (prediction ? " played" : "");

    div.innerHTML = `
      <div class="player-position">#${i + 1}</div>
      <div class="player-name">${p.name}</div>
      <div class="player-result ${prediction ? "" : "empty"}">
        ${prediction ? prediction.result : "Sin apostar"}
      </div>
    `;

    container.appendChild(div);
  });
}

// ===================== RENDER REORDER =====================
function renderReorder() {
  const container = document.getElementById("reorderList");
  container.innerHTML = "";

  players.sort((a, b) => a.order_position - b.order_position);

  players.forEach((p, i) => {
    const div = document.createElement("div");
    div.className = "reorder-item";
    div.innerHTML = `
      <span class="reorder-pos">${i + 1}</span>
      <span class="reorder-name">${p.name}</span>
      <button class="btn-move" onclick="moveUp(${p.id})">▲</button>
      <button class="btn-move" onclick="moveDown(${p.id})">▼</button>
    `;
    container.appendChild(div);
  });
}

function moveUp(id) {
  const index = players.findIndex(p => p.id === id);
  if (index > 0) {
    [players[index].order_position, players[index - 1].order_position] =
      [players[index - 1].order_position, players[index].order_position];
    players.sort((a, b) => a.order_position - b.order_position);
    renderReorder();
    renderPlayers();
  }
}

function moveDown(id) {
  const index = players.findIndex(p => p.id === id);
  if (index < players.length - 1) {
    [players[index].order_position, players[index + 1].order_position] =
      [players[index + 1].order_position, players[index].order_position];
    players.sort((a, b) => a.order_position - b.order_position);
    renderReorder();
    renderPlayers();
  }
}

async function saveOrder() {
  const orders = players.map(p => ({ id: p.id, order_position: p.order_position }));
  await post("/reorder-players", { orders });
  toast("Orden guardado ✓", "success");
  loadData();
}

// ===================== ACTIONS =====================
async function sendPrediction() {
  if (!currentWeek) return toast("No hay semana activa", "error");
  if (!currentTurnPlayer) return toast("No hay turno activo", "error");

  const result = document.getElementById("resultInput").value.trim();
  if (!result) return toast("Introduce un resultado", "error");

  // Basic format validation: digits-digits
  if (!/^\d+-\d+$/.test(result)) {
    return toast("Formato: 2-1 (goles local - goles visitante)", "error");
  }

  const data = await post("/predict", {
    week_id: currentWeek.id,
    player_id: currentTurnPlayer.id,
    result
  });

  if (data.error) {
    toast(data.error, "error");
  } else {
    toast(`✓ ${currentTurnPlayer.name} apostó ${result}`, "success");
    document.getElementById("resultInput").value = "";
    loadData();
  }
}

async function addPlayer() {
  const name = document.getElementById("newPlayerName").value.trim();
  if (!name) return toast("Escribe un nombre", "error");

  const data = await post("/add-player", { name });
  if (data.error) {
    toast(data.error, "error");
  } else {
    toast(`✓ ${name} añadido`, "success");
    document.getElementById("newPlayerName").value = "";
    loadData();
  }
}

async function createWeek() {
  const match = document.getElementById("newMatch").value.trim();
  if (!match) return toast("Escribe el partido", "error");

  await post("/new-week", { match });
  toast("✓ Semana creada", "success");
  document.getElementById("newMatch").value = "";
  loadData();
}

async function closeWeek() {
  if (!currentWeek) return toast("No hay semana activa", "error");

  const real_result = document.getElementById("realResult").value.trim();
  const weekly_amount = parseInt(document.getElementById("weeklyAmount").value) || 0;

  if (!real_result) return toast("Introduce el resultado real", "error");

  const data = await post("/close-week", {
    week_id: currentWeek.id,
    real_result,
    weekly_amount
  });

  toast(data.message || "Semana cerrada", "info");
  document.getElementById("realResult").value = "";
  document.getElementById("weeklyAmount").value = "";
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

async function loadHistory() {
  const container = document.getElementById("historyList");
  const weeks = await api("/history");

  if (!weeks || weeks.length === 0) {
    container.innerHTML = '<p class="empty-state">No hay semanas cerradas todavía.</p>';
    return;
  }

  container.innerHTML = "";
  weeks.forEach(w => {
    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <div>
        <div class="history-match">${w.match}</div>
        <div class="history-winners">${w.winners || "Sin acertantes"}</div>
      </div>
      <div class="history-result">${w.real_result || "—"}</div>
      ${w.pot ? `<div class="history-pot">💰 ${w.pot}€</div>` : ""}
    `;
    container.appendChild(div);
  });
}

// ===================== RANKINGS =====================
let rankingsData = [];
let currentTab = "wins";

async function loadRankings() {
  rankingsData = await api("/rankings");
  renderRankings();
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  event.target.classList.add("active");
  renderRankings();
}

function renderRankings() {
  const container = document.getElementById("rankingsList");

  if (!rankingsData.length) {
    container.innerHTML = '<p class="empty-state">Aún no hay datos de ranking.</p>';
    return;
  }

  let sorted;
  if (currentTab === "wins") {
    sorted = [...rankingsData].sort((a, b) => b.wins - a.wins);
  } else if (currentTab === "money") {
    sorted = [...rankingsData].sort((a, b) => b.money_won - a.money_won);
  } else {
    sorted = [...rankingsData].sort((a, b) => {
      const rateA = a.total_predictions > 0 ? a.wins / a.total_predictions : 0;
      const rateB = b.total_predictions > 0 ? b.wins / b.total_predictions : 0;
      return rateB - rateA;
    });
  }

  const medals = ["🥇", "🥈", "🥉"];

  container.innerHTML = "";
  sorted.forEach((p, i) => {
    const rate = p.total_predictions > 0
      ? ((p.wins / p.total_predictions) * 100).toFixed(0)
      : 0;

    let mainValue, subText;
    if (currentTab === "wins") {
      mainValue = p.wins + (p.wins === 1 ? " victoria" : " victorias");
      subText = `${p.money_won || 0}€ ganados · ${rate}% acierto`;
    } else if (currentTab === "money") {
      mainValue = (p.money_won || 0) + "€";
      subText = `${p.wins} victorias · ${rate}% acierto`;
    } else {
      mainValue = rate + "%";
      subText = `${p.wins} victorias · ${p.total_predictions} apuestas`;
    }

    const div = document.createElement("div");
    div.className = "ranking-item";
    div.innerHTML = `
      <span class="ranking-pos">${i + 1}</span>
      <span class="ranking-medal">${medals[i] || ""}</span>
      <span class="ranking-name">${p.name}</span>
      <div style="text-align:right">
        <div class="ranking-value">${currentTab === "wins" ? p.wins : currentTab === "money" ? (p.money_won || 0) + "€" : rate + "%"}</div>
        <div class="ranking-sub">${subText}</div>
      </div>
    `;
    container.appendChild(div);
  });
}

// ===================== ADMIN TOGGLE =====================
function toggleAdmin() {
  const panel = document.getElementById("adminPanel");
  panel.classList.toggle("hidden");
}

// ===================== TOAST =====================
let toastTimer;
function toast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 3000);
}