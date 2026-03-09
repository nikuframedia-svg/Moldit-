// useScheduleData — shared hook for schedule KPIs across all pages
// Module-level cache: computes once, shared across all consumers
// Reacts to useDataStore changes (ISOP upload) via dataVersion counter

import { useEffect, useMemo, useState } from 'react';
import type {
  AdvanceAction,
  Block,
  CoverageAuditResult,
  DayLoad,
  DecisionEntry,
  EngineData,
  FeasibilityReport,
  MoveAction,
  MRPResult,
  ScheduleValidationReport,
  TransparencyReport,
} from '../lib/engine';
import {
  auditCoverage,
  capAnalysis,
  DEFAULT_WORKFORCE_CONFIG,
  scoreSchedule,
  validateSchedule,
} from '../lib/engine';
import type { CacheEntry, DataSourceLike } from '../lib/schedule-pipeline';
import { runSchedulePipeline } from '../lib/schedule-pipeline';
import { getTransformConfig, settingsHashSelector } from '../stores/settings-config';
import { useDataStore } from '../stores/useDataStore';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useDataSource } from './useDataSource';

export interface ScheduleData {
  engine: EngineData | null;
  blocks: Block[];
  autoMoves: MoveAction[];
  autoAdvances: AdvanceAction[];
  decisions: DecisionEntry[];
  feasibilityReport: FeasibilityReport | null;
  transparencyReport: TransparencyReport | null;
  cap: Record<string, DayLoad[]>;
  metrics: ReturnType<typeof scoreSchedule> | null;
  validation: ScheduleValidationReport | null;
  coverageAudit: CoverageAuditResult | null;
  mrp: MRPResult | null;
  loading: boolean;
  error: string | null;
}

// Module-level cache
let cached: CacheEntry | null = null;
let cachePromise: Promise<void> | null = null;
let cachedDataVersion: string | null = null;
let cacheVersion = 0;

export function useScheduleData(): ScheduleData {
  const ds = useDataSource();
  const dataVersion = useDataStore((s) => s.loadedAt);
  const isMerging = useDataStore((s) => s.isMerging);
  const settingsHash = useSettingsStore(settingsHashSelector);

  const [engine, setEngine] = useState<EngineData | null>(cached?.engine ?? null);
  const [blocks, setBlocks] = useState<Block[]>(cached?.blocks ?? []);
  const [autoMoves, setAutoMoves] = useState<MoveAction[]>(cached?.autoMoves ?? []);
  const [autoAdvances, setAutoAdvances] = useState<AdvanceAction[]>(cached?.autoAdvances ?? []);
  const [decisions, setDecisions] = useState<DecisionEntry[]>(cached?.decisions ?? []);
  const [feasibilityReport, setFeasibilityReport] = useState<FeasibilityReport | null>(
    cached?.feasibilityReport ?? null,
  );
  const [transparencyReport, setTransparencyReport] = useState<TransparencyReport | null>(
    cached?.transparencyReport ?? null,
  );
  const [mrpData, setMrpData] = useState<MRPResult | null>(cached?.mrp ?? null);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isMerging) {
      setLoading(true);
      return;
    }

    if (dataVersion !== cachedDataVersion) {
      cached = null;
      cachePromise = null;
      cachedDataVersion = dataVersion;
      cacheVersion++;
    }

    const applyCache = () => {
      if (!cached) return;
      setEngine(cached.engine);
      setBlocks(cached.blocks);
      setAutoMoves(cached.autoMoves);
      setAutoAdvances(cached.autoAdvances);
      setDecisions(cached.decisions);
      setFeasibilityReport(cached.feasibilityReport);
      setTransparencyReport(cached.transparencyReport);
      setMrpData(cached.mrp);
    };

    if (cached) {
      applyCache();
      setLoading(false);
      return;
    }
    if (cachePromise) {
      cachePromise.then(() => {
        applyCache();
        setLoading(false);
      });
      return;
    }

    setLoading(true);
    setError(null);
    const computeVersion = cacheVersion;

    if (!ds?.getPlanState) {
      setError('Data source unavailable — getPlanState not found');
      setLoading(false);
      return;
    }

    cachePromise = runSchedulePipeline(ds as DataSourceLike, getTransformConfig()).then((entry) => {
      if (computeVersion === cacheVersion) cached = entry;
    });

    cachePromise
      .then(() => {
        if (computeVersion !== cacheVersion) return;
        applyCache();
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Failed to load schedule data');
        setEngine(null);
        setBlocks([]);
        setAutoMoves([]);
        setAutoAdvances([]);
        setDecisions([]);
        setFeasibilityReport(null);
        setTransparencyReport(null);
        setMrpData(null);
      })
      .finally(() => setLoading(false));
  }, [ds, dataVersion, settingsHash, isMerging]);

  const cap = useMemo(
    () => (engine ? capAnalysis(blocks, engine.machines, engine.nDays) : {}),
    [blocks, engine],
  );

  const metrics = useMemo(() => {
    if (!engine || blocks.length === 0) return null;
    const wfc = engine.workforceConfig ?? DEFAULT_WORKFORCE_CONFIG;
    return scoreSchedule(
      blocks,
      engine.ops,
      engine.mSt,
      wfc,
      engine.machines,
      engine.toolMap,
      undefined,
      undefined,
      engine.nDays,
    );
  }, [blocks, engine]);

  const validation = useMemo(() => {
    if (!engine || blocks.length === 0) return null;
    return validateSchedule(
      blocks,
      engine.machines,
      engine.toolMap,
      engine.ops,
      engine.thirdShift,
      engine.nDays,
    );
  }, [blocks, engine]);

  const coverageAudit = useMemo(() => {
    if (!engine || blocks.length === 0) return null;
    return auditCoverage(blocks, engine.ops, engine.toolMap, engine.twinGroups);
  }, [blocks, engine]);

  return {
    engine,
    blocks,
    autoMoves,
    autoAdvances,
    decisions,
    feasibilityReport,
    transparencyReport,
    cap,
    metrics,
    validation,
    coverageAudit,
    mrp: mrpData,
    loading,
    error,
  };
}

// Allow external code to invalidate cache when replan happens
export function invalidateScheduleCache(): void {
  cached = null;
  cachePromise = null;
  cacheVersion++;
}
