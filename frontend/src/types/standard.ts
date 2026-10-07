/**
 * 工艺基准（ProcessStandard）：每个山场一份「做青 + 焙火」判定基准。
 * - 基准按山场版本化留痕：同一山场的新版本号递增，仅一条 active；
 * - 已定稿批次按定稿时的版本号冻结判定（见 Batch.frozenJudgment），未定稿批次始终跟随当前 active 版本重算。
 */
import type { RangeVerdict } from '../utils/tea';
import type { FireLevel } from './roast';

/** 做青 / 焙火基准参数（表单与实体共用的扁平字段） */
export interface StandardParams {
  /* ------------------------------ 做青基准 ------------------------------ */
  /** 做青室温下限 ℃ */
  turnRoomTempMin: number;
  /** 做青室温上限 ℃ */
  turnRoomTempMax: number;
  /** 做青相对湿度下限 % */
  turnHumidityMin: number;
  /** 做青相对湿度上限 % */
  turnHumidityMax: number;
  /** 做青全程目标失水率下限 % */
  waterLossMinPct: number;
  /** 做青全程目标失水率上限 % */
  waterLossMaxPct: number;
  /** 单轮摇青时长下限 分钟 */
  shakeMinMin: number;
  /** 单轮摇青时长上限 分钟 */
  shakeMinMax: number;
  /* ------------------------------ 焙火基准 ------------------------------ */
  /** 中火累计热负荷阈值（℃·h） */
  fireMediumLoad: number;
  /** 足火累计热负荷阈值（℃·h） */
  fireFullLoad: number;
  /** 足火要求的最少道次数 */
  fullFirePassesMin: number;
}

/** 山场工艺基准实体（持久化到 IndexedDB 的 standards 表，一山场多版本） */
export interface ProcessStandard extends StandardParams {
  id: string;
  /** 所属山场 id（gardenId 外键） */
  gardenId: string;
  /** 版本号，从 1 开始；每次改动 +1，旧版本保留留痕 */
  versionNo: number;
  /** 是否为该山场当前生效版本（同一 gardenId 仅一条 true） */
  active: boolean;
  /** 本次改动说明，例如「春茶雨水青，收紧失水上限」 */
  note: string;
  /** 定稿人 / 修改人 */
  createdBy: string;
  /** 乐观锁版本号，并发发布时用于 CAS 冲突判定 */
  rev: number;
  createdAt: string;
  updatedAt: string;
}

/** 发布新版本基准的表单草稿 */
export interface StandardDraft extends StandardParams {
  gardenId: string;
  note: string;
  createdBy: string;
}

/** 基准字段的表单合法区间 */
export const STANDARD_LIMITS = {
  turnRoomTempMin: { min: 5, max: 40 },
  turnRoomTempMax: { min: 5, max: 40 },
  turnHumidityMin: { min: 20, max: 100 },
  turnHumidityMax: { min: 20, max: 100 },
  waterLossMinPct: { min: 0, max: 40 },
  waterLossMaxPct: { min: 0, max: 40 },
  shakeMinMin: { min: 0, max: 120 },
  shakeMinMax: { min: 0, max: 120 },
  fireMediumLoad: { min: 0, max: 4000 },
  fireFullLoad: { min: 0, max: 6000 },
  fullFirePassesMin: { min: 1, max: 8 },
} as const;

/**
 * 基准「当前值」：升级前系统一直用这套硬编码阈值判定，
 * 老数据没有基准留痕，v3 迁移时就按这组当前值为每个山场补齐 v1。
 */
export const DEFAULT_STANDARD_PARAMS: StandardParams = {
  turnRoomTempMin: 20,
  turnRoomTempMax: 26,
  turnHumidityMin: 60,
  turnHumidityMax: 80,
  waterLossMinPct: 12,
  waterLossMaxPct: 20,
  shakeMinMin: 3,
  shakeMinMax: 12,
  fireMediumLoad: 600,
  fireFullLoad: 1500,
  fullFirePassesMin: 2,
};

/** 新建山场时 v1 基准的默认改动说明 */
export const DEFAULT_STANDARD_NOTE = '初始基准（按车间当前通用判定值建档）';

/** 某批次按基准复算出来的完整工艺判定（判定链的「判定」一环） */
export interface ProcessJudgment {
  /** 判定所依据的基准 id；无基准兜底为 null */
  standardId: string | null;
  /** 判定所依据的基准版本号 */
  standardVersionNo: number | null;
  /** 基准改动说明（判定链上回显） */
  standardNote: string;
  /** 是否为定稿时冻结的历史判定 */
  frozen: boolean;
  /** 定稿时间（frozen=true 时存在） */
  finalizedAt: string | null;
  /* ------------------------------ 做青 ------------------------------ */
  turnCount: number;
  /** 末轮累计失水率 % */
  finalWaterLossPct: number;
  /** 末轮失水率相对基准目标区间的判定 */
  waterLoss: RangeVerdict;
  /** 末轮室温相对基准区间的判定（无轮次为 null） */
  roomTemp: RangeVerdict | null;
  /** 末轮湿度相对基准区间的判定（无轮次为 null） */
  humidity: RangeVerdict | null;
  /* ------------------------------ 焙火 ------------------------------ */
  roastCount: number;
  /** 累计热负荷 ℃·h */
  fireLoad: number;
  /** 火功档位（按基准阈值换算） */
  fireLevel: FireLevel;
  /** 是否达到基准要求的足火（热负荷达标且道次数达标） */
  fullFire: boolean;
  /** 工艺贴合度 0-100：失水命中目标区间 + 火功档位，拼配候选重排用 */
  conformanceScore: number;
}
