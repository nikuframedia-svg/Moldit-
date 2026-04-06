import { useState, useEffect, type CSSProperties } from "react";
import { T } from "../theme/tokens";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { Num } from "../components/ui/Num";
import { Pill } from "../components/ui/Pill";
import { getOperadores, getWorkforceConflicts, getWorkforceForecast, addOperador, deleteOperador, autoAllocate } from "../api/endpoints";
import type { Operador, WorkforceConflict, ForecastEntry } from "../api/types";

type Tab = "visao" | "alocacao" | "competencias" | "previsao";

const TABS: { id: Tab; label: string }[] = [
  { id: "visao", label: "Visao Geral" },
  { id: "alocacao", label: "Alocacao" },
  { id: "competencias", label: "Competencias" },
  { id: "previsao", label: "Previsao" },
];

const thStyle: CSSProperties = {
  fontSize: 11, color: T.tertiary, fontWeight: 500, textAlign: "left" as const,
  padding: "8px 12px", borderBottom: `1px solid ${T.border}`,
  position: "sticky" as const, top: 0, background: T.card,
  textTransform: "uppercase" as const, letterSpacing: "0.04em",
};

const tdStyle: CSSProperties = {
  fontSize: 12, color: T.primary, padding: "6px 12px",
  borderBottom: `1px solid ${T.border}`, fontFamily: T.mono,
};

const inputStyle: CSSProperties = {
  background: T.elevated, border: `0.5px solid ${T.border}`,
  borderRadius: 6, padding: "4px 8px", fontSize: 12,
  color: T.primary, fontFamily: T.mono, outline: "none",
  width: 140,
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  width: 100,
  cursor: "pointer",
};

const btnStyle: CSSProperties = {
  background: T.blue, border: "none",
  borderRadius: 8, padding: "6px 16px",
  color: "#fff", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
};

function severidadeColor(sev: string): string {
  if (sev === "critico") return T.red;
  if (sev === "aviso" || sev === "alto") return T.orange;
  if (sev === "info" || sev === "baixo") return T.blue;
  return T.secondary;
}

