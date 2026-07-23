const AGENTS = [
  { id: "pesquisa-mercado", name: "Ana", role: "Pesquisa de mercado", emoji: "🔍" },
  { id: "pesquisa-pauta", name: "Bruno", role: "Pesquisa de pauta", emoji: "🗂️" },
  { id: "redator", name: "Carla", role: "Redação", emoji: "✍️" },
  { id: "editor-seo", name: "Diego", role: "Editor / SEO", emoji: "🧐" },
  { id: "publicador", name: "Elis", role: "Publicação", emoji: "🚀" },
  { id: "indexador", name: "Fábio", role: "Indexação / Google", emoji: "📈" },
];

const floor = document.getElementById("floor");
const runBtn = document.getElementById("run-btn");
const topicLine = document.getElementById("topic-line");
const historyList = document.getElementById("history-list");
const toast = document.getElementById("toast");
const perfBody = document.getElementById("perf-body");
const perfUpdated = document.getElementById("perf-updated");
const refreshPerfBtn = document.getElementById("refresh-perf-btn");

function buildDesks() {
  for (const agent of AGENTS) {
    const desk = document.createElement("div");
    desk.className = "desk status-idle";
    desk.id = `desk-${agent.id}`;
    desk.innerHTML = `
      <div class="avatar-wrap">${agent.emoji}</div>
      <div class="name">${agent.name}</div>
      <div class="role">${agent.role}</div>
      <span class="status-badge">Ocioso</span>
      <div class="bubble"></div>
    `;
    floor.appendChild(desk);
  }
}

const STATUS_LABEL = { idle: "Ocioso", working: "Trabalhando", done: "Concluído", error: "Erro" };

function updateDesk(event) {
  const desk = document.getElementById(`desk-${event.agent}`);
  if (!desk) return;
  desk.className = `desk status-${event.status}`;
  desk.querySelector(".status-badge").textContent = STATUS_LABEL[event.status] ?? event.status;
  if (event.message) {
    desk.querySelector(".bubble").textContent = event.message;
  }
  if (event.tema) {
    topicLine.textContent = `Tema de hoje: ${event.tema}`;
  }
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function renderHistory(entries) {
  if (!entries.length) {
    historyList.innerHTML = `<li class="empty">Nenhum post publicado ainda.</li>`;
    return;
  }
  historyList.innerHTML = entries
    .map(
      (entry) => `
      <li>
        <span class="h-title">${entry.titulo}</span>
        <span class="h-date">${new Date(entry.publicadoEm).toLocaleString("pt-BR")}</span>
      </li>`,
    )
    .join("");
}

async function loadHistory() {
  const res = await fetch("/api/history");
  renderHistory(await res.json());
}

function renderPerformance(report) {
  if (!report || !report.posts || !report.posts.length) {
    perfBody.innerHTML = `<tr class="empty"><td colspan="6">Sem dados ainda. Clique em "Atualizar métricas".</td></tr>`;
    perfUpdated.textContent = "Nunca atualizado";
    return;
  }
  perfUpdated.textContent = `Atualizado ${new Date(report.atualizadoEm).toLocaleString("pt-BR")} · período ${report.periodo.inicio} a ${report.periodo.fim}`;
  perfBody.innerHTML = report.posts
    .map((p) => {
      const badge = p.erro
        ? `<span class="idx idx-err" title="${p.erro}">erro</span>`
        : p.indexado
        ? `<span class="idx idx-ok" title="${p.coverageState}">sim</span>`
        : `<span class="idx idx-no" title="${p.coverageState}">não</span>`;
      return `
      <tr>
        <td><a href="${p.url}" target="_blank" rel="noopener">${p.titulo}</a></td>
        <td>${badge}</td>
        <td>${p.clicks}</td>
        <td>${p.impressions}</td>
        <td>${(p.ctr * 100).toFixed(1)}%</td>
        <td>${p.position ? p.position.toFixed(1) : "—"}</td>
      </tr>`;
    })
    .join("");
}

async function loadPerformance() {
  const res = await fetch("/api/performance");
  renderPerformance(await res.json());
}

refreshPerfBtn.addEventListener("click", async () => {
  refreshPerfBtn.disabled = true;
  refreshPerfBtn.textContent = "⏳ Consultando o Google...";
  try {
    const res = await fetch("/api/performance/refresh", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error ?? "Falha ao atualizar métricas.");
    } else {
      renderPerformance(data);
    }
  } finally {
    refreshPerfBtn.disabled = false;
    refreshPerfBtn.textContent = "↻ Atualizar métricas";
  }
});

async function loadStatus() {
  const res = await fetch("/api/status");
  const data = await res.json();
  for (const event of data.lastEvents) updateDesk(event);
  setRunning(data.running);
}

function setRunning(running) {
  runBtn.disabled = running;
  runBtn.textContent = running ? "⏳ Rodando..." : "▶ Rodar pipeline agora";
}

runBtn.addEventListener("click", async () => {
  setRunning(true);
  const res = await fetch("/api/run", { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showToast(data.error ?? "Não foi possível iniciar o pipeline.");
    setRunning(false);
  }
});

function connectEvents() {
  const source = new EventSource("/api/events");
  source.onmessage = (msg) => {
    const event = JSON.parse(msg.data);
    updateDesk(event);

    if (event.agent === "publicador" && event.status === "done") {
      showToast("Post publicado! 🎉");
    }
    if (event.agent === "indexador" && event.status === "done") {
      loadHistory();
      setRunning(false);
    }
    if (event.status === "error") {
      showToast(`Erro no agente ${event.agent}: ${event.message ?? ""}`);
      setRunning(false);
    }
  };
  source.onerror = () => {
    // EventSource reconecta sozinho; nada a fazer aqui.
  };
}

buildDesks();
loadHistory();
loadStatus();
loadPerformance();
connectEvents();
