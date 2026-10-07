/**
 * 审评（Review）：毛茶分项打分与拼配去向
 * 香气 / 汤色 / 滋味 / 叶底四项打分，加权换算总分。
 */

import type { FrozenJudgment } from './standard';
import type { FireLevel } from './roast';

/** 分项打分维度键 */
export type ReviewScoreKey = 'aroma' | 'liquorColor' | 'taste' | 'leafBase';

/** 单项满分与总分满值 */
export const REVIEW_SCORE_MAX = 100;
export const REVIEW_TOTAL_MAX = 100;

/** 分项权重（香气 30% / 汤色 20% / 滋味 35% / 叶底 15%） */
export const REVIEW_WEIGHTS: Record<ReviewScoreKey, number> = {
  aroma: 0.3,
  liquorColor: 0.2,
  taste: 0.35,
  leafBase: 0.15,
};

/** 分项中文名 */
export const REVIEW_SCORE_LABEL: Record<ReviewScoreKey, string> = {
  aroma: '香气',
  liquorColor: '汤色',
  taste: '滋味',
  leafBase: '叶底',
};

/** 总分达到该值即进入拼配候选清单 */
export const BLEND_CANDIDATE_SCORE = 85;

/** 审评实体（持久化到 IndexedDB 的 reviews 表） */
export interface Review {
  id: string;
  /** 所属批次 id（batchId 外键） */
  batchId: string;
  /** 审评日期 YYYY-MM-DD */
  reviewedAt: string;
  /** 香气得分 */
  aroma: number;
  /** 汤色得分 */
  liquorColor: number;
  /** 滋味得分 */
  taste: number;
  /** 叶底得分 */
  leafBase: number;
  /** 加权总分 */
  totalScore: number;
  /** 拼配去向，例如「拼配方案 A · 40%」 */
  blendNote: string;
  /**
   * 定稿冻结的判定留痕：审评提交（定稿）时写入当时基准与失水 / 火功判定。
   * 基准后续改版时，该批次仍按这里的快照保住当时判定；null 表示历史记录尚未留痕。
   */
  frozen: FrozenJudgment | null;
  /** 乐观锁版本号：两个标签页同时提交同一条审评时，晚到一次被拒绝。 */
  rev: number;
  createdAt: string;
  updatedAt: string;
}

/** 新建 / 编辑审评表单草稿（总分由分项换算，不接受手工录入） */
export interface ReviewDraft {
  batchId: string;
  reviewedAt: string;
  aroma: number;
  liquorColor: number;
  taste: number;
  leafBase: number;
  blendNote: string;
}

/** 拼配候选项：按总分排序后的审评 + 批次信息 */
export interface BlendCandidate {
  reviewId: string;
  batchId: string;
  batchLabel: string;
  gardenId: string;
  gardenName: string;
  cultivar: string;
  totalScore: number;
  state: string;
  pickedAt: string;
  /** 是否已随审评定稿（结论已冻结，基准改版不影响其名次） */
  finalized: boolean;
  /** 结论采用的基准版本（定稿=冻结版本，未定稿=当前版本） */
  standardRev: number;
}

/**
 * 待定稿拼配候选：还没审评（未冻结）但火功已达基准的批次。
 * 其 projectedScore 完全由当前基准派生——基准一改版，名次立即重排。
 */
export interface ProjectedCandidate {
  batchId: string;
  batchLabel: string;
  gardenId: string;
  gardenName: string;
  cultivar: string;
  state: string;
  pickedAt: string;
  /** 采用的当前基准版本 */
  standardRev: number;
  /** 末轮累计失水率 % */
  waterLossPct: number;
  /** 失水判定（low/ok/high） */
  waterVerdict: import('./standard').WaterVerdictLevel;
  /** 焙火累计热负荷 ℃·h */
  fireLoad: number;
  /** 火功档位 */
  fireLevel: FireLevel;
  /** 焙火道次数 */
  roastPassCount: number;
  /** 由当前基准推算的拼配投影分（基准改版后重算并重排） */
  projectedScore: number;
}
