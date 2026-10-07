/**
 * 岩茶工艺知识工具集（utils/tea.ts）
 * 只做纯函数换算与枚举映射：嫩度 / 火功 / 工序状态映射、温湿度与失水率区间判定、
 * 审评评分加权换算、拼配候选排序。不碰数据库、不碰 React。
 */
import { ALTITUDE_BANDS, type Cultivar, type Garden, type Soil } from '../types/garden';
import type { Batch, BatchState, Tenderness } from '../types/batch';
import type { Turn } from '../types/turn';
import type { FixLevel, RollPressure } from '../types/fix';
import {
  ROAST_STATES,
  type Charcoal,
  type FireLevel,
  type Roast,
  type RoastReminder,
  type RoastState,
} from '../types/roast';
import {
  BLEND_CANDIDATE_SCORE,
  REVIEW_SCORE_MAX,
  REVIEW_TOTAL_MAX,
  REVIEW_WEIGHTS,
  type BlendCandidate,
  type ProjectedCandidate,
  type Review,
  type ReviewScoreKey,
} from '../types/review';
import {
  DEFAULT_ROAST_BASELINE,
  DEFAULT_TURN_BASELINE,
  type BatchVerdict,
  type GardenStandard,
  type RoastBaseline,
  type TurnBaseline,
  type WaterVerdictLevel,
} from '../types/standard';

/* ------------------------------ 嫩度映射 ------------------------------ */

/** 嫩度 → 展示文案 */
export const TENDERNESS_LABEL: Record<Tenderness, string> = {
  一芽两叶: '一芽两叶（嫩采）',
  一芽三叶: '一芽三叶（常规）',
  开面采: '开面采（成熟）',
};

/** 嫩度 → 标签底色 */
export const TENDERNESS_COLOR: Record<Tenderness, string> = {
  一芽两叶: 'green',
  一芽三叶: 'cyan',
  开面采: 'gold',
};

/** 嫩度 → 做青建议 */
export const TENDERNESS_ADVICE: Record<Tenderness, string> = {
  一芽两叶: '嫩叶宜轻摇多次，缩短单次静置',
  一芽三叶: '常规摇青 3-4 轮，注意走水均匀',
  开面采: '成熟叶耐摇，可延长摇青并控温走水',
};

/* --------------------------- 工序状态映射 --------------------------- */

/** 工序状态 → 标签底色 */
export const BATCH_STATE_COLOR: Record<BatchState, string> = {
  做青中: 'processing',
  已杀青: 'cyan',
  已焙火: 'orange',
  已审评: 'green',
};

/** 揉捻压力 → 标签底色 */
export const ROLL_PRESSURE_COLOR: Record<RollPressure, string> = {
  轻: 'green',
  中: 'blue',
  重: 'volcano',
};

/** 焙火状态 → 标签底色 */
export const ROAST_STATE_COLOR: Record<RoastState, string> = {
  待焙: 'default',
  焙火中: 'processing',
  已足火: 'gold',
};

/** 炭种 → 标签底色 */
export const CHARCOAL_COLOR: Record<Charcoal, string> = {
  荔枝炭: 'volcano',
  龙眼炭: 'orange',
  机制炭: 'default',
};

/** 土壤 / 品种 → 标签底色（山场卡片复用） */
export const SOIL_COLOR: Record<Soil, string> = {
  砾壤: 'gold',
  红壤: 'volcano',
  沙壤: 'blue',
};

export const CULTIVAR_COLOR: Record<Cultivar, string> = {
  水仙: 'green',
  肉桂: 'magenta',
  名丛: 'purple',
};

/* --------------------------- 山场与批次文案 --------------------------- */

/** 海拔落点所属分段名称 */
export function altitudeBandLabel(altitudeM: number): string {
  const band = ALTITUDE_BANDS.find((item) => altitudeM >= item.minM && altitudeM <= item.maxM);
  return band ? band.label : '未标注海拔';
}

/** 批次展示名：山场·采摘日·嫩度 */
export function batchLabel(batch: Batch, gardenName?: string): string {
  const head = gardenName ? `${gardenName} · ` : '';
  return `${head}${batch.pickedAt} · ${batch.tenderness}`;
}

