import { C } from '../../../lib/engine';
import { useScheduleEngine } from '../hooks/useScheduleEngine';
import { GanttSplitPane } from './GanttChart/GanttSplitPane';
import { ReplanView } from './ReplanPanel';
import { PlanView } from './ScheduleKPIs';
import { SchedulingBanners } from './SchedulingBanners';
import { SchedulingHeader } from './SchedulingHeader';
import { WhatIfView } from './WhatIfPanel';
import '../../planning/NikufraEngine.css';

export function SchedulingPage() {
  const eng = useScheduleEngine();

  if (eng.loading)
    return (
      <div className="ne-shell ne-loading">
        <div className="ne-loading__spinner" />
        <div className="ne-loading__text">A carregar planning engine...</div>
      </div>
    );
  if (eng.error || !eng.engineData)
    return (
      <div className="ne-shell ne-error">
        <div className="ne-error__icon" style={{ color: C.rd }}>
          ERROR
        </div>
        <div className="ne-error__msg">{eng.error || 'Engine indisponível'}</div>
        <button className="ne-error__retry" onClick={eng.loadData}>
          Tentar novamente
        </button>
      </div>
    );

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans','Inter',system-ui,sans-serif", color: C.t1 }}>
      <SchedulingHeader
        view={eng.view}
        setView={eng.setView}
        downC={eng.downC}
        movesCount={eng.moves.length}
        autoMovesCount={eng.autoMoves.length}
        blkOps={eng.blkOps}
        opsCount={eng.allOps.length}
        machineCount={eng.engineData.machines.length}
        validation={eng.validation}
      />
      <div style={{ padding: '16px 20px', maxWidth: 1320, margin: '0 auto' }}>
        <p className="page-desc" style={{ marginBottom: 12 }}>
          Motor de escalonamento: Gantt visual, replan manual e optimização automática.
        </p>
        <SchedulingBanners
          isopBanner={eng.isopBanner}
          setIsopBanner={eng.setIsopBanner}
          isScheduling={eng.isScheduling}
        />
        {eng.view === 'plan' && (
          <PlanView
            blocks={eng.blocks}
            cap={eng.cap}
            mSt={eng.mSt}
            data={eng.engineData}
            audit={eng.audit}
            decisions={eng.schedDecisions}
            feasibility={eng.feasibility}
            onRunAutoReplan={eng.handlePlanAutoReplan}
            onSwitchToReplan={() => eng.setView('replan')}
          />
        )}
        {eng.view === 'gantt' && (
          <GanttSplitPane
            blocks={eng.blocks}
            mSt={eng.mSt}
            cap={eng.cap}
            data={eng.engineData}
            applyMove={eng.applyMove}
            undoMove={eng.undoMove}
            validation={eng.validation}
            allOps={eng.allOps}
            neMetrics={eng.neMetrics}
          />
        )}
        {eng.view === 'replan' && (
          <ReplanView
            mSt={eng.mSt}
            tSt={eng.tSt}
            toggleM={eng.toggleM}
            toggleT={eng.toggleT}
            moves={eng.moves}
            applyMove={eng.applyMove}
            undoMove={eng.undoMove}
            blocks={eng.blocks}
            cap={eng.cap}
            data={eng.engineData}
            onApplyAndSave={() => eng.handleApplyAndSave()}
            isSaving={eng.isSaving}
            setResourceDown={eng.setResourceDown}
            clearResourceDown={eng.clearResourceDown}
            getResourceDownDays={eng.getResourceDownDays}
            replanTimelines={eng.replanTimelines}
            rushOrders={eng.rushOrders}
            setRushOrders={eng.setRushOrders}
            allOps={eng.allOps}
            neMetrics={eng.neMetrics}
          />
        )}
        {eng.view === 'whatif' && (
          <WhatIfView
            data={eng.engineData}
            onApplyMoves={(mvs, sc) => eng.handleApplyAndSave(mvs, sc)}
            isSaving={eng.isSaving}
            setResourceDown={eng.setResourceDown}
            clearResourceDown={eng.clearResourceDown}
            getResourceDownDays={eng.getResourceDownDays}
            replanTimelines={eng.replanTimelines}
            blocks={eng.blocks}
            allOps={eng.allOps}
            neMetrics={eng.neMetrics}
          />
        )}
      </div>
    </div>
  );
}
