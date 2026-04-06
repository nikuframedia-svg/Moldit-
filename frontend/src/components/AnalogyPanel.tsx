/** AnalogyPanel — "Moldes semelhantes" lateral panel.
 *
 * Shows top 5 analogous past projects as stories, not numbers.
 * Never says "similarity score" or "cosine".
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { getAnalogues, feedbackAnalogy } from "../api/endpoints";
import { ExplainBox } from "./ExplainBox";
import { Card } from "./ui/Card";
import type { AnalogoResult } from "../api/types";

interface Props {
  moldeId: string;
  onClose: () => void;
}

export function AnalogyPanel({ moldeId, onClose }: Props) {
  const [analogues, setAnalogues] = useState<AnalogoResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [feedbackGiven, setFeedbackGiven] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLoading(true);
    getAnalogues(moldeId)
      .then(setAnalogues)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [moldeId]);

  const handleFeedback = async (analogoId: string, util: boolean) => {
    await feedbackAnalogy({ molde_id: moldeId, analogo_id: analogoId, util });
    setFeedbackGiven((prev) => new Set(prev).add(analogoId));
  };

  return (
    <div
      style={{
        width: 360, height: "100%", background: T.elevated,
        borderLeft: `1px solid ${T.border}`, padding: 20,
        display: "flex", flexDirection: "column", gap: 16, overflow: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: T.primary }}>Moldes semelhantes</span>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: T.secondary, cursor: "pointer", fontSize: 18 }}
        >
          x
        </button>
      </div>

      <div style={{ fontSize: 13, color: T.secondary, lineHeight: 1.5 }}>
        Moldes passados parecidos com este. O que aconteceu e o que pode aprender.
      </div>

      {loading && <div style={{ color: T.tertiary }}>A procurar...</div>}

      {!loading && analogues.length === 0 && (
        <ExplainBox
          headline="Ainda nao temos moldes semelhantes no historico."
          detail="A medida que mais moldes forem concluidos, o sistema vai encontrar padroes."
          color="orange"
        />
      )}

      {analogues.map((a) => (
        <Card key={a.projeto_id}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.primary, marginBottom: 4 }}>
            {a.molde_id}
            <span style={{
              marginLeft: 8, fontSize: 11, fontWeight: 400,
              color: a.compliance ? T.green : T.red,
            }}>
              {a.compliance ? "Dentro do prazo" : "Atrasou"}
            </span>
          </div>

          <div style={{ fontSize: 13, color: T.secondary, lineHeight: 1.5, marginBottom: 6 }}>
            <div>{a.n_ops} operacoes. Demorou {a.makespan_real_dias} dias.</div>
            <div style={{ marginTop: 4 }}>{a.nota}</div>
          </div>

          <div style={{ fontSize: 11, color: T.tertiary, marginBottom: 8 }}>
            {(a.similaridade * 100).toFixed(0)}% de semelhanca com o molde actual
          </div>

          {!feedbackGiven.has(a.projeto_id) ? (
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => handleFeedback(a.projeto_id, true)}
                style={{
                  flex: 1, padding: "4px 8px", borderRadius: 6,
                  border: `1px solid ${T.green}40`, background: "transparent",
                  color: T.green, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Util
              </button>
              <button
                onClick={() => handleFeedback(a.projeto_id, false)}
                style={{
                  flex: 1, padding: "4px 8px", borderRadius: 6,
                  border: `1px solid ${T.red}40`, background: "transparent",
                  color: T.red, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Nao util
              </button>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: T.green, textAlign: "center" }}>
              Feedback registado
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
