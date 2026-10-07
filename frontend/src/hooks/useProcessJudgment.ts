/**
 * useProcessJudgment()
 * 订阅全部批次的「工艺判定链」：基准（版本留痕）→ 做青记录 → 焙火道次 → 失水 / 火功判定。
 * - 未定稿批次：始终用山场当前生效基准实时复算，基准一改动判定立即变；
 * - 已定稿批次：直接回读批次上的 frozenJudgment，保住定稿当时的判定。
 * 被做青页、焙火页、审评页、拼配页与山场台账共同消费。
 */
import { useEffect, useMemo, useState } from 'react';
import { liveQuery, type Subscription } from 'dexie';
import { db } from '../utils/db';
import type { Batch } from '../types/batch';
import type { Turn } from '../types/turn';
import type { Roast } from '../types/roast';
import type { ProcessStandard, ProcessJudgment } from '../types/standard';
import { buildProcessJudgment } from '../utils/standard';

export interface ProcessJudgmentState {
  /** key = batchId 的判定映射（定稿取冻结值，未定稿按当前基准复算） */
  byBatch: Record<string, ProcessJudgment>;
  /** key = gardenId 的当前生效基准 */
  activeByGarden: Record<string, ProcessStandard>;
  loading: boolean;
}

function useTableLiveQuery<T>(querier: () => Promise<T[]>): T[] | undefined {
  const [value, setValue] = useState<T[] | undefined>(undefined);
  useEffect(() => {
    const subscription: Subscription = liveQuery(querier).subscribe({
      next: setValue,
      error: () => setValue(undefined),
    });
    return () => subscription.unsubscribe();
  }, [querier]);
  return value;
}

/** 引用稳定的查询函数（依赖仅 db 单例） */
const queriers = {
  batches: () => db.batches.toArray(),
  turns: () => db.turns.toArray(),
  roasts: () => db.roasts.toArray(),
  standards: () => db.standards.toArray(),
};

function groupByBatch<T extends { batchId: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  rows.forEach((row) => {
    map.set(row.batchId, [...(map.get(row.batchId) ?? []), row]);
  });
  return map;
}

/** 计算单条判定（供页面在非 hook 场景复用同样的定稿 / 复算规则） */
export function resolveJudgment(
  batch: Batch,
  turns: Turn[],
  roasts: Roast[],
  activeStandard: ProcessStandard | null,
): ProcessJudgment {
  if (batch.state === '已审评' && batch.frozenJudgment) {
    return batch.frozenJudgment;
  }
  return buildProcessJudgment({ standard: activeStandard, turns, roasts });
}

export function useProcessJudgment(): ProcessJudgmentState {
  const batches = useTableLiveQuery<Batch>(queriers.batches);
  const turns = useTableLiveQuery<Turn>(queriers.turns);
  const roasts = useTableLiveQuery<Roast>(queriers.roasts);
  const standards = useTableLiveQuery<ProcessStandard>(queriers.standards);

  return useMemo(() => {
    const activeByGarden: Record<string, ProcessStandard> = {};
    (standards ?? [])
      .filter((row) => row.active)
      .forEach((row) => {
        const current = activeByGarden[row.gardenId];
        if (!current || row.versionNo > current.versionNo) activeByGarden[row.gardenId] = row;
      });

    const turnsByBatch = groupByBatch(turns ?? []);
    const roastsByBatch = groupByBatch(roasts ?? []);

    const byBatch: Record<string, ProcessJudgment> = {};
    (batches ?? []).forEach((batch) => {
      if (batch.state === '已审评' && batch.frozenJudgment) {
        byBatch[batch.id] = batch.frozenJudgment;
        return;
      }
      byBatch[batch.id] = buildProcessJudgment({
        standard: activeByGarden[batch.gardenId] ?? null,
        turns: turnsByBatch.get(batch.id) ?? [],
        roasts: roastsByBatch.get(batch.id) ?? [],
      });
    });

    return {
      byBatch,
      activeByGarden,
      loading: batches === undefined || turns === undefined || roasts === undefined || standards === undefined,
    };
  }, [batches, turns, roasts, standards]);
}

export default useProcessJudgment;
