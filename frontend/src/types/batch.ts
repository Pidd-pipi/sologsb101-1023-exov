/**
 * 茶青批次（Batch）：一次采摘的鲜叶，按工序推进状态
 * 状态流转：做青中 → 已杀青 → 已焙火 → 已审评
 */

import type { ProcessJudgment } from './standard';

/** 嫩度枚举 */
export const TENDERNESS_OPTIONS = ['一芽两叶', '一芽三叶', '开面采'] as const;
export type Tenderness = (typeof TENDERNESS_OPTIONS)[number];

/** 工序状态枚举（数组顺序即流转顺序） */
export const BATCH_STATES = ['做青中', '已杀青', '已焙火', '已审评'] as const;
export type BatchState = (typeof BATCH_STATES)[number];

/** 茶青批次实体（持久化到 IndexedDB 的 batches 表） */
export interface Batch {
  id: string;
  /** 所属山场 id（gardenId 外键） */
  gardenId: string;
  /** 采摘日期 YYYY-MM-DD */
  pickedAt: string;
  /** 鲜叶重量（公斤） */
  freshLeafKg: number;
  /** 嫩度 */
  tenderness: Tenderness;
  /** 气象备注，例如「晴，北风 2 级」 */
  weather: string;
  /** 工序状态 */
  state: BatchState;
  /** 定稿时锁定的山场基准版本号；未定稿为 null（始终跟随山场当前基准重算） */
  standardVersionNo: number | null;
  /** 定稿时间（进入「已审评」时记录），未定稿为 null */
  finalizedAt: string | null;
  /** 定稿时按当时基准冻结的工艺判定（失水 / 火功 / 贴合度），基准再改也不重算 */
  frozenJudgment: ProcessJudgment | null;
  /** 做青记录乐观锁：两个标签页同时提交时，晚到者版本号不匹配被拒 */
  turnsRev: number;
  /** 焙火道次乐观锁，语义同 turnsRev */
  roastsRev: number;
  createdAt: string;
  updatedAt: string;
}

/** 新建 / 编辑批次表单草稿 */
export interface BatchDraft {
  gardenId: string;
  pickedAt: string;
  freshLeafKg: number;
  tenderness: Tenderness;
  weather: string;
  state: BatchState;
}

/** 批次状态计数，用于统计徽标 */
export type BatchStateCounts = Record<BatchState, number>;

/** 下一道工序状态；已审评时返回 null（流程已到终点） */
export function nextBatchState(state: BatchState): BatchState | null {
  const index = BATCH_STATES.indexOf(state);
  if (index < 0 || index >= BATCH_STATES.length - 1) return null;
  return BATCH_STATES[index + 1];
}

/** 工序状态序号，便于比较推进程度 */
export function batchStateOrder(state: BatchState): number {
  return BATCH_STATES.indexOf(state);
}
