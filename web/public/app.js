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
const perfStart = document.getElementById("perf-start");
const perfEnd = document.getElementById("perf-end");
const runsList = document.getElementById("runs-list");
const runsUpdated = document.getElementById("runs-updated");

let liveRunActive = false; // durante uma execução manual, não sobrescreve as mesas

function isoDateWithOffset(offsetDays) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const today = isoDateWithOffset(0);
perfStart.value = isoDateWithOffset(-28);
perfEnd.value = today;
perfStart.max = today;
perfEnd.max = today;

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
  perfStart.value = report.periodo.inicio;
  perfEnd.value = report.periodo.fim;
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
  if (!perfStart.value || !perfEnd.value) {
    showToast("Informe as datas de início e fim.");
    return;
  }
  if (perfStart.value > perfEnd.value) {
    showToast("A data inicial não pode ser posterior à data final.");
    return;
  }

  refreshPerfBtn.disabled = true;
  refreshPerfBtn.textContent = "⏳ Consultando o Google...";
  try {
    const res = await fetch("/api/performance/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inicio: perfStart.value, fim: perfEnd.value }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error ?? "Falha ao atualizar métricas.");
    } else {
      renderPerformance(data);
    }
  } catch {
    showToast("Não foi possível consultar o Google.");
  } finally {
    refreshPerfBtn.disabled = false;
    refreshPerfBtn.textContent = "↻ Atualizar métricas";
  }
});

const RUN_STATUS = {
  publicado: { label: "Publicado", cls: "run-ok" },
  falhou: { label: "Falhou", cls: "run-err" },
  "sem-tema": { label: "Sem tema", cls: "run-neutral" },
};

/** Último status de cada agente dentro de uma execução. */
function agentFinalStatus(run, agentId) {
  let last = null;
  for (const ev of run.eventos ?? []) if (ev.agent === agentId) last = ev;
  return last;
}

function renderRuns(runs) {
  if (!runs || !runs.length) {
    runsList.innerHTML = `<li class="empty">Nenhuma execução registrada ainda.</li>`;
    return;
  }
  runsUpdated.textContent = `${runs.length} execução(ões) registradas`;
  runsList.innerHTML = runs
    .slice(0, 20)
    .map((run) => {
      const st = RUN_STATUS[run.status] ?? { label: run.status, cls: "run-neutral" };
      const quando = new Date(run.finalizadoEm || run.iniciadoEm).toLocaleString("pt-BR");
      const origem = run.origem === "action" ? "🤖 Action" : "🖐️ Manual";
      const chips = AGENTS.map((a) => {
        const ev = agentFinalStatus(run, a.id);
        const status = ev?.status ?? "idle";
        return `<span class="chip chip-${status}" title="${(ev?.message ?? "").replace(/"/g, "&quot;")}">${a.emoji} ${a.role}</span>`;
      }).join("");
      const link = run.slug
        ? `<a href="https://www.nextassist-app.com.br/blog/${run.slug}" target="_blank" rel="noopener">ver post ↗</a>`
        : "";
      const erro = run.erro ? `<div class="run-error">⚠️ ${run.erro}</div>` : "";
      return `
      <li class="run-item">
        <div class="run-top">
          <span class="run-badge ${st.cls}">${st.label}</span>
          <span class="run-origin">${origem}</span>
          <span class="run-when">${quando}</span>
          ${link}
        </div>
        <div class="run-topic">${run.tema ?? "—"}</div>
        <div class="run-chips">${chips}</div>
        ${erro}
      </li>`;
    })
    .join("");
}

function hydrateFloorFromLatest(runs) {
  if (liveRunActive || !runs || !runs.length) return;
  const latest = runs[0];
  if (latest.tema) topicLine.textContent = `Último tema: ${latest.tema}`;
  for (const agent of AGENTS) {
    const ev = agentFinalStatus(latest, agent.id);
    if (ev) updateDesk(ev);
  }
}

async function loadRuns() {
  const res = await fetch("/api/runs");
  const runs = await res.json();
  renderRuns(runs);
  hydrateFloorFromLatest(runs);
}

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
  liveRunActive = true;
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
      liveRunActive = false;
      loadHistory();
      loadRuns();
      setRunning(false);
    }
    if (event.status === "error") {
      showToast(`Erro no agente ${event.agent}: ${event.message ?? ""}`);
      liveRunActive = false;
      loadRuns();
      setRunning(false);
    }
  };
  source.onerror = () => {
    // EventSource reconecta sozinho; nada a fazer aqui.
  };
}

buildDesks();
loadHistory();
loadRuns();
loadStatus();
loadPerformance();
connectEvents();

// Painel hospedado: recarrega as execuções periodicamente para pegar novas
// publicações da Action sem precisar dar refresh na página.
setInterval(loadRuns, 60000);
