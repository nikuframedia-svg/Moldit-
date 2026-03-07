/**
 * isopClientParser — Client-side ISOP XLSX parser using SheetJS.
 *
 * Mirrors backend logic at backend/src/domain/ingest/isop_parser.py.
 * Auto-detects header row and column positions for flexibility across ISOP formats.
 * Outputs NikufraData format for the planning engine.
 *
 * MANDATO §22: Dados 100% reais — parser extracts exactly what the ISOP contains.
 */

import * as XLSX from 'xlsx';
import type { LoadMeta } from '../stores/useDataStore';
import type {
  NikufraCustomer,
  NikufraData,
  NikufraMachine,
  NikufraMOLoad,
  NikufraOperation,
  NikufraTool,
} from './nikufra-types';

// ── Machine → Area mapping (claude-bdmestre.md §2) ──

const MACHINE_AREA: Record<string, 'PG1' | 'PG2'> = {
  PRM019: 'PG1',
  PRM020: 'PG1',
  PRM043: 'PG1',
  PRM031: 'PG2',
  PRM039: 'PG2',
  PRM042: 'PG2',
};

// ── Day name helper ──

const DAY_NAMES_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function dayLabel(d: Date): string {
  return DAY_NAMES_PT[d.getDay()];
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

// ── Parse helpers (mirror backend parse_numeric, normalize_code) ──

function parseNumeric(value: unknown, fallback: number = 0): number {
  if (value == null) return fallback;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(',', '.').trim();
    const n = Number(cleaned);
    return isNaN(n) ? fallback : n;
  }
  return fallback;
}

function parseInteger(value: unknown, fallback: number = 1): number {
  return Math.round(parseNumeric(value, fallback));
}

function normalizeCode(value: unknown): string {
  if (value == null) return '';
  return String(value).trim().toUpperCase();
}

function normalizeString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

// ── Date parsing from Excel ──

function parseDateCell(value: unknown): Date | null {
  if (value == null) return null;
  // SheetJS may return a Date object or a serial number
  if (value instanceof Date) {
    // Check if valid
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    // Excel serial date → JS Date
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return new Date(d.y, d.m - 1, d.d);
    return null;
  }
  if (typeof value === 'string') {
    // Try common formats: DD/MM/YYYY, DD/MM, YYYY-MM-DD
    const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));

    const dmyFull = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmyFull) return new Date(Number(dmyFull[3]), Number(dmyFull[2]) - 1, Number(dmyFull[1]));

    const dm = value.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (dm) {
      // Assume current year
      const year = new Date().getFullYear();
      return new Date(year, Number(dm[2]) - 1, Number(dm[1]));
    }
    return null;
  }
  return null;
}

// ── Types ──

interface ParsedRow {
  customer_code: string;
  customer_name: string;
  parent_sku: string;
  item_sku: string;
  item_name: string;
  lot_economic_qty: number;
  lead_time_days: number;
  resource_code: string;
  alt_resource: string;
  tool_code: string;
  setup_time: number;
  rate: number;
  operators_required: number;
  qtd_exp: number;
  stock: number;
  wip: number;
  atraso: number;
  daily_quantities: (number | null)[];
  machine_down: boolean;
  tool_down: boolean;
  twin: string;
}

export interface ParseResult {
  success: true;
  data: NikufraData;
  meta: LoadMeta;
  /** Which optional columns were detected in the source file */
  sourceColumns: {
    hasSetup: boolean;
    hasAltMachine: boolean;
    hasRate: boolean;
    hasParentSku: boolean;
    hasLeadTime: boolean;
    hasQtdExp: boolean;
    hasTwin: boolean;
  };
}

export interface ParseError {
  success: false;
  errors: string[];
}

// ── Column mapping by header name ──

interface ColumnMap {
  cliente: number;
  nome: number;
  refArtigo: number;
  designacao: number;
  loteEcon: number;
  przFabrico: number; // -1 if not found ("Prz.Fabrico" = manufacturing lead time days)
  maquina: number;
  maqAlt: number; // -1 if not found
  ferramenta: number;
  tpSetup: number; // -1 if not found
  pecasH: number;
  nPessoas: number;
  qtdExp: number; // -1 if not found
  produtoAcabado: number; // -1 if not found ("Produto Acabado" = parent SKU)
  stockA: number;
  wip: number;
  atraso: number;
  estadoMaq: number; // -1 if not found ("Estado Máq." / "Status Máquina")
  estadoFerr: number; // -1 if not found ("Estado Ferr." / "Status Ferramenta")
  pecaGemea: number; // -1 if not found ("Peca Gemea" / "Peça Gémea" = twin part SKU)
}

