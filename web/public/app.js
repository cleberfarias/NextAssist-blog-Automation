const AGENTS = [
  { id: "pesquisa-mercado", name: "Ana", role: "Pesquisa de mercado", emoji: "🔍" },
  { id: "pesquisa-pauta", name: "Bruno", role: "Pesquisa de pauta", emoji: "🗂️" },
  { id: "redator", name: "Carla", role: "Redação", emoji: "✍️" },
  { id: "editor-seo", name: "Diego", role: "Editor / SEO", emoji: "🧐" },
  { id: "publicador", name: "Elis", role: "Publicação", emoji: "🚀" },
];

const floor = document.getElementById("floor");
const runBtn = document.getElementById("run-btn");
const topicLine = document.getElementById("topic-line");
const historyList = document.getElementById("history-list");
const toast = document.getElementById("toast");

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
connectEvents();
