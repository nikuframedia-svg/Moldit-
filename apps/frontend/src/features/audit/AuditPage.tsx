import { Input, Select, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { config } from '@/config';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  entity_type: string;
  entity_id: string;
  actor_id: string;
  step: string;
  severity: string;
  detail: string;
  metadata: Record<string, unknown>;
}

const SEVERITY_COLORS: Record<string, string> = {
  INFO: 'blue',
  WARN: 'orange',
  ERROR: 'red',
  DROP: 'volcano',
};

const STEP_COLORS: Record<string, string> = {
  PARSE: 'cyan',
  TRANSFORM: 'geekblue',
  SOLVE: 'purple',
  VALIDATE: 'green',
  COVERAGE: 'lime',
  MRP: 'gold',
};

export function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [stepFilter, setStepFilter] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (stepFilter) params.set('step', stepFilter);
      if (severityFilter) params.set('severity', severityFilter);
      const qs = params.toString();
      const url = `${config.apiBaseURL}/v1/audit/entries${qs ? `?${qs}` : ''}`;
      const res = await fetchWithTimeout(url, {}, 10_000);
      if (res.ok) {
        const data = await res.json();
        setEntries(Array.isArray(data) ? data : (data.entries ?? []));
      }
    } catch {
      // Silently handle — page shows empty state
    } finally {
      setLoading(false);
    }
  }, [search, stepFilter, severityFilter]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const columns: ColumnsType<AuditEntry> = [
    {
      title: 'Hora',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 160,
      render: (ts: string) => {
        try {
          return new Date(ts).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'medium' });
        } catch {
          return ts;
        }
      },
    },
    {
      title: 'Step',
      dataIndex: 'step',
      key: 'step',
      width: 110,
      render: (step: string) => <Tag color={STEP_COLORS[step] ?? 'default'}>{step}</Tag>,
    },
    {
      title: 'Severidade',
      dataIndex: 'severity',
      key: 'severity',
      width: 100,
      render: (sev: string) => <Tag color={SEVERITY_COLORS[sev] ?? 'default'}>{sev}</Tag>,
    },
    {
      title: 'Acção',
      dataIndex: 'action',
      key: 'action',
      width: 180,
    },
    {
      title: 'Entidade',
      key: 'entity',
      width: 180,
      render: (_: unknown, row: AuditEntry) =>
        row.entity_id ? `${row.entity_type}:${row.entity_id}` : row.entity_type,
    },
    {
      title: 'Detalhe',
      dataIndex: 'detail',
      key: 'detail',
      ellipsis: true,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 16, color: 'var(--text-primary)' }}>Auditoria</h2>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input.Search
          placeholder="Pesquisar por op_id ou machine_id..."
          allowClear
          style={{ width: 280 }}
          onSearch={setSearch}
        />
        <Select
          placeholder="Step"
          allowClear
          style={{ width: 150 }}
          onChange={(v) => setStepFilter(v ?? null)}
          options={['PARSE', 'TRANSFORM', 'SOLVE', 'VALIDATE', 'COVERAGE', 'MRP'].map((s) => ({
            label: s,
            value: s,
          }))}
        />
        <Select
          placeholder="Severidade"
          allowClear
          style={{ width: 150 }}
          onChange={(v) => setSeverityFilter(v ?? null)}
          options={['INFO', 'WARN', 'ERROR', 'DROP'].map((s) => ({
            label: s,
            value: s,
          }))}
        />
      </div>

      <Table
        columns={columns}
        dataSource={entries}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 50, showSizeChanger: true }}
        locale={{ emptyText: 'Sem entradas de auditoria' }}
        scroll={{ x: 900 }}
      />
    </div>
  );
}