/** Scan rows 0-15 for the header row (must contain "Referência Artigo" + "Máquina") */
function findHeaderRow(allRows: unknown[][]): { rowIndex: number; headers: string[] } | null {
  const maxScan = Math.min(allRows.length, 16);
  for (let ri = 0; ri < maxScan; ri++) {
    const row = allRows[ri];
    if (!row || row.length < 5) continue;
    const strs = row.map((h) => normalizeString(h));
    const hasRef = strs.some(
      (h) =>
        h.includes('Referência Artigo') ||
        h.includes('Referencia Artigo') ||
        h.includes('REFERÊNCIA ARTIGO') ||
        h.includes('Ref. Artigo') ||
        h.includes('REF. ARTIGO'),
    );
    const hasMaq = strs.some(
      (h) =>
        h.includes('Máquina') ||
        h.includes('Maquina') ||
        h.includes('MÁQUINA') ||
        h.includes('MAQUINA'),
    );
    if (hasRef && hasMaq) {
      return { rowIndex: ri, headers: strs };
    }
  }
  return null;
}

/** Map column names to indices based on header row content */
function buildColumnMap(headers: string[]): ColumnMap | null {
  const find = (...patterns: string[]): number => {
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase();
      for (const p of patterns) {
        if (h.includes(p.toLowerCase())) return i;
      }
    }
    return -1;
  };

  const refArtigo = find('referência artigo', 'referencia artigo', 'ref. artigo', 'ref artigo');
  const maquina = find('máquina', 'maquina');

  if (refArtigo < 0 || maquina < 0) return null;

  return {
    cliente: find('cliente'),
    nome: find('nome'),
    refArtigo,
    designacao: find('designação', 'designacao'),
    loteEcon: find('lote econ', 'lote económico', 'lote economico'),
    przFabrico: find('prz.fabrico', 'prz fabrico', 'prazo fabrico', 'prazo de fabrico'),
    maquina,
    maqAlt: find('máq. alt', 'maq. alt', 'máquina alt', 'maquina alt'),
    ferramenta: find('ferramenta'),
    tpSetup: find('tp.setup', 'tp setup', 'setup'),
    pecasH: find(
      'peças/h',
      'pecas/h',
      'pcs/h',
      'pçs/h',
      'peças / h',
      'pecas / h',
      'cadência',
      'cadencia',
      'rate',
    ),
    nPessoas: find('nº pessoas', 'n pessoas', 'num pessoas', 'nº pess', 'n. pess', 'pessoas'),
    qtdExp: find('qtd exp', 'qtd. exp', 'qtd expedição', 'qtd expedicao'),
    produtoAcabado: find('produto acabado', 'prod. acabado', 'prod acabado', 'pa', 'parent'),
    stockA: find('stock-a', 'stock a', 'stock'),
    wip: find('wip'),
    atraso: find('atraso'),
    estadoMaq: find(
      'estado máq',
      'estado maq',
      'status máq',
      'status maq',
      'estado máquina',
      'estado maquina',
    ),
    estadoFerr: find('estado ferr', 'status ferr', 'estado ferramenta', 'status ferramenta'),
    pecaGemea: find('peca gemea', 'peça gémea', 'peça gemea', 'pç gemea', 'twin'),
  };
}

/** Find the metadata row (contains "PA:" pattern) above the header row */
function findMetadataRow(allRows: unknown[][], headerRowIndex: number): number {
  for (let ri = Math.max(0, headerRowIndex - 3); ri < headerRowIndex; ri++) {
    const row = allRows[ri];
    if (!row) continue;
    const firstCell = normalizeString(row[0]);
    if (firstCell.includes('PA:') || firstCell.includes('Atrasos:')) return ri;
  }
  return -1;
}

