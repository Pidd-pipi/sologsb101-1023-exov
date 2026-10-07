/**
 * 工艺基准状态管理（Zustand）· standardStore.ts
 * 维护各山场基准的全部历史版本与当前生效版本、发布新版本（乐观锁）、
 * 以及「本次基准改动会影响哪些未定稿批次」的派生统计。
 * 基准只新增版本、不覆盖旧版本（留痕）；已定稿批次读冻结判定，与这里的发布动作解耦。
 */
import { create } from 'zustand';
import type { Batch } from '../types/batch';
import type { ProcessStandard, StandardDraft } from '../types/standard';
import {
  ConcurrencyConflictError,
  ensureStandardForGarden,
  listStandards,
  publishStandard as publishStandardRow,
} from '../utils/db';
import { clampStandardParams, standardParamsIssues } from '../utils/standard';

interface StandardStoreState {
  standards: ProcessStandard[];
  loading: boolean;
  error: string;
  loadStandards: () => Promise<void>;
  /** 发布新版本；表单参数不合法抛错，并发冲突抛 ConcurrencyConflictError */
  publishStandard: (draft: StandardDraft, expectedRev: number) => Promise<ProcessStandard>;
  /** 给新山场补 v1（幂等） */
  ensureForGarden: (gardenId: string, createdBy?: string) => Promise<ProcessStandard>;
}

export const useStandardStore = create<StandardStoreState>((set, get) => ({
  standards: [],
  loading: false,
  error: '',

  async loadStandards() {
    set({ loading: true, error: '' });
    try {
      const standards = await listStandards();
      set({ standards, loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '工艺基准读取失败' });
    }
  },

  async publishStandard(draft, expectedRev) {
    const params = clampStandardParams(draft);
    const issues = standardParamsIssues(params);
    if (issues.length > 0) throw new Error(issues.join('；'));
    try {
      const published = await publishStandardRow({ ...draft, ...params }, expectedRev);
      await get().loadStandards();
      return published;
    } catch (error) {
      if (error instanceof ConcurrencyConflictError) throw error;
      throw error instanceof Error ? error : new Error('工艺基准发布失败');
    }
  },

  async ensureForGarden(gardenId, createdBy) {
    const standard = await ensureStandardForGarden(gardenId, createdBy);
    await get().loadStandards();
    return standard;
  },
}));

/** 某山场的当前生效基准（无则 undefined） */
export function activeStandardOf(
  standards: ProcessStandard[],
  gardenId: string,
): ProcessStandard | undefined {
  return standards
    .filter((row) => row.gardenId === gardenId && row.active)
    .sort((a, b) => b.versionNo - a.versionNo)[0];
}

/** 某山场基准历史版本（新版本在前） */
export function standardHistoryOf(standards: ProcessStandard[], gardenId: string): ProcessStandard[] {
  return standards
    .filter((row) => row.gardenId === gardenId)
    .sort((a, b) => b.versionNo - a.versionNo);
}

/** 基准发布后的影响面：未定稿批次将按新基准重算，已定稿批次不动 */
export function standardImpact(
  batches: Batch[],
  gardenId: string,
): { affectedBatchIds: string[]; frozenBatchIds: string[] } {
  const sameGarden = batches.filter((batch) => batch.gardenId === gardenId);
  return {
    affectedBatchIds: sameGarden.filter((batch) => batch.state !== '已审评').map((batch) => batch.id),
    frozenBatchIds: sameGarden.filter((batch) => batch.state === '已审评').map((batch) => batch.id),
  };
}

export default useStandardStore;
