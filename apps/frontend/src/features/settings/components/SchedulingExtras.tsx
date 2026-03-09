/**
 * SchedulingExtras — Dispatch rule + direction dropdowns for SchedulingConfigPage.
 */

import type { DispatchRule } from '@/stores/useSettingsStore';
import { useSettingsStore } from '@/stores/useSettingsStore';

const DISPATCH_RULES: { value: DispatchRule; label: string }[] = [
  { value: 'ATCS', label: 'ATCS — Apparent Tardiness Cost with Setups' },
  { value: 'EDD', label: 'EDD — Earliest Due Date' },
  { value: 'CR', label: 'CR — Critical Ratio' },
  { value: 'SPT', label: 'SPT — Shortest Processing Time' },
  { value: 'WSPT', label: 'WSPT — Weighted Shortest Processing Time' },
];

export function SchedulingExtras() {
  const dispatchRule = useSettingsStore((s) => s.dispatchRule);
  const setDispatchRule = useSettingsStore((s) => s.actions.setDispatchRule);

  return (
    <div className="constraint-toggles" data-testid="scheduling-extras">
      <div className="constraint-toggles__param">
        <span className="constraint-toggles__param-label">Regra de despacho</span>
        <select
          className="constraint-toggles__param-select"
          value={dispatchRule}
          onChange={(e) => setDispatchRule(e.target.value as DispatchRule)}
          data-testid="dispatch-rule"
        >
          {DISPATCH_RULES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="constraint-toggles__param">
        <span className="constraint-toggles__param-label">Direcção de scheduling</span>
        <select
          className="constraint-toggles__param-select"
          defaultValue="forward"
          data-testid="scheduling-direction"
        >
          <option value="forward">Forward (do presente para o futuro)</option>
          <option value="backward">Backward (da deadline para trás)</option>
        </select>
      </div>
    </div>
  );
}
