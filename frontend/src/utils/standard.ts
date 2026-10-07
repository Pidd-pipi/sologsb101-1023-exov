/**
 * 工艺基准判定工具集（utils/standard.ts）
 * 纯函数：区间判定、火功换算、工艺贴合度、批次判定链组装。
 * 与 utils/tea.ts 的固定阈值判定并存：本模块所有阈值都来自基准参数，
 * 基准一改动，未定稿批次经这里算出的失水 / 火功判定立即随之变化；已定稿批次直接读冻结判定，不再走这里。
 */
import type { ProcessStandard, ProcessJudgment, StandardParams } from '../types/standard';
import { DEFAULT_STANDARD_PARAMS, STANDARD_LIMITS } from '../types/standard';
import type { Roast } from '../types/roast';
import type { Turn } from '../types/turn';
import { fireLoadOf, roundTo, type RangeVerdict } from './tea';

/* ------------------------------ 基准兜底 ------------------------------ */

/** 无生效基准时的兜底基准（理论上每个山场都有 v1，防御性使用） */
export const FALLBACK_STANDARD_PARAMS: StandardParams = { ...DEFAULT_STANDARD_PARAMS };

/** 数值截断到合法区间 */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 把一组基准参数截断到合法区间（表单保存前使用） */
export function clampStandardParams(params: Partial<StandardParams>): StandardParams {
  const merged: StandardParams = { ...DEFAULT_STANDARD_PARAMS, ...params };
  const limits = STANDARD_LIMITS;
  return {
    turnRoomTempMin: clamp(merged.turnRoomTempMin, limits.turnRoomTempMin.min, limits.turnRoomTempMin.max),
    turnRoomTempMax: clamp(merged.turnRoomTempMax, limits.turnRoomTempMax.min, limits.turnRoomTempMax.max),
    turnHumidityMin: clamp(merged.turnHumidityMin, limits.turnHumidityMin.min, limits.turnHumidityMin.max),
    turnHumidityMax: clamp(merged.turnHumidityMax, limits.turnHumidityMax.min, limits.turnHumidityMax.max),
    waterLossMinPct: clamp(merged.waterLossMinPct, limits.waterLossMinPct.min, limits.waterLossMinPct.max),
    waterLossMaxPct: clamp(merged.waterLossMaxPct, limits.waterLossMaxPct.min, limits.waterLossMaxPct.max),
    shakeMinMin: clamp(merged.shakeMinMin, limits.shakeMinMin.min, limits.shakeMinMin.max),
    shakeMinMax: clamp(merged.shakeMinMax, limits.shakeMinMax.min, limits.shakeMinMax.max),
    fireMediumLoad: clamp(merged.fireMediumLoad, limits.fireMediumLoad.min, limits.fireMediumLoad.max),
    fireFullLoad: clamp(merged.fireFullLoad, limits.fireFullLoad.min, limits.fireFullLoad.max),
    fullFirePassesMin: Math.round(clamp(merged.fullFirePassesMin, limits.fullFirePassesMin.min, limits.fullFirePassesMin.max)),
  };
}

/** 基准参数自身是否自洽（下限不高于上限、中火阈值不高于足火阈值） */
export function standardParamsIssues(params: StandardParams): string[] {
  const issues: string[] = [];
  if (params.turnRoomTempMin > params.turnRoomTempMax) issues.push('做青室温下限不能高于上限');
  if (params.turnHumidityMin > params.turnHumidityMax) issues.push('做青湿度下限不能高于上限');
  if (params.waterLossMinPct > params.waterLossMaxPct) issues.push('失水率目标下限不能高于上限');
  if (params.shakeMinMin > params.shakeMinMax) issues.push('摇青时长下限不能高于上限');
  if (params.fireMediumLoad > params.fireFullLoad) issues.push('中火热负荷阈值不能高于足火阈值');
  return issues;
}

/* --------------------------- 按基准的区间判定 --------------------------- */

