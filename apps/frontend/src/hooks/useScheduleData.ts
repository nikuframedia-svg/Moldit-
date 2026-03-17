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
  LateDeliveryAnalysis,
  MoveAction,
  MRPResult,
  ScheduleValidationReport,
  TransparencyReport,
} from '../lib/engine';
import {
  analyzeLateDeliveries,
  auditCoverage,
  capAnalysis,
  DEFAULT_WORKFORCE_CONFIG,
  scoreSchedule,
  validateSchedule,
} from '../lib/engine';
import type { CacheEntry, DataSourceLike } from '../lib/schedule-pipeline';
import { runSchedulePipeline } from '../lib/schedule-pipeline';
import { getTransformConfig, settingsHashSelector } from '../stores/settings-config';
import { useBanditStore } from '../stores/useBanditStore';
import { useDataStore } from '../stores/useDataStore';
import { overridesVersionSelector, useMasterDataStore } from '../stores/useMasterDataStore';
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
  thirdShiftRecommended: boolean;
  cap: Record<string, DayLoad[]>;
  metrics: ReturnType<typeof scoreSchedule> | null;
  validation: ScheduleValidationReport | null;
  coverageAudit: CoverageAuditResult | null;
  lateDeliveries: LateDeliveryAnalysis | null;
  mrp: MRPResult | null;
  loading: boolean;
  error: string | null;
}

// Module-level cache
let cached: CacheEntry | null = null;
let cachePromise: Promise<void> | null = null;
let cachedDataVersion: string | null = null;
let cachedOverridesVersion: number | null = null;
let cachedSettingsHash: string | null = null;
let cacheVersion = 0;

export function useScheduleData(): ScheduleData {
  // Listen for external cache invalidation (e.g. copilot recalculation)
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const handler = () => forceUpdate((v) => v + 1);
    window.addEventListener('schedule-invalidate', handler);
    return () => window.removeEventListener('schedule-invalidate', handler);
  }, []);
  const ds = useDataSource();
  const dataVersion = useDataStore((s) => s.loadedAt);
  const isMerging = useDataStore((s) => s.isMerging);
  const hasHydrated = useDataStore((s) => s._hasHydrated);
  const settingsHash = useSettingsStore(settingsHashSelector);
  const overridesVersion = useMasterDataStore(overridesVersionSelector);

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
  const [thirdShiftRecommended, setThirdShiftRecommended] = useState(
    cached?.thirdShiftRecommended ?? false,
  );
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for Zustand persist to hydrate from localStorage before running pipeline
    if (!hasHydrated) {
      setLoading(true);
      return;
    }

    if (isMerging) {
      setLoading(true);
      return;
    }

    if (
      dataVersion !== cachedDataVersion ||
      overridesVersion !== cachedOverridesVersion ||
      settingsHash !== cachedSettingsHash
    ) {
      cached = null;
      cachePromise = null;
      cachedDataVersion = dataVersion;
      cachedOverridesVersion = overridesVersion;
      cachedSettingsHash = settingsHash;
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
      setThirdShiftRecommended(cached.thirdShiftRecommended);
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

      // UCB1 learning feedback: process previous snapshot, then snapshot current
      try {
        const wfc = entry.engine.workforceConfig ?? DEFAULT_WORKFORCE_CONFIG;
        const score = scoreSchedule(
          entry.blocks,
          entry.engine.ops,
          entry.engine.mSt,
          wfc,
          entry.engine.machines,
          entry.engine.toolMap,
          undefined,
          undefined,
          entry.engine.nDays,
        );
        const banditActions = useBanditStore.getState().actions;
        banditActions.processLearning({
          otd: score.otd,
          otdDelivery: score.otdDelivery,
          tardinessDays: score.tardinessDays,
        });
        banditActions.snapshotCurrentPlan(entry.resolvedDispatchRule, {
          otd: score.otd,
          otdDelivery: score.otdDelivery,
          tardinessDays: score.tardinessDays,
        });
      } catch {
        // Non-critical: don't break scheduling if bandit update fails
      }
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
        setThirdShiftRecommended(false);
        setMrpData(null);
      })
      .finally(() => setLoading(false));
  }, [ds, dataVersion, settingsHash, isMerging, overridesVersion, hasHydrated]);

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

  const clientTiers = useSettingsStore((s) => s.clientTiers);
  const lateDeliveries = useMemo(() => {
    if (!engine || blocks.length === 0) return null;
    return analyzeLateDeliveries(blocks, engine.ops, engine.dates, clientTiers);
  }, [blocks, engine, clientTiers]);

  return {
    engine,
    blocks,
    autoMoves,
    autoAdvances,
    decisions,
    feasibilityReport,
    transparencyReport,
    thirdShiftRecommended,
    cap,
    metrics,
    validation,
    coverageAudit,
    lateDeliveries,
    mrp: mrpData,
    loading,
    error,
  };
}

// Allow external code to invalidate cache when replan happens
export function invalidateScheduleCache(): void {
  // Dispatch event so useScheduleData re-renders
  window.dispatchEvent(new Event('schedule-invalidate'));
  cached = null;
  cachePromise = null;
  cacheVersion++;
}
