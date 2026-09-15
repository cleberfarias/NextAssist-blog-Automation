import { PerformancePanel } from "../dashboard/PerformancePanel";
import { UsagePanel } from "../dashboard/UsagePanel";
import { AttributionPanel } from "../dashboard/AttributionPanel";

export function RelatoriosPage() {
  return (
    <div className="p-6 text-primary">
      <h1 className="mb-4 text-xl font-semibold">Relatórios</h1>
      <div className="space-y-6">
        <PerformancePanel />
        <UsagePanel />
        <AttributionPanel />
      </div>
    </div>
  );
}