/** Find workday flags row (a row between metadata and header that has 0/1 values in date columns) */
function findWorkdayFlagsRow(
  allRows: unknown[][],
  headerRowIndex: number,
  dateColIndices: number[],
): boolean[] | null {
  // Look between metadata row and header row
  for (let ri = Math.max(0, headerRowIndex - 4); ri < headerRowIndex; ri++) {
    const row = allRows[ri];
    if (!row) continue;
    // Check if this row has 0/1 values in date columns
    let is01 = true;
    let count = 0;
    for (const ci of dateColIndices) {
      const v = row[ci];
      if (v == null) continue;
      const n = parseNumeric(v, -1);
      if (n !== 0 && n !== 1) {
        is01 = false;
        break;
      }
      count++;
    }
    if (is01 && count > 3) {
      return dateColIndices.map((ci) => {
        const v = row[ci];
        if (v == null) return true;
        return parseNumeric(v, 1) === 1;
      });
    }
  }
  return null;
}

// ── Cell color detection (GAP-1: red cells = inoperational) ──

/**
 * Check if a cell has a red fill (background) colour.
 * Nikufra convention: red-highlighted machine/tool cells indicate "inoperacional".
 * SheetJS exposes `.s.fgColor` / `.s.patternType` when `cellStyles: true`.
 */
function isCellRedHighlighted(ws: XLSX.WorkSheet, row: number, col: number): boolean {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  const cell = ws[addr];
  if (!cell || !cell.s) return false;

  const style = cell.s as Record<string, unknown>;

  // Check fill color (cell background)
  const fgColor = style.fgColor as { rgb?: string; theme?: number } | undefined;
  if (fgColor?.rgb && isRedColor(fgColor.rgb)) return true;

  const bgColor = style.bgColor as { rgb?: string; theme?: number } | undefined;
  if (bgColor?.rgb && isRedColor(bgColor.rgb)) return true;

  // Some SheetJS versions nest under .fill
  const fill = style.fill as Record<string, unknown> | undefined;
  if (fill) {
    const fillFg = fill.fgColor as { rgb?: string } | undefined;
    if (fillFg?.rgb && isRedColor(fillFg.rgb)) return true;
    const fillBg = fill.bgColor as { rgb?: string } | undefined;
    if (fillBg?.rgb && isRedColor(fillBg.rgb)) return true;
  }

  // Check font color as fallback (red text can also indicate down)
  const font = style.font as Record<string, unknown> | undefined;
  if (font) {
    const fontColor = font.color as { rgb?: string } | undefined;
    if (fontColor?.rgb && isRedColor(fontColor.rgb)) return true;
  }

  return false;
}

/** Detect red tones: high R, low G and B */
function isRedColor(rgb: string): boolean {
  // SheetJS RGB can be 6-char (RRGGBB) or 8-char (AARRGGBB)
  const hex = rgb.length === 8 ? rgb.substring(2) : rgb;
  if (hex.length !== 6) return false;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return r > 180 && g < 100 && b < 100;
}

// ── Main parser ──