/** 通用区间判定：按基准给的下限 / 上限生成 low / ok / high 结论 */
function judgeRange(
  value: number,
  min: number,
  max: number,
  labels: { low: string; ok: string; high: string },
  hints: { low: string; ok: string; high: string },
): RangeVerdict {
  if (value < min) return { level: 'low', label: labels.low, hint: hints.low };
  if (value > max) return { level: 'high', label: labels.high, hint: hints.high };
  return { level: 'ok', label: labels.ok, hint: hints.ok };
}

/** 做青室温判定（阈值取自基准） */
export function judgeRoomTempByStandard(roomTempC: number, p: StandardParams): RangeVerdict {
  return judgeRange(
    roomTempC,
    p.turnRoomTempMin,
    p.turnRoomTempMax,
    { low: '室温偏低', ok: '室温适宜', high: '室温偏高' },
    {
      low: `低于基准下限 ${p.turnRoomTempMin} ℃，可关窗升温并适当缩短静置`,
      ok: `落在基准做青室温区间 ${p.turnRoomTempMin}-${p.turnRoomTempMax} ℃`,
      high: `高于基准上限 ${p.turnRoomTempMax} ℃，注意通风降温，防止红边过快`,
    },
  );
}

/** 做青湿度判定（阈值取自基准） */
export function judgeHumidityByStandard(humidityPct: number, p: StandardParams): RangeVerdict {
  return judgeRange(
    humidityPct,
    p.turnHumidityMin,
    p.turnHumidityMax,
    { low: '湿度偏低', ok: '湿度适宜', high: '湿度偏高' },
    {
      low: `低于基准下限 ${p.turnHumidityMin}%，地面洒水或缩短静置，避免失水过快`,
      ok: `落在基准做青湿度区间 ${p.turnHumidityMin}-${p.turnHumidityMax}%`,
      high: `高于基准上限 ${p.turnHumidityMax}%，加强通风、延长静置走水`,
    },
  );
}

/** 做青全程失水率判定（目标区间取自基准） */
export function judgeWaterLossByStandard(waterLossPct: number, p: StandardParams): RangeVerdict {
  return judgeRange(
    waterLossPct,
    p.waterLossMinPct,
    p.waterLossMaxPct,
    { low: '失水不足', ok: '失水到位', high: '失水偏多' },
    {
      low: `低于基准目标 ${p.waterLossMinPct}%，尚需补 1-2 轮摇青继续走水`,
      ok: `命中基准失水目标 ${p.waterLossMinPct}-${p.waterLossMaxPct}%，可进入杀青工序`,
      high: `超过基准上限 ${p.waterLossMaxPct}%，及时杀青，避免叶张干脆`,
    },
  );
}

/** 单轮摇青时长判定（区间取自基准） */
export function judgeShakeMinByStandard(shakeMin: number, p: StandardParams): RangeVerdict {
  return judgeRange(
    shakeMin,
    p.shakeMinMin,
    p.shakeMinMax,
    { low: '摇青偏轻', ok: '摇青适宜', high: '摇青偏重' },
    {
      low: `短于基准下限 ${p.shakeMinMin} 分钟，可增加 1-2 分钟促进走水`,
      ok: `落在基准摇青区间 ${p.shakeMinMin}-${p.shakeMinMax} 分钟`,
      high: `超过基准上限 ${p.shakeMinMax} 分钟，注意叶缘红边，下一轮适当减时`,
    },
  );
}

/* ----------------------------- 按基准的火功 ----------------------------- */

/** 多道次焙火 → 火功档位（中火 / 足火热负荷阈值取自基准） */
export function fireLevelByStandard(roasts: Roast[], p: StandardParams): ProcessJudgment['fireLevel'] {
  const load = fireLoadOf(roasts);
  if (load >= p.fireFullLoad) return '足火';
  if (load >= p.fireMediumLoad) return '中火';
  return '轻火';
}

/** 是否达到基准要求的足火（热负荷达标且道次数不少于基准要求） */
export function isFullFireByStandard(roasts: Roast[], p: StandardParams): boolean {
  return fireLoadOf(roasts) >= p.fireFullLoad && roasts.length >= p.fullFirePassesMin;
}

