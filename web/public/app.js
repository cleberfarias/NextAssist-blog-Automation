// web/public/app.js — add near the top, before any fetch/EventSource call runs
const WORKSPACE_STORAGE_KEY = "office.workspaceId";

function currentWorkspaceId() {
  const url = new URL(window.location.href);
  return url.searchParams.get("workspace") || localStorage.getItem(WORKSPACE_STORAGE_KEY) || "";
}

function setWorkspaceId(id) {
  localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", id);
  window.history.replaceState({}, "", url);
}

function withWorkspace(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("workspace", currentWorkspaceId());
  return url.pathname + url.search;
}

async function initWorkspaceSelector() {
  const res = await fetch("/api/workspaces");
  const workspaces = await res.json();
  const select = document.getElementById("workspace-select");
  select.innerHTML = workspaces.map((w) => `<option value="${w.id}">${w.name}</option>`).join("");

  let selected = currentWorkspaceId();
  if (!workspaces.some((w) => w.id === selected)) selected = workspaces[0]?.id ?? "";
  select.value = selected;
  setWorkspaceId(selected);

  select.addEventListener("change", () => {
    setWorkspaceId(select.value);
    window.location.reload(); // simplest correct behavior: re-init everything (SSE, history, etc.) for the new workspace
  });
}