export function parseISOPFile(
  arrayBuffer: ArrayBuffer,
  _semantics: string = 'DEMAND_QTY_BY_DATE',
): ParseResult | ParseError {
  // 1. Read workbook
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, cellStyles: true });
  } catch {
    return { success: false, errors: ['Ficheiro XLSX inválido — não foi possível abrir.'] };
  }

  // 2. Find sheet "Planilha1"
  const sheetName = wb.SheetNames.find((n) => n === 'Planilha1' || n.toLowerCase() === 'planilha1');
  if (!sheetName) {
    return { success: false, errors: ['Sheet "Planilha1" não encontrada no ficheiro.'] };
  }

  const ws = wb.Sheets[sheetName];

  // Convert to array-of-arrays for easier indexing (0-based rows)
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
  });

  if (allRows.length < 3) {
    return { success: false, errors: ['Ficheiro com menos de 3 linhas — formato ISOP inválido.'] };
  }

  // 3. Find header row dynamically (scan rows 0-15)
  const headerResult = findHeaderRow(allRows);
  if (!headerResult) {
    return {
      success: false,
      errors: [
        'Nenhuma linha de cabeçalho encontrada com "Referência Artigo" e "Máquina" (procurado nas primeiras 16 linhas).',
      ],
    };
  }

  const { rowIndex: headerRowIndex, headers } = headerResult;
  const headerRow = allRows[headerRowIndex] ?? [];

  // 4. Map columns by header name
  const colMap = buildColumnMap(headers);
  if (!colMap) {
    return {
      success: false,
      errors: ['Colunas "Referência Artigo" e "Máquina" não encontradas nos cabeçalhos.'],
    };
  }

  // 5. Find date columns: scan header row for date-parseable values after known text columns
  const lastTextCol = Math.max(
    colMap.atraso,
    colMap.stockA,
    colMap.wip,
    colMap.nPessoas,
    colMap.pecasH,
    colMap.ferramenta,
    colMap.qtdExp,
    colMap.maquina,
  );
  const dateSearchStart = lastTextCol >= 0 ? lastTextCol + 1 : 10;

  const dates: Date[] = [];
  const dateColIndices: number[] = [];

  for (let ci = dateSearchStart; ci < headerRow.length; ci++) {
    const d = parseDateCell(headerRow[ci]);
    if (d) {
      dates.push(d);
      dateColIndices.push(ci);
    }
  }

  // Fallback: try from column 10 onward if no dates found
  if (dates.length === 0) {
    for (let ci = 10; ci < headerRow.length; ci++) {
      const d = parseDateCell(headerRow[ci]);
      if (d) {
        dates.push(d);
        dateColIndices.push(ci);
      }
    }
  }

  if (dates.length === 0) {
    return {
      success: false,
      errors: [`Nenhuma coluna de data encontrada no cabeçalho (linha ${headerRowIndex + 1}).`],
    };
  }

  const nDays = dates.length;

  // 6. Parse working day flags
  // First try to find a dedicated row with 0/1 flags
  let workdayFlags = findWorkdayFlagsRow(allRows, headerRowIndex, dateColIndices);
  // Fallback: infer from day of week (Mon-Fri = workday, Sat/Sun = non-workday)
  if (!workdayFlags) {
    workdayFlags = dates.map((d) => {
      const dow = d.getDay();
      return dow >= 1 && dow <= 5; // Monday(1) to Friday(5)
    });
  }
  // Ensure workday flags match dates array length
  if (workdayFlags.length !== dates.length) {
    workdayFlags = dates.map(() => true);
  }

  // 7. Parse data rows (starting after header row)
  const dataStartRow = headerRowIndex + 1;
  const parsedRows: ParsedRow[] = [];
  const warnings: string[] = [];

  for (let ri = dataStartRow; ri < allRows.length; ri++) {
    const row = allRows[ri];
    if (!row || row.length === 0) continue;

    const item_sku = normalizeCode(row[colMap.refArtigo]);
    if (!item_sku) continue; // Skip empty rows

    const resource_code = normalizeCode(row[colMap.maquina]);
    if (!resource_code) {
      warnings.push(`Linha ${ri + 1}: SKU "${item_sku}" sem máquina — ignorada.`);
      continue;
    }

    const alt_resource = colMap.maqAlt >= 0 ? normalizeCode(row[colMap.maqAlt]) : '';
    const tool_code = colMap.ferramenta >= 0 ? normalizeCode(row[colMap.ferramenta]) : '';
    const rate = colMap.pecasH >= 0 ? parseNumeric(row[colMap.pecasH]) : 0;

    if (rate <= 0 && colMap.pecasH >= 0) {
      warnings.push(
        `Linha ${ri + 1}: SKU "${item_sku}" rate=0 — incluída mas não será agendada (rate inválido).`,
      );
    }
    if (
      colMap.tpSetup >= 0 &&
      typeof row[colMap.tpSetup] === 'string' &&
      isNaN(Number(String(row[colMap.tpSetup]).replace(',', '.')))
    ) {
      warnings.push(
        `Linha ${ri + 1}: SKU "${item_sku}" setup inválido ("${row[colMap.tpSetup]}") — interpretado como 0.`,
      );
    }

    // Extract date column quantities — RAW NP values (no conversion)
    // ISOP date columns contain NET_POSITION (NP):
    //   positive = stock still covers demand (no production needed)
    //   negative = shortfall (production needed)
    //   null/empty = no change from previous day (forward-filled by engine)
    // The engine's rawNPtoDailyDemand() does the full 3-step pipeline:
    //   1. Forward-fill nulls  2. max(0,-NP)  3. Deltaize to daily demand
    let invalidCellsThisRow = 0;
    const daily_quantities: (number | null)[] = dateColIndices.map((ci) => {
      const raw = row[ci];
      if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return null;
      if (typeof raw === 'string' && isNaN(Number(raw.replace(',', '.')))) {
        invalidCellsThisRow++;
        return null;
      }
      return parseNumeric(raw);
    });
    if (invalidCellsThisRow > 0) {
      warnings.push(
        `Linha ${ri + 1}: SKU "${item_sku}" tem ${invalidCellsThisRow} célula(s) de data não-numérica(s) — interpretada(s) como 0.`,
      );
    }

    parsedRows.push({
      customer_code: colMap.cliente >= 0 ? normalizeCode(row[colMap.cliente]) : '',
      customer_name: colMap.nome >= 0 ? normalizeString(row[colMap.nome]) : '',
      parent_sku: colMap.produtoAcabado >= 0 ? normalizeCode(row[colMap.produtoAcabado]) : '',
      item_sku,
      item_name: colMap.designacao >= 0 ? normalizeString(row[colMap.designacao]) : item_sku,
      lot_economic_qty: colMap.loteEcon >= 0 ? parseInteger(row[colMap.loteEcon], 0) : 0,
      lead_time_days: colMap.przFabrico >= 0 ? parseInteger(row[colMap.przFabrico], 0) : 0,
      resource_code,
      alt_resource: alt_resource === '-' ? '' : alt_resource,
      tool_code,
      setup_time: colMap.tpSetup >= 0 ? parseNumeric(row[colMap.tpSetup]) : 0,
      rate,
      operators_required: colMap.nPessoas >= 0 ? parseInteger(row[colMap.nPessoas], 1) : 1,
      qtd_exp: colMap.qtdExp >= 0 ? parseNumeric(row[colMap.qtdExp]) : 0,
      stock: 0, // Stock-A (Col N) eliminado — forçado a 0
      wip: colMap.wip >= 0 ? parseNumeric(row[colMap.wip]) : 0,
      atraso: colMap.atraso >= 0 ? parseNumeric(row[colMap.atraso]) : 0,
      daily_quantities,
      // Detect inoperational status via text columns OR red cell colour (GAP-1)
      machine_down:
        (colMap.estadoMaq >= 0
          ? /inact|down|avaria|parad|inoper/i.test(normalizeString(row[colMap.estadoMaq]))
          : false) || isCellRedHighlighted(ws, ri, colMap.maquina),
      tool_down:
        (colMap.estadoFerr >= 0
          ? /inact|down|avaria|parad|inoper/i.test(normalizeString(row[colMap.estadoFerr]))
          : false) ||
        (colMap.ferramenta >= 0 && isCellRedHighlighted(ws, ri, colMap.ferramenta)),
      twin: colMap.pecaGemea >= 0 ? normalizeCode(row[colMap.pecaGemea]) : '',
    });
  }

  if (parsedRows.length === 0) {
    return {
      success: false,
      errors: [`Nenhuma linha de dados válida encontrada (a partir da linha ${dataStartRow + 1}).`],
    };
  }

  // Log detection info for debugging
  const metaRow = findMetadataRow(allRows, headerRowIndex);
  if (metaRow >= 0) {
    const metaCell = normalizeString(allRows[metaRow]?.[0]);
    if (metaCell) {
      warnings.push(`Metadata detectada na linha ${metaRow + 1}: "${metaCell.slice(0, 60)}"`);
    }
  }
  warnings.push(
    `Cabeçalho detectado na linha ${headerRowIndex + 1}, dados a partir da linha ${dataStartRow + 1}, ${nDays} datas, ${parsedRows.length} operações.`,
  );

  // 8. Build NikufraData

  // -- Machines: deduplicate and assign areas
  const machineSet = new Set<string>();
  parsedRows.forEach((r) => {
    machineSet.add(r.resource_code);
    if (r.alt_resource) machineSet.add(r.alt_resource);
  });

  // Detect machines marked as down in any row (text column OR red cell colour)
  const machinesDown = new Set<string>();
  parsedRows.forEach((r) => {
    if (r.machine_down) machinesDown.add(r.resource_code);
  });
  if (machinesDown.size > 0) {
    warnings.push(
      `Máquinas inoperacionais detectadas (texto/cor): ${Array.from(machinesDown).join(', ')}`,
    );
  }

  const unknownMachines = Array.from(machineSet).filter((id) => !MACHINE_AREA[id]);
  if (unknownMachines.length > 0) {
    warnings.push(
      `Máquina(s) desconhecida(s) atribuída(s) a PG1 por defeito: ${unknownMachines.join(', ')}. ` +
        `Verifique se a área está correcta.`,
    );
  }

  const machines: NikufraMachine[] = Array.from(machineSet)
    .sort()
    .map((id) => ({
      id,
      area: MACHINE_AREA[id] || 'PG1',
      man: new Array(nDays).fill(0),
      ...(machinesDown.has(id) ? { status: 'down' as const } : {}),
    }));

  // -- Tools: group by tool code, collect SKUs
  const toolMap = new Map<
    string,
    {
      id: string;
      m: string;
      alt: string;
      s: number;
      pH: number;
      op: number;
      skus: string[];
      nm: string[];
      lt: number;
      stk: number;
      wip: number;
    }
  >();

  for (const row of parsedRows) {
    if (!row.tool_code) continue;
    const existing = toolMap.get(row.tool_code);
    if (existing) {
      // Add SKU if not already tracked
      if (!existing.skus.includes(row.item_sku)) {
        existing.skus.push(row.item_sku);
        existing.nm.push(row.item_name);
      }
      // Warn if same tool appears with a different primary machine (keeps first)
      if (row.resource_code !== existing.m) {
        warnings.push(
          `Ferramenta "${row.tool_code}" aparece com máquinas diferentes: ` +
            `${existing.m} (mantida) vs ${row.resource_code} (SKU ${row.item_sku}) — a usar ${existing.m}.`,
        );
      }
      // Stock-A eliminado — stk fica 0
      // Take the highest WIP value across rows for same tool (consistent with stock)
      existing.wip = Math.max(existing.wip, row.wip);
    } else {
      toolMap.set(row.tool_code, {
        id: row.tool_code,
        m: row.resource_code,
        alt: row.alt_resource || '-',
        s: row.setup_time,
        pH: row.rate,
        op: row.operators_required,
        skus: [row.item_sku],
        nm: [row.item_name],
        lt: row.lot_economic_qty,
        stk: 0, // Stock-A eliminado
        wip: row.wip,
      });
    }
  }

  // Detect tools marked as down in any row (text column OR red cell colour)
  const toolsDown = new Set<string>();
  parsedRows.forEach((r) => {
    if (r.tool_down && r.tool_code) toolsDown.add(r.tool_code);
  });
  if (toolsDown.size > 0) {
    warnings.push(
      `Ferramentas inoperacionais detectadas (texto/cor): ${Array.from(toolsDown).join(', ')}`,
    );
  }

  const tools: NikufraTool[] = Array.from(toolMap.values()).map((t) =>
    toolsDown.has(t.id) ? { ...t, status: 'down' as const } : t,
  );

  // -- Customers: deduplicate
  const customerMap = new Map<string, string>();
  for (const row of parsedRows) {
    if (row.customer_code && !customerMap.has(row.customer_code)) {
      customerMap.set(row.customer_code, row.customer_name);
    }
  }
  const customers: NikufraCustomer[] = Array.from(customerMap.entries())
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code));

  // Warn about operations with no tool code (they won't be scheduled)
  const opsWithoutTool = parsedRows.filter((r) => !r.tool_code);
  if (opsWithoutTool.length > 0) {
    warnings.push(
      `${opsWithoutTool.length} operação(ões) sem código de ferramenta — não serão agendadas: ` +
        `${opsWithoutTool
          .slice(0, 5)
          .map((r) => r.item_sku)
          .join(', ')}${opsWithoutTool.length > 5 ? '…' : ''}`,
    );
  }

  // -- Operations: one per ISOP row
  const operations: NikufraOperation[] = parsedRows.map((row, idx) => ({
    id: `OP${String(idx + 1).padStart(2, '0')}`,
    m: row.resource_code,
    t: row.tool_code,
    sku: row.item_sku,
    nm: row.item_name,
    pH: row.rate,
    atr: row.atraso,
    d: row.daily_quantities,
    s: row.setup_time,
    op: row.operators_required,
    cl: row.customer_code || undefined,
    clNm: row.customer_name || undefined,
    pa: row.parent_sku || undefined,
    wip: row.wip || undefined,
    qe: row.qtd_exp || undefined,
    ltDays: row.lead_time_days || undefined,
    twin: row.twin || undefined,
  }));

  // -- MO (operator capacity per area per day)
  // ISOP does not contain operator capacity — it comes from bdmestre (fixture).
  // Empty arrays signal that mergeWithMasterData should enrich from fixture.
  const mo: NikufraMOLoad = { PG1: [], PG2: [] };

  // -- Dates & labels
  const dateLabels = dates.map((d) => formatDate(d));
  const dayLabels = dates.map((d) => dayLabel(d));

  // 9. Build result
  const nikufraData: NikufraData = {
    dates: dateLabels,
    days_label: dayLabels,
    mo,
    machines,
    tools,
    operations,
    history: [],
    customers,
    workday_flags: workdayFlags,
  };

  // 10. Compute trust score
  const trustScore = computeTrustScore(parsedRows, tools, operations, nDays);

  // Count unique values
  const uniqueSkus = new Set(parsedRows.map((r) => r.item_sku));
  const uniqueMachines = new Set(parsedRows.map((r) => r.resource_code));
  const uniqueTools = new Set(parsedRows.filter((r) => r.tool_code).map((r) => r.tool_code));
  const workdayCount = workdayFlags.filter(Boolean).length;

  const meta: LoadMeta = {
    rows: parsedRows.length,
    machines: uniqueMachines.size,
    tools: uniqueTools.size,
    skus: uniqueSkus.size,
    dates: nDays,
    workdays: workdayCount,
    trustScore,
    warnings,
  };

  const sourceColumns = {
    hasSetup: colMap.tpSetup >= 0,
    hasAltMachine: colMap.maqAlt >= 0,
    hasRate: colMap.pecasH >= 0,
    hasParentSku: colMap.produtoAcabado >= 0,
    hasLeadTime: colMap.przFabrico >= 0,
    hasQtdExp: colMap.qtdExp >= 0,
    hasTwin: colMap.pecaGemea >= 0,
  };

  // Log what was detected vs missing for diagnostic clarity
  const missing = Object.entries(sourceColumns)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    warnings.push(
      `Colunas não detectadas: ${missing.join(', ')} — serão preenchidas pelo ISOP Mestre ou defaults.`,
    );
  }

  return { success: true, data: nikufraData, meta, sourceColumns };
}

