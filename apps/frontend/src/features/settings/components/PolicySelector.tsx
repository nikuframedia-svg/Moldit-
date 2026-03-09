import type { PolicyId } from '../useConfigPreview';
import { POLICY_LABELS, useConfigPreview } from '../useConfigPreview';

const POLICY_ORDER: PolicyId[] = [
  'incompol_standard',
  'max_otd',
  'min_setups',
  'balanced',
  'urgent',
  'friday',
  'custom',
];

export function PolicySelector() {
  const policy = useConfigPreview((s) => s.policy);
  const setPolicy = useConfigPreview((s) => s.setPolicy);

  return (
    <div className="policy-selector" data-testid="policy-selector">
      <div className="policy-selector__grid">
        {POLICY_ORDER.map((id) => {
          const p = POLICY_LABELS[id];
          return (
            <button
              key={id}
              type="button"
              className={`policy-selector__btn${policy === id ? ' policy-selector__btn--active' : ''}`}
              onClick={() => setPolicy(id)}
              data-testid={`policy-${id}`}
            >
              <span className="policy-selector__btn-name">{p.name}</span>
              <span className="policy-selector__btn-desc">{p.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