/** 数值四舍五入到指定小数位 */
export function roundTo(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 分钟 → 「x 小时 y 分钟」 */
export function minutesToReadable(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  if (hour <= 0) return `${minute} 分钟`;
  if (minute === 0) return `${hour} 小时`;
  return `${hour} 小时 ${minute} 分钟`;
}

/** 求平均分（无数据返回 null） */
export function averageScore(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const sum = scores.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
  return roundTo(sum / scores.length, 1);
}

/* ----------------------------- 区间判定 ----------------------------- */

/** 区间判定结果 */
export interface RangeVerdict {
  level: 'low' | 'ok' | 'high';
  label: string;
  hint: string;
}

/** 通用区间判定：低于下限 / 落在区间 / 高于上限 */
export function judgeRange(
  value: number,
  min: number,
  max: number,
  labels: { low: RangeVerdict; high: RangeVerdict; ok: RangeVerdict },
): RangeVerdict {
  if (value < min) return labels.low;
  if (value > max) return labels.high;
  return labels.ok;
}

/** 做青室温判定：按山场做青基准的室温区间（默认 20-26 ℃） */
export function judgeRoomTemp(tempC: number, baseline: TurnBaseline = DEFAULT_TURN_BASELINE): RangeVerdict {
  if (tempC < baseline.roomTempMinC) {
    return { level: 'low', label: '室温偏低', hint: '可关窗升温，摇青后静置时间适当缩短' };
  }
  if (tempC > baseline.roomTempMaxC) {
    return { level: 'high', label: '室温偏高', hint: '注意通风降温，防止红边过快' };
  }
  return { level: 'ok', label: '室温适宜', hint: `适宜做青走水（${baseline.roomTempMinC}-${baseline.roomTempMaxC} ℃）` };
}

/** 做青湿度判定：按山场做青基准的湿度区间（默认 60-80 %） */
export function judgeHumidity(humidityPct: number, baseline: TurnBaseline = DEFAULT_TURN_BASELINE): RangeVerdict {
  if (humidityPct < baseline.humidityMinPct) {
    return { level: 'low', label: '湿度偏低', hint: '地面洒水或缩短静置，避免失水过快' };
  }
  if (humidityPct > baseline.humidityMaxPct) {
    return { level: 'high', label: '湿度偏高', hint: '加强通风，延长静置走水时间' };
  }
  return { level: 'ok', label: '湿度适宜', hint: `适宜走水（${baseline.humidityMinPct}-${baseline.humidityMaxPct} %）` };
}

/** 失水率判定：按山场做青基准的全程失水区间（默认 12-20 %） */
export function judgeWaterLoss(waterLossPct: number, baseline: TurnBaseline = DEFAULT_TURN_BASELINE): RangeVerdict {
  if (waterLossPct < baseline.waterLossMinPct) {
    return { level: 'low', label: '失水不足', hint: '尚需补 1-2 轮摇青，继续走水' };
  }
  if (waterLossPct > baseline.waterLossMaxPct) {
    return { level: 'high', label: '失水偏多', hint: '及时杀青，避免叶张干脆' };
  }
  return {
    level: 'ok',
    label: '失水到位',
    hint: `可进入杀青工序（${baseline.waterLossMinPct}-${baseline.waterLossMaxPct} %）`,
  };
}

/** 失水率 → 三档结论（判定链与定稿冻结共用，避免重复文案） */
export function waterVerdictLevel(waterLossPct: number, baseline: TurnBaseline = DEFAULT_TURN_BASELINE): WaterVerdictLevel {
  if (waterLossPct < baseline.waterLossMinPct) return 'low';
  if (waterLossPct > baseline.waterLossMaxPct) return 'high';
  return 'ok';
}

/** 失水判定结论 → 中文短标签 */
export const WATER_VERDICT_LABEL: Record<WaterVerdictLevel, string> = {
  low: '失水不足',
  ok: '失水到位',
  high: '失水偏多',
};

/** 失水判定结论 → 标签底色 */
export const WATER_VERDICT_COLOR: Record<WaterVerdictLevel, string> = {
  low: 'blue',
  ok: 'green',
  high: 'orange',
};

/** 摇青时长判定：以山场基准的单轮摇青分钟为下沿（基准 +3 分钟内视为偏轻） */
export function judgeShakeMin(shakeMin: number, baseline: TurnBaseline = DEFAULT_TURN_BASELINE): RangeVerdict {
  if (shakeMin < baseline.shakeBaseMin) {
    return { level: 'low', label: '摇青偏轻', hint: '可增加 1-2 分钟摇青促进走水' };
  }
  if (shakeMin > 12) {
    return { level: 'high', label: '摇青偏重', hint: '注意叶缘红边程度，下一轮适当减时' };
  }
  return { level: 'ok', label: '摇青适宜', hint: `单轮不低于基准 ${baseline.shakeBaseMin} 分钟、12 分钟以内为宜` };
}

/** 杀青强度判定：锅温与时长综合 */
export function judgeFixLevel(wokTempC: number, fixMin: number, rollPressure: RollPressure): FixLevel {
  const heat = (wokTempC / 180) * (fixMin / 6);
  const pressureWeight = rollPressure === '重' ? 1.15 : rollPressure === '中' ? 1 : 0.9;
  const score = heat * pressureWeight;
  if (score < 0.85) return '偏轻';
  if (score > 1.25) return '偏重';
  return '适中';
}

/** 火功判定阈值：取内置焙火基准（向后兼容旧调用方） */
export const FIRE_THRESHOLDS = {
  medium: DEFAULT_ROAST_BASELINE.mediumLoad,
  full: DEFAULT_ROAST_BASELINE.fullLoad,
} as const;

/** 焙火累计热负荷（℃·h） */
export function fireLoadOf(roasts: Roast[]): number {
  return roundTo(
    roasts.reduce((acc, roast) => acc + (Number.isFinite(roast.tempC) ? roast.tempC : 0) * (Number.isFinite(roast.hours) ? roast.hours : 0), 0),
    1,
  );
}

/** 多道次焙火 → 火功档位（按山场焙火基准的累计热负荷阈值） */
export function fireLevelOf(roasts: Roast[], baseline: RoastBaseline = DEFAULT_ROAST_BASELINE): FireLevel {
  const load = fireLoadOf(roasts);
  if (load >= baseline.fullLoad) return '足火';
  if (load >= baseline.mediumLoad) return '中火';
  return '轻火';
}

/** 由累计热负荷直接判火功（定稿回放与判定链共用） */
export function fireLevelFromLoad(load: number, baseline: RoastBaseline = DEFAULT_ROAST_BASELINE): FireLevel {
  if (load >= baseline.fullLoad) return '足火';
  if (load >= baseline.mediumLoad) return '中火';
  return '轻火';
}

/** 火功 → 标签底色 */
export const FIRE_LEVEL_COLOR: Record<FireLevel, string> = {
  轻火: 'green',
  中火: 'orange',
  足火: 'volcano',
};

/** 火功 → 处理建议 */
export const FIRE_LEVEL_ADVICE: Record<FireLevel, string> = {
  轻火: '轻火风格，注意密封防潮，可在 1 个月内安排复焙',
  中火: '中火风格，建议间隔 20-30 天复焙一次，逐步吃火',
  足火: '已吃足火，进入退火期，静置 30 天以上再开汤审评',
};

/** 是否达到足火（按基准热负荷达标且道次数不少于基准下限） */
export function isFullFire(roasts: Roast[], baseline: RoastBaseline = DEFAULT_ROAST_BASELINE): boolean {
  return fireLoadOf(roasts) >= baseline.fullLoad && roasts.length >= baseline.fullMinPasses;
}

/** 批次当前焙火状态（无记录按「待焙」处理） */
export function currentRoastState(roasts: Roast[]): RoastState {
  if (roasts.length === 0) return '待焙';
  if (roasts.some((roast) => roast.state === '已足火')) return '已足火';
  if (roasts.some((roast) => roast.state === '焙火中')) return '焙火中';
  return ROAST_STATES[0];
}

/* ----------------------------- 复焙提醒 ----------------------------- */

/** 今天（本地时区）的 YYYY-MM-DD */
export function todayIso(): string {
  const date = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 目标日期距今天的天数差（正数=未来，负数=已过期） */
export function daysFromToday(dateIso: string, today = todayIso()): number {
  if (!dateIso) return Number.NaN;
  const target = new Date(`${dateIso}T00:00:00`);
  const base = new Date(`${today}T00:00:00`);
  if (Number.isNaN(target.getTime()) || Number.isNaN(base.getTime())) return Number.NaN;
  return Math.round((target.getTime() - base.getTime()) / 86400000);
}

/** 由复焙日期生成提醒（未填写日期返回 null） */
export function buildReminder(roast: Roast, today = todayIso()): RoastReminder | null {
  if (!roast.nextRoastDate) return null;
  const daysLeft = daysFromToday(roast.nextRoastDate, today);
  if (Number.isNaN(daysLeft)) return null;
  const level: RoastReminder['level'] =
    daysLeft < 0 ? 'overdue' : daysLeft === 0 ? 'today' : daysLeft <= 7 ? 'soon' : 'planned';
  return {
    roastId: roast.id,
    batchId: roast.batchId,
    passNo: roast.passNo,
    nextRoastDate: roast.nextRoastDate,
    daysLeft,
    level,
  };
}

/** 提醒级别 → 文案 */
export const REMINDER_LABEL: Record<RoastReminder['level'], string> = {
  overdue: '已逾期',
  today: '今日复焙',
  soon: '7 日内',
  planned: '已排期',
};

/** 提醒级别 → 标签底色 */
export const REMINDER_COLOR: Record<RoastReminder['level'], string> = {
  overdue: 'red',
  today: 'volcano',
  soon: 'orange',
  planned: 'blue',
};

/* ----------------------------- 审评换算 ----------------------------- */

/** 单项得分截断到 0-100 */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(REVIEW_SCORE_MAX, Math.max(0, value));
}

/** 分项加权换算总分（保留 1 位小数） */
export function weightedTotalScore(scores: Record<ReviewScoreKey, number>): number {
  const keys = Object.keys(REVIEW_WEIGHTS) as ReviewScoreKey[];
  const total = keys.reduce((acc, key) => acc + clampScore(scores[key]) * REVIEW_WEIGHTS[key], 0);
  return roundTo(Math.min(REVIEW_TOTAL_MAX, total), 1);
}

/** 总分档位文案 */
export function scoreGrade(score: number): string {
  if (score >= 92) return '特级';
  if (score >= 85) return '一级';
  if (score >= 75) return '二级';
  if (score >= 60) return '三级';
  return '等外';
}

/** 总分 → 标签底色 */
export function scoreColor(score: number): string {
  if (score >= 92) return 'volcano';
  if (score >= 85) return 'gold';
  if (score >= 75) return 'green';
  if (score >= 60) return 'cyan';
  return 'default';
}

/** 总分 → 星级（0-5） */
export function scoreStars(score: number): number {
  return Math.max(0, Math.min(5, Math.round(score / 20)));
}

/** 总分区间（审评页 / 拼配页下拉多选使用） */
export interface ScoreBand {
  key: string;
  label: string;
  minScore: number;
  maxScore: number;
}

export const SCORE_BANDS: ScoreBand[] = [
  { key: 'special', label: '特级（≥92 分）', minScore: 92, maxScore: 100 },
  { key: 'first', label: '一级（85-91.9 分）', minScore: 85, maxScore: 91.9 },
  { key: 'second', label: '二级（75-84.9 分）', minScore: 75, maxScore: 84.9 },
  { key: 'third', label: '三级（60-74.9 分）', minScore: 60, maxScore: 74.9 },
  { key: 'below', label: '等外（<60 分）', minScore: 0, maxScore: 59.9 },
];

/** 分数是否命中选中的区间集合（空集合表示不筛选） */
export function matchScoreBand(score: number, bandKeys: string[]): boolean {
  if (bandKeys.length === 0) return true;
  return bandKeys.some((key) => {
    const band = SCORE_BANDS.find((item) => item.key === key);
    return band ? score >= band.minScore && score <= band.maxScore : false;
  });
}

/* ----------------------------- 判定链 ----------------------------- */

/** 当前生效基准索引：gardenId → 当前山场基准（无则缺省） */
export function currentStandardMap(standards: GardenStandard[]): Map<string, GardenStandard> {
  const map = new Map<string, GardenStandard>();
  standards.forEach((standard) => {
    if (!standard.isCurrent) return;
    map.set(standard.gardenId, standard);
  });
  return map;
}

/**
 * 计算全部批次在判定链上的结论。
 * - 已定稿（审评记录带 frozen）：失水 / 火功 / 基准版本全部取冻结快照，保住当时判定；
 * - 未定稿：按所属山场当前基准实时算失水与火功，基准改版立即重算。
 */
export function buildBatchVerdicts(params: {
  batches: Batch[];
  turns: Turn[];
  roasts: Roast[];
  reviews: Review[];
  standards: GardenStandard[];
}): Map<string, BatchVerdict> {
  const { batches, turns, roasts, reviews, standards } = params;
  const currentMap = currentStandardMap(standards);
  const frozenByBatch = new Map<string, Review>();
  reviews.forEach((review) => {
    if (review.frozen && !frozenByBatch.has(review.batchId)) frozenByBatch.set(review.batchId, review);
  });
  const turnsByBatch = new Map<string, Turn[]>();
  turns.forEach((turn) => {
    turnsByBatch.set(turn.batchId, [...(turnsByBatch.get(turn.batchId) ?? []), turn]);
  });
  const roastsByBatch = new Map<string, Roast[]>();
  roasts.forEach((roast) => {
    roastsByBatch.set(roast.batchId, [...(roastsByBatch.get(roast.batchId) ?? []), roast]);
  });

  const result = new Map<string, BatchVerdict>();
  batches.forEach((batch) => {
    const current = currentMap.get(batch.gardenId);
    const frozenReview = frozenByBatch.get(batch.id);

    if (frozenReview?.frozen) {
      const frozen = frozenReview.frozen;
      result.set(batch.id, {
        batchId: batch.id,
        gardenId: batch.gardenId,
        standardRev: frozen.standardRev,
        finalized: true,
        hasStandard: true,
        turn: frozen.standard.turn,
        roast: frozen.standard.roast,
        waterLossPct: frozen.waterLossPct,
        waterVerdict: frozen.waterVerdict,
        fireLoad: frozen.fireLoad,
        fireLevel: frozen.fireLevel,
        roastPassCount: frozen.roastPassCount,
      });
      return;
    }

    const turnBaseline = current?.turn ?? DEFAULT_TURN_BASELINE;
    const roastBaseline = current?.roast ?? DEFAULT_ROAST_BASELINE;
    const branchTurns = turnsByBatch.get(batch.id) ?? [];
    const branchRoasts = roastsByBatch.get(batch.id) ?? [];
    const waterLossPct = finalWaterLoss(branchTurns);
    const fireLoad = fireLoadOf(branchRoasts);
    result.set(batch.id, {
      batchId: batch.id,
      gardenId: batch.gardenId,
      standardRev: current?.rev ?? 0,
      finalized: false,
      hasStandard: Boolean(current),
      turn: turnBaseline,
      roast: roastBaseline,
      waterLossPct,
      waterVerdict: waterVerdictLevel(waterLossPct, turnBaseline),
      fireLoad,
      fireLevel: fireLevelFromLoad(fireLoad, roastBaseline),
      roastPassCount: branchRoasts.length,
    });
  });
  return result;
}

/* ----------------------------- 拼配候选 ----------------------------- */

/** 按总分由高到低生成已定稿拼配候选清单（冻结结论，基准改版不改变其名次） */
export function buildBlendCandidates(reviews: Review[], batches: Batch[], gardens: Garden[]): BlendCandidate[] {
  const batchMap = new Map(batches.map((batch) => [batch.id, batch]));
  const gardenMap = new Map(gardens.map((garden) => [garden.id, garden]));
  return reviews
    .filter((review) => batchMap.has(review.batchId))
    .map((review) => {
      const batch = batchMap.get(review.batchId) as Batch;
      const garden = gardenMap.get(batch.gardenId);
      return {
        reviewId: review.id,
        batchId: review.batchId,
        batchLabel: batchLabel(batch, garden ? garden.name : undefined),
        gardenId: batch.gardenId,
        gardenName: garden ? garden.name : '未知山场',
        cultivar: garden ? garden.cultivar : '未标注',
        totalScore: review.totalScore,
        state: batch.state,
        pickedAt: batch.pickedAt,
        finalized: Boolean(review.frozen),
        standardRev: review.frozen?.standardRev ?? 0,
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * 待定稿候选的投影分：由当前基准 + 实际火功 / 失水推算（0-100，保留 1 位小数）。
 * 与审评总分同量纲，可与已定稿候选同榜比较；基准改版即重算，名次随之重排。
 */
export function projectedScoreOf(verdict: BatchVerdict): number {
  const loadRatio = verdict.roast.fullLoad > 0 ? Math.min(1, verdict.fireLoad / verdict.roast.fullLoad) : 0;
  let score = 72 + loadRatio * 18;
  if (verdict.fireLevel === '足火') score += 3;
  else if (verdict.fireLevel === '中火') score += 1;
  score += verdict.waterVerdict === 'ok' ? 4 : -3;
  return roundTo(Math.max(0, Math.min(100, score)), 1);
}

/**
 * 生成待定稿拼配候选：尚无审评、但火功已达「中火」且失水到位的批次。
 * 全部按当前基准实时推算投影分并由高到低排序 —— 基准一改版，这里立即重排。
 */
export function buildProjectedCandidates(
  verdicts: Map<string, BatchVerdict>,
  batches: Batch[],
  gardens: Garden[],
): ProjectedCandidate[] {
  const gardenMap = new Map(gardens.map((garden) => [garden.id, garden]));
  const list: ProjectedCandidate[] = [];
  batches.forEach((batch) => {
    const verdict = verdicts.get(batch.id);
    if (!verdict || verdict.finalized) return;
    if (verdict.roastPassCount === 0) return;
    if (!(verdict.fireLevel === '中火' || verdict.fireLevel === '足火')) return;
    if (verdict.waterVerdict !== 'ok') return;
    const garden = gardenMap.get(batch.gardenId);
    list.push({
      batchId: batch.id,
      batchLabel: batchLabel(batch, garden?.name),
      gardenId: batch.gardenId,
      gardenName: garden?.name ?? '未知山场',
      cultivar: garden?.cultivar ?? '未标注',
      state: batch.state,
      pickedAt: batch.pickedAt,
      standardRev: verdict.standardRev,
      waterLossPct: verdict.waterLossPct,
      waterVerdict: verdict.waterVerdict,
      fireLoad: verdict.fireLoad,
      fireLevel: verdict.fireLevel,
      roastPassCount: verdict.roastPassCount,
      projectedScore: projectedScoreOf(verdict),
    });
  });
  return list.sort((a, b) => b.projectedScore - a.projectedScore || b.fireLoad - a.fireLoad);
}

/** 是否达到拼配候选门槛（按审评总分，定稿候选） */
export function isBlendCandidate(score: number): boolean {
  return score >= BLEND_CANDIDATE_SCORE;
}

/** 拼配占比总和是否合法（允许 0.1 的浮点误差） */
export function isRatioValid(ratios: number[]): boolean {
  if (ratios.length === 0) return false;
  const sum = ratios.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
  return Math.abs(sum - 100) <= 0.1;
}

/* ----------------------------- 轮次统计 ----------------------------- */

/** 轮次合计：摇青 / 静置 / 总时长 */
export function sumTurnMinutes(turns: Turn[]): { shakeMin: number; restMin: number; totalMin: number } {
  const shakeMin = turns.reduce((acc, turn) => acc + (Number.isFinite(turn.shakeMin) ? turn.shakeMin : 0), 0);
  const restMin = turns.reduce((acc, turn) => acc + (Number.isFinite(turn.restMin) ? turn.restMin : 0), 0);
  return { shakeMin: roundTo(shakeMin, 1), restMin: roundTo(restMin, 1), totalMin: roundTo(shakeMin + restMin, 1) };
}

/** 取轮次末次的失水率（无轮次返回 0） */
export function finalWaterLoss(turns: Turn[]): number {
  if (turns.length === 0) return 0;
  const ordered = [...turns].sort((a, b) => a.roundNo - b.roundNo);
  return ordered[ordered.length - 1].waterLossPct;
}
