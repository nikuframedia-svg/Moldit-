/**
 * ConsolePage — Centro de Comando Diario
 *
 * Main landing page. Select a day from the planning horizon and see
 * KPIs, machines, operations, operators, alerts, decisions, D+1, transparency.
 */

import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/Common/EmptyState';
import { SkeletonCard, SkeletonTable } from '@/components/Common/SkeletonLoader';
import { StatusBanner } from '@/components/Common/StatusBanner';
import { useDayData } from '@/hooks/useDayData';
import { useScheduleData } from '@/hooks/useScheduleData';
import type { Block } from '@/lib/engine';
import { C, DAY_CAP } from '@/lib/engine';
import { useUIStore } from '@/stores/useUIStore';
import { ActiveDecisions } from '../components/ActiveDecisions';
import { AlertsFeed } from '../components/AlertsFeed';
import { AlertsPanel } from '../components/AlertsPanel';
import { D1Preparation } from '../components/D1Preparation';
import { DayOrders } from '../components/DayOrders';
import { DaySelector } from '../components/DaySelector';
import { KPIGrid } from '../components/KPIGrid';
import { MachineStatusGrid } from '../components/MachineStatusGrid';
import { MachineTimeline } from '../components/MachineTimeline';
import { OperatorPanel } from '../components/OperatorPanel';
import { TransparencyPanel } from '../components/TransparencyPanel';
import { WorkforceNeeds } from '../components/WorkforceNeeds';
import './ConsolePage.css';