// ── Trust score (simplified client-side) ──

function computeTrustScore(
  rows: ParsedRow[],
  tools: NikufraTool[],
  operations: NikufraOperation[],
  _nDays: number,
): number {
  if (rows.length === 0) return 0;

  // 1. Completeness (40%): % of rows with all key fields
  let complete = 0;
  for (const r of rows) {
    const hasAll = r.item_sku && r.resource_code && r.tool_code && r.rate > 0 && r.setup_time >= 0;
    if (hasAll) complete++;
  }
  const completeness = complete / rows.length;

  // 2. Quality (30%): rates > 0, setup >= 0, operators >= 1
  let valid = 0;
  for (const r of rows) {
    const ok = r.rate > 0 && r.setup_time >= 0 && r.operators_required >= 1;
    if (ok) valid++;
  }
  const quality = valid / rows.length;

  // 3. Demand coverage (20%): % of operations with at least one non-zero demand day
  let withDemand = 0;
  for (const op of operations) {
    if (op.d.some((v) => v !== null && v !== 0)) withDemand++;
  }
  const demandCoverage = operations.length > 0 ? withDemand / operations.length : 0;

  // 4. Consistency (10%): % of tools with valid machine assignment
  let validTools = 0;
  const machineSet = new Set(rows.map((r) => r.resource_code));
  for (const t of tools) {
    if (machineSet.has(t.m)) validTools++;
  }
  const consistency = tools.length > 0 ? validTools / tools.length : 1;

  return (
    Math.round(
      (completeness * 0.4 + quality * 0.3 + demandCoverage * 0.2 + consistency * 0.1) * 100,
    ) / 100
  );
}

export type { LoadMeta };
