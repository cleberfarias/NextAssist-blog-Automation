type View = "painel" | "config";

const ITEMS: { id: View; label: string }[] = [
  { id: "painel", label: "Painel" },
  { id: "config", label: "Configurações" },
];

export function Sidebar({ active, onSelect }: { active: View; onSelect: (view: View) => void }) {
  return (
    <nav className="sidebar" aria-label="Menu principal">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={item.id === active ? "sidebar-item active" : "sidebar-item"}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
