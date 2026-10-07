/**
 * useJudgmentChain()
 * 判定链响应式派生：基准 → 做青失水 → 焙火火功 → 审评结论。
 * 用 Dexie liveQuery 同时订阅 batches / turns / roasts / reviews / standards，
 * 任何一张表变化（含另一个标签页的写入）都会重算：
 * - 未定稿批次按所属山场「当前」基准实时重算失水与火功；
 * - 已定稿批次取审评记录的冻结快照，基准改版也保住当时判定。
 */
import { useEffect, useState } from 'react';
import { liveQuery, type Subscription } from 'dexie';
import { db } from '../utils/db';
import type { Batch } from '../types/batch';
import type { Turn } from '../types/turn';
import type { Roast } from '../types/roast';
import type { Review } from '../types/review';
import type { BatchVerdict, GardenStandard } from '../types/standard';
import { buildBatchVerdicts } from '../utils/tea';

export interface JudgmentChainResult {
  verdicts: Map<string, BatchVerdict>;
  standards: GardenStandard[];
  loading: boolean;
  error: string;
}

interface ChainData {
  batches: Batch[];
  turns: Turn[];
  roasts: Roast[];
  reviews: Review[];
  standards: GardenStandard[];
}

export function useJudgmentChain(): JudgmentChainResult {
  const [data, setData] = useState<ChainData>({
    batches: [],
    turns: [],
    roasts: [],
    reviews: [],
    standards: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const querier = () =>
      Promise.all([
        db.batches.toArray(),
        db.turns.toArray(),
        db.roasts.toArray(),
        db.reviews.toArray(),
        db.standards.toArray(),
      ]).then(([batches, turns, roasts, reviews, standards]) => ({
        batches,
        turns,
        roasts,
        reviews,
        standards,
      }));
    const subscription: Subscription = liveQuery(querier).subscribe({
      next: (value) => {
        if (!active) return;
        setData(value);
        setError('');
        setLoading(false);
      },
      error: (err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : '判定链读取失败');
        setLoading(false);
      },
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const verdicts = buildBatchVerdicts(data);

  return { verdicts, standards: data.standards, loading, error };
}

export default useJudgmentChain;