export function OperadoresPage() {
  const [tab, setTab] = useState<Tab>("visao");
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [conflicts, setConflicts] = useState<WorkforceConflict[]>([]);
  const [forecast, setForecast] = useState<ForecastEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Alocacao state
  const [alocDia, setAlocDia] = useState(1);
  const [alocTurno, setAlocTurno] = useState("A");
  const [alocConflicts, setAlocConflicts] = useState<WorkforceConflict[]>([]);
  const [alocMsg, setAlocMsg] = useState<string | null>(null);

  // New operator form
  const [showForm, setShowForm] = useState(false);
  const [formNome, setFormNome] = useState("");
  const [formTurno, setFormTurno] = useState("A");
  const [formZona, setFormZona] = useState("");
  const [formCompetencias, setFormCompetencias] = useState("");
  const [formDisponivel, setFormDisponivel] = useState(true);
  const [formSaving, setFormSaving] = useState(false);

  const loadOperadores = () => {
    getOperadores()
      .then(setOperadores)
      .catch((e) => { console.error(e); setError(String(e)); });
  };

  const loadConflicts = () => {
    getWorkforceConflicts()
      .then(setConflicts)
      .catch((e) => console.error(e));
  };

  useEffect(() => {
    loadOperadores();
    loadConflicts();
  }, []);

  useEffect(() => {
    if (tab === "previsao") {
      getWorkforceForecast(4)
        .then(setForecast)
        .catch((e) => console.error(e));
    }
  }, [tab]);

  useEffect(() => {
    if (tab === "alocacao") {
      getWorkforceConflicts(alocDia)
        .then((c) => setAlocConflicts(c.filter((x) => x.turno === alocTurno || x.turno === "todos")))
        .catch((e) => console.error(e));
    }
  }, [tab, alocDia, alocTurno]);

  const handleAutoAllocate = async () => {
    setLoading(true);
    setAlocMsg(null);
    try {
      const res = await autoAllocate(alocDia, alocTurno);
      setAlocMsg(`Auto-alocacao concluida: ${res.length} alocacoes.`);
      loadConflicts();
    } catch (e) {
      console.error(e);
      setAlocMsg(`Erro: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAddOperador = async () => {
    if (!formNome.trim()) return;
    setFormSaving(true);
    try {
      const comps = formCompetencias.split(",").map((s) => s.trim()).filter(Boolean);
      const nivel: Record<string, number> = {};
      for (const c of comps) {
        const match = c.match(/^(.+?)\s*\((\d+)\)$/);
        if (match) {
          nivel[match[1]] = parseInt(match[2], 10);
        } else {
          nivel[c] = 1;
        }
      }
      const competenciaNames = comps.map((c) => {
        const match = c.match(/^(.+?)\s*\(\d+\)$/);
        return match ? match[1] : c;
      });
      await addOperador({
        nome: formNome.trim(),
        turno: formTurno,
        zona: formZona.trim(),
        competencias: competenciaNames,
        nivel,
        disponivel: formDisponivel,
      });
      setFormNome("");
      setFormTurno("A");
      setFormZona("");
      setFormCompetencias("");
      setFormDisponivel(true);
      setShowForm(false);
      loadOperadores();
    } catch (e) {
      console.error(e);
      alert(`Erro ao adicionar operador: ${e}`);
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remover este operador?")) return;
    try {
      await deleteOperador(id);
      loadOperadores();
    } catch (e) {
      console.error(e);
      alert(`Erro: ${e}`);
    }
  };

  const activeCount = operadores.filter((o) => o.disponivel).length;
  const cobertura = operadores.length > 0
    ? ((activeCount / operadores.length) * 100).toFixed(0)
    : "0";

  if (error && operadores.length === 0) {
    return <div style={{ color: T.red, padding: 24 }}>{error}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? T.elevated : "transparent",
              border: `0.5px solid ${tab === t.id ? T.borderHover : T.border}`,
              color: tab === t.id ? T.primary : T.secondary,
              borderRadius: 8, padding: "5px 12px", cursor: "pointer",
              fontSize: 12, fontWeight: tab === t.id ? 600 : 400, fontFamily: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Visao Geral ── */}
      {tab === "visao" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <Card style={{ textAlign: "center" as const }}>
              <Label>Operadores Activos</Label>
              <div style={{ marginTop: 8 }}>
                <Num size={36} color={T.primary}>{activeCount}</Num>
              </div>
            </Card>
            <Card style={{ textAlign: "center" as const }}>
              <Label>Conflitos Abertos</Label>
              <div style={{ marginTop: 8 }}>
                <Num size={36} color={conflicts.length > 0 ? T.red : T.green}>
                  {conflicts.length}
                </Num>
              </div>
            </Card>
            <Card style={{ textAlign: "center" as const }}>
              <Label>Cobertura</Label>
              <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", justifyContent: "center", gap: 3 }}>
                <Num size={36} color={T.primary}>{cobertura}</Num>
                <span style={{ fontSize: 13, color: T.tertiary, fontWeight: 500 }}>%</span>
              </div>
            </Card>
          </div>

          {operadores.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center" as const, padding: 24, color: T.secondary, fontSize: 13 }}>
                Adicione operadores no tab Competencias.
              </div>
            </Card>
          ) : conflicts.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center" as const, padding: 24, color: T.green, fontSize: 14 }}>
                Sem conflitos de workforce.
              </div>
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {conflicts.map((c, i) => (
                <Card key={i} style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <Pill color={severidadeColor(c.severidade)}>{c.severidade}</Pill>
                    <Pill color={T.secondary}>{c.tipo}</Pill>
                    <span style={{ fontSize: 11, color: T.tertiary, fontFamily: T.mono, marginLeft: "auto" }}>
                      Dia {c.dia} | Turno {c.turno}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: T.secondary, lineHeight: 1.5 }}>{c.descricao}</div>
                  {c.maquinas.length > 0 && (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const, marginTop: 6 }}>
                      {c.maquinas.map((m) => (
                        <span key={m} style={{
                          fontSize: 10, fontFamily: T.mono, color: T.primary,
                          background: T.elevated, padding: "2px 6px", borderRadius: 4,
                        }}>
                          {m}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Alocacao ── */}
      {tab === "alocacao" && (
        <>
          {operadores.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center" as const, padding: 24, color: T.secondary, fontSize: 13 }}>
                Carregue dados e adicione operadores para ver alocacoes.
              </div>
            </Card>
          ) : (
            <>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Label>Dia</Label>
                <input
                  type="number" min={1}
                  value={alocDia}
                  onChange={(e) => setAlocDia(parseInt(e.target.value, 10) || 1)}
                  style={{ ...inputStyle, width: 70 }}
                />
                <Label>Turno</Label>
                <select
                  value={alocTurno}
                  onChange={(e) => setAlocTurno(e.target.value)}
                  style={selectStyle}
                >
                  <option value="A">A</option>
                  <option value="B">B</option>
                </select>
                <button
                  onClick={handleAutoAllocate}
                  disabled={loading}
                  style={{ ...btnStyle, opacity: loading ? 0.5 : 1 }}
                >
                  {loading ? "A alocar..." : "Auto-Alocar"}
                </button>
              </div>

              {alocMsg && (
                <div style={{
                  fontSize: 12,
                  color: alocMsg.startsWith("Erro") ? T.red : T.green,
                  padding: "8px 0",
                }}>
                  {alocMsg}
                </div>
              )}

              {alocConflicts.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>
                    Conflitos Dia {alocDia} / Turno {alocTurno}
                  </span>
                  {alocConflicts.map((c, i) => (
                    <Card key={i} style={{ padding: "10px 16px" }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                        <Pill color={severidadeColor(c.severidade)}>{c.severidade}</Pill>
                        <span style={{ fontSize: 12, color: T.secondary }}>{c.descricao}</span>
                      </div>
                      <div style={{ fontSize: 11, color: T.tertiary, fontFamily: T.mono }}>
                        Necessarios: {c.operadores_necessarios} | Disponiveis: {c.operadores_disponiveis} | Deficit: {c.deficit}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card>
                  <div style={{ textAlign: "center" as const, padding: 24, color: T.green, fontSize: 13 }}>
                    Sem conflitos para Dia {alocDia} / Turno {alocTurno}.
                  </div>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* ── Competencias ── */}
      {tab === "competencias" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: T.primary }}>Operadores</span>
            <button
              onClick={() => setShowForm(!showForm)}
              style={{
                ...btnStyle,
                background: showForm ? T.elevated : T.blue,
                color: showForm ? T.secondary : "#fff",
                border: showForm ? `0.5px solid ${T.border}` : "none",
              }}
            >
              {showForm ? "Cancelar" : "Adicionar Operador"}
            </button>
          </div>

          {showForm && (
            <Card style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const }}>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
                  <Label>Nome</Label>
                  <input
                    type="text" placeholder="Nome"
                    value={formNome}
                    onChange={(e) => setFormNome(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
                  <Label>Turno</Label>
                  <select
                    value={formTurno}
                    onChange={(e) => setFormTurno(e.target.value)}
                    style={selectStyle}
                  >
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="todos">Todos</option>
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
                  <Label>Zona</Label>
                  <input
                    type="text" placeholder="Zona"
                    value={formZona}
                    onChange={(e) => setFormZona(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
                  <Label>Competencias (virgula)</Label>
                  <input
                    type="text" placeholder="CNC(3),EDM(2),Bancada"
                    value={formCompetencias}
                    onChange={(e) => setFormCompetencias(e.target.value)}
                    style={{ ...inputStyle, width: 220 }}
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
                  <Label>Disponivel</Label>
                  <input
                    type="checkbox"
                    checked={formDisponivel}
                    onChange={(e) => setFormDisponivel(e.target.checked)}
                    style={{ width: 16, height: 16, cursor: "pointer" }}
                  />
                </div>
                <button
                  onClick={handleAddOperador}
                  disabled={formSaving || !formNome.trim()}
                  style={{ ...btnStyle, alignSelf: "flex-end", opacity: formSaving || !formNome.trim() ? 0.5 : 1 }}
                >
                  {formSaving ? "..." : "Guardar"}
                </button>
              </div>
            </Card>
          )}

          {operadores.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center" as const, padding: 24, color: T.secondary, fontSize: 13 }}>
                Sem operadores registados.
              </div>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: "auto", maxHeight: 500 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Nome</th>
                    <th style={thStyle}>Turno</th>
                    <th style={thStyle}>Zona</th>
                    <th style={thStyle}>Competencias</th>
                    <th style={thStyle}>Disponivel</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {operadores.map((op) => (
                    <tr key={op.id}>
                      <td style={{ ...tdStyle, fontFamily: T.sans }}>{op.nome}</td>
                      <td style={tdStyle}>{op.turno}</td>
                      <td style={{ ...tdStyle, fontFamily: T.sans }}>{op.zona}</td>
                      <td style={{ ...tdStyle, fontFamily: T.sans }}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
                          {op.competencias.map((c) => (
                            <Pill key={c} color={T.blue}>
                              {c}{op.nivel[c] !== undefined ? ` (${op.nivel[c]})` : ""}
                            </Pill>
                          ))}
                        </div>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: op.disponivel ? T.green : T.red, fontWeight: 600 }}>
                          {op.disponivel ? "Sim" : "Nao"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <button
                          onClick={() => handleDelete(op.id)}
                          style={{
                            background: "transparent", border: "none",
                            color: T.red, cursor: "pointer", fontSize: 12,
                            fontFamily: "inherit", padding: "2px 6px",
                          }}
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {/* ── Previsao ── */}
      {tab === "previsao" && (
        <>
          {operadores.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center" as const, padding: 24, color: T.secondary, fontSize: 13 }}>
                Configure operadores para ver previsao.
              </div>
            </Card>
          ) : forecast.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center" as const, padding: 24, color: T.secondary, fontSize: 13 }}>
                A carregar...
              </div>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: "auto", maxHeight: 500 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Semana</th>
                    <th style={thStyle}>Zona</th>
                    <th style={thStyle}>Turno</th>
                    <th style={thStyle}>Necessarios</th>
                    <th style={thStyle}>Disponiveis</th>
                    <th style={thStyle}>Deficit</th>
                    <th style={thStyle}>Horas Extra</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((f, i) => (
                    <tr key={i}>
                      <td style={tdStyle}>{f.semana}</td>
                      <td style={{ ...tdStyle, fontFamily: T.sans }}>{f.zona}</td>
                      <td style={tdStyle}>{f.turno}</td>
                      <td style={tdStyle}>{f.necessarios}</td>
                      <td style={tdStyle}>{f.disponiveis}</td>
                      <td style={{ ...tdStyle, color: f.deficit > 0 ? T.red : T.green, fontWeight: 600 }}>
                        {f.deficit > 0 ? `+${f.deficit}` : f.deficit}
                      </td>
                      <td style={tdStyle}>{f.horas_extra_h.toFixed(1)}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
