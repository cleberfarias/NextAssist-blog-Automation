import { NavLink } from "react-router-dom";

const ITEMS: { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: "/", label: "Dashboard", icon: "🏠", end: true },
  { to: "/agentes", label: "Agentes (IA)", icon: "🤖" },
  { to: "/conteudo", label: "Conteúdo", icon: "🗂️" },
  { to: "/reels", label: "Reels", icon: "📸" },
  { to: "/blog", label: "Blog", icon: "📝" },
  { to: "/leads", label: "Leads", icon: "🧲" },
  { to: "/clientes", label: "Clientes", icon: "👥" },
  { to: "/relatorios", label: "Relatórios", icon: "📊" },
  { to: "/configuracoes", label: "Configurações", icon: "⚙️" },
];

export function Sidebar() {
  return (
    <nav className="flex shrink-0 flex-col gap-1 overflow-x-auto bg-surface p-3 lg:w-56 lg:overflow-visible" aria-label="Menu principal">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            `flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${isActive ? "bg-accent text-white" : "text-secondary hover:bg-app hover:text-primary"}`
          }
        >
          <span aria-hidden="true">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
