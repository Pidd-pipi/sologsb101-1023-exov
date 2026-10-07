/**
 * 山场做青 / 焙火基准状态管理（Zustand）· standardStore.ts
 * 维护各山场基准的当前版本与历史留痕，负责改版发布（旧版本冻结、追加新版本）。
 * 基准改版后不改写未定稿批次：失水 / 火功由判定链按当前基准实时派生重算；
 * 已定稿批次的结论冻结在审评记录上，基准改版不影响。
 */
import { create } from 'zustand';
import type { GardenStandard, StandardDraft } from '../types/standard';
import {
  ensureStandardForGarden,
  listStandards,
  publishStandard as publishStandardRow,
} from '../utils/db';

interface StandardStoreState {
  /** 全部基准（含历史留痕） */
  standards: GardenStandard[];
  loading: boolean;
  error: string;
  loadStandards: () => Promise<void>;
  /** 改版发布：旧当前版本转为历史，追加一条 rev+1 的新当前版本 */
  publishStandard: (gardenId: string, draft: StandardDraft) => Promise<GardenStandard>;
  /** 新建山场后确保其有首版基准 */
  ensureForGarden: (gardenId: string) => Promise<GardenStandard>;
}

export const useStandardStore = create<StandardStoreState>((set) => ({
  standards: [],
  loading: false,
  error: '',

  async loadStandards() {
    set({ loading: true, error: '' });
    try {
      set({ standards: await listStandards(), loading: false });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : '山场基准读取失败' });
    }
  },

  async publishStandard(gardenId, draft) {
    const next = await publishStandardRow(gardenId, draft);
    set({ standards: await listStandards() });
    return next;
  },

  async ensureForGarden(gardenId) {
    const row = await ensureStandardForGarden(gardenId);
    set({ standards: await listStandards() });
    return row;
  },
}));

/** 选择器：某山场当前生效基准 */
export function selectCurrentStandard(standards: GardenStandard[], gardenId: string | null | undefined): GardenStandard | undefined {
  if (!gardenId) return undefined;
  return standards.find((row) => row.gardenId === gardenId && row.isCurrent);
}

/** 选择器：某山场历史版本（新版本在前，含当前版本） */
export function selectStandardHistory(standards: GardenStandard[], gardenId: string | null | undefined): GardenStandard[] {
  if (!gardenId) return [];
  return standards
    .filter((row) => row.gardenId === gardenId)
    .sort((a, b) => b.rev - a.rev);
}

export default useStandardStore;
