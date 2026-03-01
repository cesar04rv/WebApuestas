// ===================== STATE =====================
let currentWeek = null;
let players = [];
let predictions = [];
let currentTurnPlayer = null;
let historyVisible = false;
let rankingsData = [];
let currentTab = "wins";

// ===================== INIT =====================
(async () => {
  // Verificar sesión
  const me = await api("/api/me").catch(() => null);
  if (!me || !me.authenticated) {
    window.location = "/login.html";
    return;
  }
  loadData();
})();

async function loadData() {
  await loadPlayers();
  await loadWeek();
  await loadPredictions();
  calculateTurn();
  renderPlayers();
  renderReorder();
  await loadRankings();
  document.getElementById("playersCount").textContent = players.length;
  if (historyVisible) loadHistory();
}

// ===================== FETCH =====================
async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location = "/login.html"; throw new Error("No autenticado"); }
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
  window.location = "/login.html";
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
    document.getElementById("weekDatetime").textContent = "";
    document.getElementById("weekStatus").textContent = "Crea una nueva semana desde Admin";
    document.getElementById("turnBanner").classList.add("hidden");
    return;
  }

  document.getElementById("weekInfo").textContent = currentWeek.match;
  document.getElementById("potInfo").textContent =
    currentWeek.pot > 0 ? `💰 Bote: ${currentWeek.pot} €` : "";
  document.getElementById("weekStatus").textContent = "SEMANA EN CURSO";
  document.getElementById("turnBanner").classList.remove("hidden");

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

// ===================== TURN =====================
function calculateTurn() {
  if (!currentWeek || players.length === 0) {
    currentTurnPlayer = null;
    document.getElementById("currentTurnName").textContent = "—";
    return;
  }

  const allPlayed = players.every(p => predictions.find(pr => pr.player_id === p.id));
  if (allPlayed) {
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
    div.className = "player-card" + (isTurn ? " turn" : "") + (prediction ? " played" : "");
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
    renderReorder(); renderPlayers();
  }
}

function moveDown(id) {
  const index = players.findIndex(p => p.id === id);
  if (index < players.length - 1) {
    [players[index].order_position, players[index + 1].order_position] =
      [players[index + 1].order_position, players[index].order_position];
    players.sort((a, b) => a.order_position - b.order_position);
    renderReorder(); renderPlayers();
  }
}

async function saveOrder() {
  const orders = players.map(p => ({ id: p.id, order_position: p.order_position }));
  await post("/reorder-players", { orders });
  toast("Orden guardado ✓", "success");
  loadData();
}

// ===================== ACTIONS =====================

// Apostar — con modal de confirmación
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

  const data = await post("/new-week", { match, match_date });
  if (data.error) { toast(data.error, "error"); return; }
  toast("✓ Semana creada", "success");
  document.getElementById("newMatch").value = "";
  document.getElementById("newMatchDate").value = "";
  toggleAdmin();
  loadData();
}

function editWeek() {
  if (!currentWeek) return toast("No hay semana activa", "error");
  const match = document.getElementById("editMatch").value.trim();
  if (!match) return toast("Escribe el nuevo nombre del partido", "error");
  const match_date = document.getElementById("editMatchDate").value || null;

  showModal({
    icon: "✏️",
    title: "¿Editar partido?",
    body: `El partido cambiará a <strong>${match}</strong>.<br><br>⚠️ Todas las apuestas actuales se eliminarán y se empezará desde cero.`,
    confirmText: "Sí, editar y borrar apuestas",
    danger: true,
    onConfirm: async () => {
      const data = await post("/edit-week", { week_id: currentWeek.id, match, match_date });
      if (data.error) { toast(data.error, "error"); return; }
      toast("✓ Partido actualizado y apuestas reiniciadas", "info");
      document.getElementById("editMatch").value = "";
      document.getElementById("editMatchDate").value = "";
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
  const weekly_amount = parseInt(document.getElementById("weeklyAmount").value) || 0;

  const data = await post("/close-week", { week_id: currentWeek.id, real_result, weekly_amount });
  toast(data.message || "Semana cerrada", "info");
  document.getElementById("realLocal").value = "";
  document.getElementById("realVisit").value = "";
  document.getElementById("weeklyAmount").value = "";
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

async function loadHistory() {
  const container = document.getElementById("historyList");
  const weeks = await api("/history");

  if (!weeks?.length) {
    container.innerHTML = '<p class="empty-state">No hay semanas cerradas todavía.</p>';
    return;
  }

  container.innerHTML = "";
  weeks.forEach(w => {
    // Formatear fecha de creación
    let dateStr = "";
    if (w.created_at) {
      try {
        const d = new Date(w.created_at);
        dateStr = d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
      } catch(e) {
        dateStr = w.created_at;
      }
    }

    // Fecha del partido si existe
    let matchDateStr = "";
    if (w.match_date) {
      try {
        const d = new Date(w.match_date);
        matchDateStr = " · " + d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
      } catch(e) {}
    }

    const div = document.createElement("div");
    div.className = "history-item";
    div.innerHTML = `
      <div>
        <div class="history-match">${w.match}</div>
        <div class="history-meta">
          ${dateStr}${matchDateStr} · ${w.winners ? "🏆 " + w.winners : "Sin acertantes"}
        </div>
      </div>
      <div class="history-result">${w.real_result || "—"}</div>
      <div class="history-pot">${w.pot ? "💰 " + w.pot + "€" : ""}</div>
    `;
    container.appendChild(div);
  });
}

// ===================== RANKINGS =====================
async function loadRankings() {
  rankingsData = await api("/rankings");
  renderRankings();
}

function switchTab(tab, e) {
  currentTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  if (e?.target) e.target.classList.add("active");
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
    sorted = [...rankingsData].sort((a, b) => (b.money_won || 0) - (a.money_won || 0));
  } else {
    sorted = [...rankingsData].sort((a, b) => {
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
      ? `${p.money_won || 0}€ ganados · ${rate}% acierto`
      : currentTab === "money"
      ? `${p.wins} victorias · ${rate}% acierto`
      : `${p.wins} victorias · ${p.total_predictions} apuestas`;

    const div = document.createElement("div");
    div.className = "ranking-item";
    div.innerHTML = `
      <span class="ranking-pos">${i + 1}</span>
      <span class="ranking-medal">${medals[i] || ""}</span>
      <span class="ranking-name">${p.name}</span>
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

  // Cerrar drawer o modal con Escape
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const drawer = document.getElementById("adminDrawer");
    if (drawer?.classList.contains("open")) toggleAdmin();
    else closeModal();
  });
});