export function ConsolePage() {
  const { dayData, loading, error } = useDayData();
  const { engine, cap, blocks: allBlocks, metrics, validation } = useScheduleData();
  const panelOpen = useUIStore((s) => s.contextPanelOpen);
  const setSelectedDayIdx = useUIStore((s) => s.actions.setSelectedDayIdx);
  const openContextPanel = useUIStore((s) => s.actions.openContextPanel);
  const setFocus = useUIStore((s) => s.actions.setFocus);

  // Daily factory utilization for all days (DaySelector dots)
  const dailyUtils = useMemo(() => {
    if (!engine || !cap) return [];
    return engine.dates.map((_, i) => {
      let totalUsed = 0;
      let totalCap = 0;
      engine.machines.forEach((m) => {
        const d = cap[m.id]?.[i];
        if (d) {
          totalUsed += d.prod + d.setup;
          totalCap += DAY_CAP;
        }
      });
      return totalCap > 0 ? totalUsed / totalCap : 0;
    });
  }, [engine, cap]);

  // Sparkline data: last 7 days of KPIs relative to selected day
  const sparklines = useMemo(() => {
    if (!engine || !cap || !dayData) return undefined;
    const idx = dayData.dayIdx;
    const pcs: number[] = [];
    const ops: number[] = [];
    const util: number[] = [];
    const setup: number[] = [];
    const alerts: number[] = [];

    for (let d = Math.max(0, idx - 6); d <= idx; d++) {
      let dPcs = 0,
        dOps = 0,
        dSetup = 0,
        dUsed = 0,
        dCap = 0;
      for (const m of engine.machines) {
        const load = cap[m.id]?.[d];
        if (load) {
          dPcs += load.pcs;
          dOps += load.ops;
          dSetup += load.setup;
          dUsed += load.prod + load.setup;
          dCap += DAY_CAP;
        }
      }
      pcs.push(dPcs);
      ops.push(dOps);
      util.push(dCap > 0 ? dUsed / dCap : 0);
      setup.push(dSetup);

      const dayViolations =
        validation?.violations.filter((v) => v.affectedOps.some((a) => a.dayIdx === d)).length ?? 0;
      alerts.push(dayViolations);
    }
    return { pcs, ops, util, setup, alerts, operators: [] };
  }, [engine, cap, dayData, validation]);

  // OTD from global metrics
  const otd = metrics?.otdDelivery;

  // Feasibility score for this day (ok blocks / total blocks)
  const dayFeasibilityScore = useMemo(() => {
    if (!dayData || dayData.blocks.length === 0) return 1;
    const okCount = dayData.okBlocks.length;
    const total = dayData.blocks.length;
    return total > 0 ? okCount / total : 1;
  }, [dayData]);

  // StatusBanner derivation
  const bannerVariant = useMemo((): 'ok' | 'warning' | 'critical' => {
    if (!dayData) return 'ok';
    if (dayData.infeasibilities.length > 0) return 'critical';
    if (dayData.violations.length > 0 || dayData.overflowBlocks.length > 0) return 'warning';
    return 'ok';
  }, [dayData]);

  const bannerMessage = useMemo(() => {
    if (!dayData) return '';
    const alertCount = dayData.violations.length + dayData.infeasibilities.length;
    if (alertCount === 0) {
      return `Dia ${dayData.dayName} ${dayData.date} — ${dayData.okBlocks.length} operacoes escalonadas sem problemas.`;
    }
    return `Dia ${dayData.dayName} ${dayData.date} — ${alertCount} alerta(s): ${dayData.infeasibilities.length} infeasivel(eis), ${dayData.violations.length} violacao(oes).`;
  }, [dayData]);

  // Interactions
  const handleDaySelect = useCallback(
    (idx: number) => {
      if (!engine) return;
      setSelectedDayIdx(idx);
      setFocus({ dayIdx: idx, day: engine.dates[idx] });
    },
    [engine, setSelectedDayIdx, setFocus],
  );

  const handleBlockClick = useCallback(
    (block: Block) => {
      openContextPanel({ type: 'tool', id: block.toolId });
      setFocus({ machine: block.machineId, toolId: block.toolId, dayIdx: block.dayIdx });
    },
    [openContextPanel, setFocus],
  );

  const handleMachineClick = useCallback(
    (machineId: string) => {
      openContextPanel({ type: 'machine', id: machineId });
      setFocus({ machine: machineId });
    },
    [openContextPanel, setFocus],
  );

  const handleNavigateToBlock = useCallback(
    (opId: string) => {
      const block = allBlocks.find((b) => b.opId === opId);
      if (block) {
        openContextPanel({ type: 'tool', id: block.toolId });
        setFocus({ machine: block.machineId, toolId: block.toolId, dayIdx: block.dayIdx });
      }
    },
    [allBlocks, openContextPanel, setFocus],
  );

  // Loading state
  if (loading) {
    return (
      <div className="cmd" data-testid="comando-diario-page">
        <div className="cmd__header">
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: C.t1, margin: 0 }}>
              Centro de Comando Diario
            </h1>
            <p className="page-desc">
              Visao completa por dia: maquinas, operacoes, operadores, alertas e decisoes.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} lines={1} />
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(6, 1fr)',
            gap: 8,
            marginBottom: 16,
          }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
        <SkeletonTable rows={6} cols={5} />
      </div>
    );
  }

  // Error / no data
  if (error || !engine || !dayData) {
    return (
      <div className="cmd" data-testid="comando-diario-page">
        <div className="cmd__header">
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: C.t1, margin: 0 }}>
              Centro de Comando Diario
            </h1>
            <p className="page-desc">
              Visao completa por dia: maquinas, operacoes, operadores, alertas e decisoes.
            </p>
          </div>
        </div>
        <EmptyState
          icon="error"
          title="Sem dados de scheduling"
          description={
            error ?? 'O engine nao tem dados carregados. Carregue um ISOP ou verifique a fixture.'
          }
        />
      </div>
    );
  }

  return (
    <div className={`cmd${panelOpen ? ' cmd--panel-open' : ''}`} data-testid="comando-diario-page">
      {/* Header */}
      <div className="cmd__header">
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, color: C.t1, margin: 0 }}>
            Centro de Comando Diario
          </h1>
          <p className="page-desc">
            Visao completa por dia: maquinas, operacoes, operadores, alertas e decisoes.
          </p>
        </div>
        <span style={{ fontSize: 11, color: C.t3, fontFamily: 'var(--font-mono)' }}>
          {dayData.nDays} dias · {allBlocks.length} blocos · {engine.machines.length} maquinas
        </span>
      </div>

      {/* Top sections — full width */}
      <div className="cmd__top">
        <DaySelector
          dates={dayData.allDates}
          dayNames={engine.dnames}
          workdays={dayData.workdays}
          selectedIdx={dayData.dayIdx}
          onSelect={handleDaySelect}
          dailyUtils={dailyUtils}
        />

        <StatusBanner variant={bannerVariant} message={bannerMessage} />

        <Link
          to={`/console/day/${dayData.date}`}
          style={{ fontSize: 11, color: C.ac, textDecoration: 'none', alignSelf: 'flex-end' }}
        >
          Ver dia completo →
        </Link>

        <KPIGrid
          totalPcs={dayData.totalPcs}
          totalOps={dayData.totalOps}
          factoryUtil={dayData.factoryUtil}
          totalSetupMin={dayData.totalSetupMin}
          violationCount={dayData.violations.length}
          infeasibleCount={dayData.infeasibilities.length}
          overflowCount={dayData.overflowBlocks.length}
          operatorsByArea={dayData.operatorsByArea}
          operatorCapacity={dayData.operatorCapacity}
          sparklines={sparklines}
          otd={otd}
        />
      </div>

      {/* Machine status cards */}
      <MachineStatusGrid
        engine={dayData.engine}
        blocks={dayData.blocks}
        machineLoads={dayData.machineLoads}
      />

      {/* Two-column body */}
      <div className="cmd__body">
        {/* Primary column (3fr) */}
        <div className="cmd__primary">
          <MachineTimeline
            engine={dayData.engine}
            blocks={dayData.blocks}
            machineLoads={dayData.machineLoads}
            date={dayData.date}
            onBlockClick={handleBlockClick}
            onMachineClick={handleMachineClick}
          />

          <DayOrders blocks={dayData.blocks} onBlockClick={handleBlockClick} />

          <TransparencyPanel
            orderJustifications={dayData.orderJustifications}
            failureJustifications={dayData.failureJustifications}
            engine={dayData.engine}
          />
        </div>

        {/* Secondary column (2fr) */}
        <div className="cmd__secondary">
          <OperatorPanel
            workforce={dayData.workforce}
            operatorsByArea={dayData.operatorsByArea}
            operatorCapacity={dayData.operatorCapacity}
            dayName={dayData.dayName}
          />

          <AlertsFeed />

          <AlertsPanel
            violations={dayData.violations}
            infeasibilities={dayData.infeasibilities}
            feasibilityScore={dayFeasibilityScore}
          />

          <ActiveDecisions
            decisions={dayData.systemDecisions}
            onNavigateToBlock={handleNavigateToBlock}
          />

          <WorkforceNeeds
            forecast={dayData.d1Forecast}
            operatorCapacity={dayData.operatorCapacity}
          />

          <D1Preparation
            forecast={dayData.d1Forecast}
            blocks={allBlocks}
            workforceConfig={engine.workforceConfig}
            workdays={engine.workdays}
          />
        </div>
      </div>
    </div>
  );
}