/* ----------------------------- 工艺贴合度 ----------------------------- */

/** 距命中区间还需多少（已命中为 0），用于量化贴合度 */
function gapToRange(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

/**
 * 工艺贴合度 0-100：
 * - 失水率命中基准目标区间 60 分；偏离时按距区间边界的百分点扣分（每点 6 分，扣完为止）；
 * - 达到基准足火 40 分；未达足火按累计热负荷占足火阈值比例给分，中火以上至少 24 分。
 * 拼配候选在审评总分相同 / 接近时，按该分重排——基准一改，未定稿候选次序随之变化。
 */
export function conformanceScoreOf(turns: Turn[], roasts: Roast[], p: StandardParams): number {
  const ordered = [...turns].sort((a, b) => a.roundNo - b.roundNo);
  const lastLoss = ordered.length > 0 ? ordered[ordered.length - 1].waterLossPct : 0;
  const lossGap = gapToRange(lastLoss, p.waterLossMinPct, p.waterLossMaxPct);
  const lossScore = Math.max(0, 60 - lossGap * 6);

  const load = fireLoadOf(roasts);
  let fireScore = 0;
  if (roasts.length >= p.fullFirePassesMin && load >= p.fireFullLoad) {
    fireScore = 40;
  } else if (load >= p.fireMediumLoad) {
    fireScore = Math.max(24, Math.min(38, 24 + (load - p.fireMediumLoad) / Math.max(1, p.fireFullLoad - p.fireMediumLoad) * 14));
  } else {
    fireScore = Math.min(24, (load / Math.max(1, p.fireMediumLoad)) * 24);
  }

  return roundTo(lossScore + fireScore, 1);
}

/* ---------------------------- 批次判定链组装 ---------------------------- */

export interface BuildJudgmentParams {
  standard: ProcessStandard | null;
  turns: Turn[];
  roasts: Roast[];
  /** 已定稿批次传入冻结信息 */
  frozen?: boolean;
  finalizedAt?: string | null;
}

/**
 * 组装一个批次的工艺判定：
 * 基准 → 做青记录（失水 / 室温 / 湿度）→ 焙火道次（热负荷 / 火功 / 足火）→ 贴合度。
 * standard 为 null 时用兜底当前值，保证判定链在任何数据状态下都可展示。
 */
export function buildProcessJudgment(params: BuildJudgmentParams): ProcessJudgment {
  const { standard, turns, roasts } = params;
  const p: StandardParams = standard ?? FALLBACK_STANDARD_PARAMS;
  const orderedTurns = [...turns].sort((a, b) => a.roundNo - b.roundNo);
  const orderedRoasts = [...roasts].sort((a, b) => a.passNo - b.passNo);
  const lastTurn = orderedTurns.length > 0 ? orderedTurns[orderedTurns.length - 1] : null;
  const finalWaterLossPct = lastTurn ? lastTurn.waterLossPct : 0;
  const frozen = params.frozen ?? false;

  return {
    standardId: standard ? standard.id : null,
    standardVersionNo: standard ? standard.versionNo : null,
    standardNote: standard ? standard.note : '无基准（按车间通用当前值兜底）',
    frozen,
    finalizedAt: params.finalizedAt ?? null,
    turnCount: orderedTurns.length,
    finalWaterLossPct,
    waterLoss: judgeWaterLossByStandard(finalWaterLossPct, p),
    roomTemp: lastTurn ? judgeRoomTempByStandard(lastTurn.roomTempC, p) : null,
    humidity: lastTurn ? judgeHumidityByStandard(lastTurn.humidityPct, p) : null,
    roastCount: orderedRoasts.length,
    fireLoad: fireLoadOf(orderedRoasts),
    fireLevel: fireLevelByStandard(orderedRoasts, p),
    fullFire: isFullFireByStandard(orderedRoasts, p),
    conformanceScore: conformanceScoreOf(orderedTurns, orderedRoasts, p),
  };
}

/** 冻结判定的可持久化结构（存 Batch.frozenJudgment） */
export type FrozenJudgment = ProcessJudgment;