const AGENTS = [
  { id: "pesquisa-mercado", name: "Ana", role: "Pesquisa de mercado", emoji: "🔍" },
  { id: "pesquisa-pauta", name: "Bruno", role: "Pesquisa de pauta", emoji: "🗂️" },
  { id: "redator", name: "Carla", role: "Redação", emoji: "✍️" },
  { id: "editor-seo", name: "Diego", role: "Editor / SEO", emoji: "🧐" },
  { id: "publicador", name: "Elis", role: "Publicação", emoji: "🚀" },
  { id: "instagram", name: "Gabi", role: "Instagram", emoji: "📸" },
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
const perfKpis = document.getElementById("perf-kpis");
const perfChart = document.getElementById("perf-chart");
const usageKpis = document.getElementById("usage-kpis");
const usageUpdated = document.getElementById("usage-updated");
const conversionKpis = document.getElementById("conversion-kpis");
const conversionUpdated = document.getElementById("conversion-updated");
const conversionAttribution = document.getElementById("conversion-attribution");
const activeAgent = document.getElementById("active-agent");
const historyPagination = document.getElementById("history-pagination");
const runsPagination = document.getElementById("runs-pagination");
const perfPagination = document.getElementById("perf-pagination");

const PAGE_SIZE = 6;
const pageState = { history: 1, runs: 1, performance: 1 };
let historyEntries = [];
let runEntries = [];
let performancePosts = [];

const nf = new Intl.NumberFormat("pt-BR");
const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}

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
      <div class="desk-top"><span class="desk-index">0${AGENTS.indexOf(agent) + 1}</span><span class="status-dot"></span></div>
      <div class="avatar-wrap">${agent.emoji}</div>
      <div class="name">${agent.name}</div>
      <div class="role">${agent.role}</div>
      <div class="desk-status"><span class="status-badge">Ocioso</span><span class="status-time">aguardando</span></div>
      <div class="bubble"><span class="bubble-text"></span><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span></div>
      <div class="desk-progress"><span></span></div>
    `;
    floor.appendChild(desk);
  }
}

const STATUS_LABEL = { idle: "Ocioso", working: "Trabalhando", done: "Concluído", error: "Erro" };

function updateDesk(event) {
  const desk = document.getElementById(`desk-${event.agent}`);
  if (!desk) return;
  if (event.status === "working") {
    for (const other of document.querySelectorAll(".desk.status-working")) {
      if (other !== desk) other.className = "desk status-idle";
    }
    const agent = AGENTS.find((item) => item.id === event.agent);
    activeAgent.textContent = `Trabalhando agora: ${agent?.name ?? event.agent} · ${agent?.role ?? "Etapa atual"}`;
    activeAgent.classList.add("is-active");
  } else if (event.status === "done" || event.status === "error") {
    activeAgent.textContent = event.status === "error" ? "A etapa precisa de atenção" : "Equipe aguardando a próxima etapa";
    activeAgent.classList.toggle("is-active", event.status === "error");
  }
  desk.className = `desk status-${event.status}`;
  desk.querySelector(".status-badge").textContent = STATUS_LABEL[event.status] ?? event.status;
  desk.querySelector(".status-time").textContent = event.status === "working" ? "em andamento" : event.status === "done" ? "finalizado" : event.status === "error" ? "precisa de atenção" : "aguardando";
  desk.querySelector(".status-dot").setAttribute("aria-label", STATUS_LABEL[event.status] ?? event.status);
  desk.querySelector(".desk-progress span").style.width = event.status === "working" ? "62%" : event.status === "done" ? "100%" : event.status === "error" ? "100%" : "0%";
  if (event.message) {
    desk.querySelector(".bubble-text").textContent = event.message;
  }
  if (event.tema) {
    topicLine.textContent = `Tema de hoje: ${event.tema}`;
  }
}

function showToast(text, type = "info") {
  toast.textContent = text;
  toast.className = `toast ${type}`;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 4000);
}

function renderPagination(container, key, total, onChange) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  pageState[key] = Math.min(pageState[key], pages);
  if (pages <= 1) { container.innerHTML = ""; return; }
  container.innerHTML = `<button data-page="prev" ${pageState[key] === 1 ? "disabled" : ""}>Anterior</button><span class="page-label">Página ${pageState[key]} de ${pages}</span><button data-page="next" ${pageState[key] === pages ? "disabled" : ""}>Próxima</button>`;
  container.querySelector("[data-page=prev]").addEventListener("click", () => { pageState[key]--; onChange(); });
  container.querySelector("[data-page=next]").addEventListener("click", () => { pageState[key]++; onChange(); });
}

function renderHistory(entries) {
  historyEntries = entries ?? [];
  if (!historyEntries.length) {
    historyList.innerHTML = `<li class="empty">Nenhum post publicado ainda.</li>`;
    historyPagination.innerHTML = "";
    return;
  }
  const start = (pageState.history - 1) * PAGE_SIZE;
  historyList.innerHTML = historyEntries.slice(start, start + PAGE_SIZE)
    .map(
      (entry) => `
      <li>
        <span class="h-title">${entry.titulo}</span>
        <span class="h-date">${new Date(entry.publicadoEm).toLocaleString("pt-BR")}</span>
      </li>`,
    )
    .join("");
  renderPagination(historyPagination, "history", historyEntries.length, () => renderHistory(historyEntries));
}

async function loadHistory() {
  try {
    const res = await fetch(withWorkspace("/api/history"));
    if (!res.ok) throw new Error("Não foi possível carregar os posts publicados.");
    renderHistory(await res.json());
  } catch (error) { showToast(error.message, "error"); }
}

function kpiTile(label, value, sub) {
  return `
    <div class="kpi">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
    </div>`;
}

function renderKpis(posts) {
  const totalClicks = posts.reduce((s, p) => s + (p.clicks || 0), 0);
  const totalImpr = posts.reduce((s, p) => s + (p.impressions || 0), 0);
  const ctr = totalImpr > 0 ? (totalClicks / totalImpr) * 100 : 0;
  // Posição média ponderada por impressões (só posts que já apareceram na busca).
  const comPos = posts.filter((p) => p.position > 0 && p.impressions > 0);
  const somaImpr = comPos.reduce((s, p) => s + p.impressions, 0);
  const posMedia = somaImpr > 0
    ? comPos.reduce((s, p) => s + p.position * p.impressions, 0) / somaImpr
    : 0;
  const indexados = posts.filter((p) => p.indexado).length;

  perfKpis.innerHTML = [
    kpiTile("Cliques", nf.format(totalClicks)),
    kpiTile("Impressões", nf.format(totalImpr)),
    kpiTile("CTR médio", `${ctr.toFixed(1)}%`),
    kpiTile("Posição média", posMedia > 0 ? posMedia.toFixed(1) : "—"),
    kpiTile("Indexados", `${indexados}<span class="kpi-of">/${posts.length}</span>`),
  ].join("");
}

function renderChart(posts) {
  const top = posts
    .filter((p) => p.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 8);

  if (!top.length) {
    perfChart.innerHTML = `<div class="chart-empty">Nenhuma impressão registrada no período ainda — os dados aparecem alguns dias após a publicação.</div>`;
    return;
  }

  const max = top[0].impressions;
  perfChart.innerHTML = top
    .map((p) => {
      const pct = Math.max(2, (p.impressions / max) * 100);
      const titulo = p.titulo.replace(/"/g, "&quot;");
      return `
      <div class="bar-row" title="${titulo} — ${nf.format(p.impressions)} impressões · ${p.clicks} cliques">
        <div class="bar-label"><a href="${p.url}" target="_blank" rel="noopener">${p.titulo}</a></div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${pct}%"></div>
          <span class="bar-value">${nf.format(p.impressions)}</span>
        </div>
      </div>`;
    })
    .join("");
}

function renderPerformance(report) {
  performancePosts = report?.posts ?? [];
  if (!report || !performancePosts.length) {
    perfBody.innerHTML = `<tr class="empty"><td colspan="6">Sem dados ainda. Clique em "Atualizar métricas".</td></tr>`;
    perfUpdated.textContent = "Nunca atualizado";
    perfKpis.innerHTML = "";
    perfChart.innerHTML = `<div class="chart-empty">Sem dados ainda.</div>`;
    return;
  }
  renderKpis(report.posts);
  renderChart(report.posts);
  perfUpdated.textContent = `Atualizado ${new Date(report.atualizadoEm).toLocaleString("pt-BR")} · período ${report.periodo.inicio} a ${report.periodo.fim} · ${report.posts.length} posts`;
  perfStart.value = report.periodo.inicio;
  perfEnd.value = report.periodo.fim;
  const start = (pageState.performance - 1) * PAGE_SIZE;
  perfBody.innerHTML = performancePosts.slice(start, start + PAGE_SIZE)
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
  renderPagination(perfPagination, "performance", performancePosts.length, () => renderPerformance({ ...report, posts: performancePosts }));
}

async function loadPerformance() {
  try {
    const res = await fetch(withWorkspace("/api/performance"));
    if (!res.ok) throw new Error("Não foi possível carregar o desempenho.");
    renderPerformance(await res.json());
  } catch (error) { showToast(error.message, "error"); }
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
      body: JSON.stringify({ inicio: perfStart.value, fim: perfEnd.value, workspaceId: currentWorkspaceId() }),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error ?? "Falha ao atualizar métricas.", "error");
    } else {
      renderPerformance(data);
      showToast("Métricas atualizadas com sucesso.", "success");
    }
  } catch {
    showToast("Não foi possível consultar o Google. Tente novamente.", "error");
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
  runEntries = runs ?? [];
  if (!runEntries.length) {
    runsList.innerHTML = `<li class="empty">Nenhuma execução registrada ainda.</li>`;
    runsPagination.innerHTML = "";
    return;
  }
  runsUpdated.textContent = `${runEntries.length} execução(ões) registradas`;
  const start = (pageState.runs - 1) * PAGE_SIZE;
  runsList.innerHTML = runEntries
    .slice(start, start + PAGE_SIZE)
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
      const cost = run.usage
        ? `<span class="run-cost" title="${nf.format(run.usage.inputTokens)} tokens de entrada · ${nf.format(run.usage.outputTokens)} tokens de saída">${usd.format(run.usage.estimatedUsd)}</span>`
        : "";
      const erro = run.erro ? `<div class="run-error">⚠️ ${run.erro}</div>` : "";
      return `
      <li class="run-item">
        <div class="run-top">
          <span class="run-badge ${st.cls}">${st.label}</span>
          <span class="run-origin">${origem}</span>
          <span class="run-when">${quando}</span>
          ${cost}
          ${link}
        </div>
        <div class="run-topic">${run.tema ?? "—"}</div>
        <div class="run-chips">${chips}</div>
        ${erro}
      </li>`;
    })
    .join("");
  renderPagination(runsPagination, "runs", runEntries.length, () => renderRuns(runEntries));
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
  try {
    const res = await fetch(withWorkspace("/api/runs"));
    if (!res.ok) throw new Error("Não foi possível carregar as execuções.");
    const runs = await res.json();
    renderRuns(runs);
    hydrateFloorFromLatest(runs);
  } catch (error) { showToast(error.message, "error"); }
}

function renderUsage(report) {
  usageKpis.innerHTML = [
    kpiTile("Gasto neste mês", usd.format(report.month.estimatedUsd)),
    kpiTile("Custo médio / post", usd.format(report.averagePublishedUsd)),
    kpiTile("Tokens de entrada", nf.format(report.month.inputTokens)),
    kpiTile("Tokens de saída", nf.format(report.month.outputTokens)),
    kpiTile("Pesquisas web", nf.format(report.month.webSearchRequests)),
    kpiTile("Total registrado", usd.format(report.total.estimatedUsd)),
  ].join("");
  usageUpdated.textContent = report.trackedRuns
    ? `${report.trackedRuns} execução(ões) medidas · não representa o saldo restante`
    : "Aguardando a primeira execução com medição";
}

async function loadUsage() {
  const res = await fetch(withWorkspace("/api/usage"));
  renderUsage(await res.json());
}

async function loadConversions() {
  const res = await fetch(withWorkspace("/api/conversions"));
  if (!res.ok) return;
  const data = await res.json();
  conversionKpis.innerHTML = [
    kpiTile("Visitas à demo", nf.format(data.demoViews)),
    kpiTile("Testes iniciados", nf.format(data.demoSubmits)),
    kpiTile("Contatos enviados", nf.format(data.contactSubmits)),
    kpiTile("Cliques WhatsApp", nf.format(data.whatsappClicks)),
    kpiTile("Conversão", `${(data.demoRate * 100).toFixed(1)}%`),
  ].join("");
  const campaigns = (data.byCampaign ?? []).filter((row) => row.campaign !== "(não informado)").slice(0, 5);
  const positions = (data.byContent ?? []).filter((row) => row.content !== "(não informado)").slice(0, 5);
  const rows = [
    ...campaigns.map((row) => ({
      origem: `Artigo: ${row.campaign}`,
      views: row.demoViews,
      leads: row.leads,
      rate: row.demoRate,
    })),
    ...positions.map((row) => ({
      origem: `Posição: ${row.content}`,
      views: row.demoViews,
      leads: row.leads,
      rate: row.demoRate,
    })),
  ];
  conversionAttribution.innerHTML = rows.length
    ? `<div class="perf-table-wrap"><table><thead><tr><th>Origem</th><th>Visitas à demo</th><th>Leads</th><th>Conversão</th></tr></thead><tbody>${rows
        .map((row) => `<tr><td>${escapeHtml(row.origem)}</td><td>${nf.format(row.views)}</td><td>${nf.format(row.leads)}</td><td>${(row.rate * 100).toFixed(1)}%</td></tr>`)
        .join("")}</tbody></table></div>`
    : "";
  conversionUpdated.textContent = `Atualizado ${new Date(data.updatedAt).toLocaleString("pt-BR")}`;
}

let runMode = "local";

async function loadStatus() {
  const res = await fetch(withWorkspace("/api/status"));
  const data = await res.json();
  for (const event of data.lastEvents) updateDesk(event);
  runMode = data.runMode ?? (data.runEnabled === false ? "disabled" : "local");
  // Painel hospedado sem token de disparo: execução manual fica escondida.
  if (runMode === "disabled") {
    runBtn.hidden = true;
  } else {
    setRunning(data.running);
  }
}

function setRunning(running) {
  runBtn.disabled = running;
  runBtn.textContent = running ? "⏳ Rodando..." : "▶ Rodar pipeline agora";
}

runBtn.addEventListener("click", async () => {
  if (runMode === "dispatch") {
    runBtn.disabled = true;
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: currentWorkspaceId() }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast(
        "Execução disparada no GitHub Actions — acompanhe pela aba Actions do repositório; a lista de execuções deste painel atualiza sozinha quando terminar.",
        "success",
      );
    } else {
      showToast(data.error ?? "Não foi possível disparar a execução.", "error");
    }
    setTimeout(() => { runBtn.disabled = false; }, 60_000);
    return;
  }

  setRunning(true);
  liveRunActive = true;
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspaceId: currentWorkspaceId() }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    showToast(data.error ?? "Não foi possível iniciar o pipeline.", "error");
    setRunning(false);
  }
});

function connectEvents() {
  const source = new EventSource(withWorkspace("/api/events"));
  source.onmessage = (msg) => {
    const event = JSON.parse(msg.data);
    updateDesk(event);

    if (event.agent === "publicador" && event.status === "done") {
      showToast("Post publicado com sucesso! 🎉", "success");
    }
    if (event.agent === "instagram" && event.status === "done" && !/ignorado/.test(event.message ?? "")) {
      showToast("Publicado no Instagram com sucesso! 📸", "success");
    }
    if (event.agent === "indexador" && event.status === "done") {
      liveRunActive = false;
      loadHistory();
      loadRuns();
      loadUsage();
      setRunning(false);
    }
    if (event.status === "error") {
      showToast(`Não foi possível concluir ${event.agent}: ${event.message ?? "Tente novamente."}`, "error");
      liveRunActive = false;
      loadRuns();
      loadUsage();
      setRunning(false);
    }
  };
  source.onerror = () => {
    // EventSource reconecta sozinho; nada a fazer aqui.
  };
}

async function init() {
  await initWorkspaceSelector();
  buildDesks();
  loadHistory();
  loadRuns();
  loadUsage();
  loadConversions();
  loadStatus();
  loadPerformance();
  connectEvents();

  // Painel hospedado: recarrega as execuções periodicamente para pegar novas
  // publicações da Action sem precisar dar refresh na página.
  setInterval(loadRuns, 60000);
  setInterval(loadUsage, 60000);
}

init();
