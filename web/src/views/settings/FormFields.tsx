export function TextField({ label, value, onChange, placeholder, type = "text" }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "url";
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-app px-3 py-2 text-sm text-primary"
      />
    </label>
  );
}

export function TextAreaField({ label, value, onChange, rows = 3 }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-app px-3 py-2 text-sm text-primary"
      />
    </label>
  );
}

export function NumberField({ label, value, onChange, min }: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
      <input
        type="number"
        min={min}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        className="w-full rounded-md border border-border bg-app px-3 py-2 text-sm text-primary"
      />
    </label>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-md border border-border bg-app px-3 py-2 text-sm text-primary"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function CheckboxGroup({ label, options, selected, onChange }: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }
  return (
    <div>
      <span className="mb-2 block text-xs font-medium text-secondary">{label}</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm text-primary">
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="h-4 w-4 rounded border-border accent-accent" />
            {o.label}
          </label>
        ))}
      </div>
    </div>
  );
}

export function ToggleField({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-primary">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-border accent-accent" />
      {label}
    </label>
  );
}

export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-secondary">{label}</span>
      <p className="rounded-md border border-border bg-app px-3 py-2 text-sm text-secondary">{value}</p>
    </div>
  );
}
