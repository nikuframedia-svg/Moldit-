import { Button, Card, Statistic, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { config } from '@/config';
import { fetchWithTimeout } from '@/lib/fetchWithTimeout';

interface LearningProposal {
  id: string;
  parameter: string;
  current_value: number;
  proposed_value: number;
  confidence: number;
  reason: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export function LearningPage() {
  const [proposals, setProposals] = useState<LearningProposal[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithTimeout(`${config.apiBaseURL}/v1/learning/proposals`, {}, 10_000);
      if (res.ok) {
        const data = await res.json();
        setProposals(Array.isArray(data) ? data : (data.proposals ?? []));
      }
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const handleAction = async (id: string, action: 'accepted' | 'rejected') => {
    try {
      await fetchWithTimeout(
        `${config.apiBaseURL}/v1/learning/proposals/${id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: action }),
        },
        10_000,
      );
      fetchProposals();
    } catch {
      // Silently handle
    }
  };

  const pending = proposals.filter((p) => p.status === 'pending');
  const accepted = proposals.filter((p) => p.status === 'accepted');
  const rejected = proposals.filter((p) => p.status === 'rejected');

  const columns: ColumnsType<LearningProposal> = [
    {
      title: 'Parâmetro',
      dataIndex: 'parameter',
      key: 'parameter',
      width: 200,
    },
    {
      title: 'Actual',
      dataIndex: 'current_value',
      key: 'current_value',
      width: 100,
      render: (v: number) => v?.toFixed(2),
    },
    {
      title: 'Proposto',
      dataIndex: 'proposed_value',
      key: 'proposed_value',
      width: 100,
      render: (v: number) => v?.toFixed(2),
    },
    {
      title: 'Confiança',
      dataIndex: 'confidence',
      key: 'confidence',
      width: 100,
      render: (v: number) => `${(v * 100).toFixed(0)}%`,
    },
    {
      title: 'Razão',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true,
    },
    {
      title: 'Estado',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: string) => {
        const color = status === 'accepted' ? 'green' : status === 'rejected' ? 'red' : 'blue';
        const label =
          status === 'accepted' ? 'Aceite' : status === 'rejected' ? 'Rejeitada' : 'Pendente';
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: 'Acções',
      key: 'actions',
      width: 160,
      render: (_: unknown, row: LearningProposal) =>
        row.status === 'pending' ? (
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="small" type="primary" onClick={() => handleAction(row.id, 'accepted')}>
              Aceitar
            </Button>
            <Button size="small" danger onClick={() => handleAction(row.id, 'rejected')}>
              Rejeitar
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 16, color: 'var(--text-primary)' }}>Aprendizagem</h2>

      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <Card size="small" style={{ minWidth: 140 }}>
          <Statistic
            title="Pendentes"
            value={pending.length}
            valueStyle={{ color: 'var(--accent)' }}
          />
        </Card>
        <Card size="small" style={{ minWidth: 140 }}>
          <Statistic
            title="Aceites"
            value={accepted.length}
            valueStyle={{ color: 'var(--semantic-ok)' }}
          />
        </Card>
        <Card size="small" style={{ minWidth: 140 }}>
          <Statistic
            title="Rejeitadas"
            value={rejected.length}
            valueStyle={{ color: 'var(--semantic-critical)' }}
          />
        </Card>
      </div>

      <Table
        columns={columns}
        dataSource={proposals}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={{ pageSize: 25, showSizeChanger: true }}
        locale={{ emptyText: 'Sem propostas de aprendizagem' }}
        scroll={{ x: 900 }}
      />
    </div>
  );
}
