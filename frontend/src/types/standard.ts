/**
 * 山场做青 / 焙火基准（GardenStandard）
 * 老师傅的经验落成每个山场一份的「做青基准 + 焙火基准」，并把
 * 基准 → 做青失水判定 → 焙火火功判定 → 审评结论 串成判定链。
 *
 * 基准是版本化的：同一山场每次改版都追加一条留痕（rev 递增），
 * 未定稿批次永远按当前版本重算，已定稿批次冻结当时版本与判定。
 */
import type { FireLevel } from './roast';

/** 做青失水区间判定结论（与 utils/tea.ts 的 RangeVerdict.level 同构） */
export type WaterVerdictLevel = 'low' | 'ok' | 'high';

/** 做青基准：室温 / 湿度 / 失水率目标区间与摇青时长基准 */
export interface TurnBaseline {
  /** 做青室温目标下限 ℃ */
  roomTempMinC: number;
  /** 做青室温目标上限 ℃ */
  roomTempMaxC: number;
  /** 相对湿度目标下限 % */
  humidityMinPct: number;
  /** 相对湿度目标上限 % */
  humidityMaxPct: number;
  /** 全程累计失水率目标下限 % */
  waterLossMinPct: number;
  /** 全程累计失水率目标上限 % */
  waterLossMaxPct: number;
  /** 单轮摇青基准分钟（低于基准 +3 分钟视为偏轻） */
  shakeBaseMin: number;
}

/** 焙火基准：累计热负荷（℃·h）阈值 */
export interface RoastBaseline {
  /** 达到中火的累计热负荷 ℃·h */
  mediumLoad: number;
  /** 达到足火的累计热负荷 ℃·h */
  fullLoad: number;
  /** 足火要求的最少道次 */
  fullMinPasses: number;
}

/** 山场基准实体（持久化到 IndexedDB 的 standards 表；同一山场保留多版留痕） */
export interface GardenStandard {
  id: string;
  /** 所属山场 id（gardenId 外键） */
  gardenId: string;
  /** 版本号，从 1 开始；每次改版 +1 */
  rev: number;
  /** 是否为该山场当前生效版本（每山场仅一条为 true） */
  isCurrent: boolean;
  /** 做青基准 */
  turn: TurnBaseline;
  /** 焙火基准 */
  roast: RoastBaseline;
  /** 改版说明（老师傅备注，例如「今年青叶偏嫩，失水下限下调」） */
  changeNote: string;
  createdAt: string;
  updatedAt: string;
}

/** 基准改版表单草稿（rev / isCurrent / 系统字段由落库时计算） */
export interface StandardDraft {
  turn: TurnBaseline;
  roast: RoastBaseline;
  changeNote: string;
}

/**
 * 定稿时冻结在审评记录上的判定留痕。
 * 一旦审评提交（定稿），即使基准后续改版，也只用这份快照回放原判定。
 */
export interface FrozenJudgment {
  /** 定稿时采用的基准版本 */
  standardRev: number;
  /** 定稿时基准的完整快照（基准被删除 / 改版也不影响回放） */
  standard: {
    turn: TurnBaseline;
    roast: RoastBaseline;
  };
  /** 定稿时末轮累计失水率 % */
  waterLossPct: number;
  /** 定稿时失水判定结论 */
  waterVerdict: WaterVerdictLevel;
  /** 定稿时焙火累计热负荷 ℃·h */
  fireLoad: number;
  /** 定稿时火功档位 */
  fireLevel: FireLevel;
  /** 定稿时焙火道次数 */
  roastPassCount: number;
}

/**
 * 单个批次在判定链上的派生结论。
 * 已定稿批次：全部取自审评记录冻结的快照，基准改版不影响。
 * 未定稿批次：按所属山场当前基准实时计算，基准一改版立即重算。
 */
export interface BatchVerdict {
  batchId: string;
  gardenId: string;
  /** 采用的基准版本（定稿=冻结版本，未定稿=当前版本；无基准兜底为 0） */
  standardRev: number;
  /** 结论是否已随审评定稿冻结 */
  finalized: boolean;
  /** 当前是否能取到山场基准（false 时使用内置默认值兜底） */
  hasStandard: boolean;
  turn: TurnBaseline;
  roast: RoastBaseline;
  waterLossPct: number;
  waterVerdict: WaterVerdictLevel;
  fireLoad: number;
  fireLevel: FireLevel;
  roastPassCount: number;
}

/** 基准参数合法区间（表单校验共用） */
export const STANDARD_LIMITS = {
  roomTempC: { min: 5, max: 40 },
  humidityPct: { min: 20, max: 100 },
  waterLossPct: { min: 0, max: 40 },
  shakeBaseMin: { min: 0, max: 60 },
  fireLoad: { min: 0, max: 6000 },
  fullMinPasses: { min: 1, max: 12 },
} as const;

/**
 * 内置做青基准：与老师傅经验区间一致（室温 20-26 ℃ / 湿度 60-80 % /
 * 全程失水 12-20 % / 单轮摇青基准 3 分钟）。旧数据升级时按此「当前值」补齐。
 */
export const DEFAULT_TURN_BASELINE: TurnBaseline = {
  roomTempMinC: 20,
  roomTempMaxC: 26,
  humidityMinPct: 60,
  humidityMaxPct: 80,
  waterLossMinPct: 12,
  waterLossMaxPct: 20,
  shakeBaseMin: 3,
};

/** 内置焙火基准：中火 600 ℃·h / 足火 1500 ℃·h / 足火至少 2 道次。 */
export const DEFAULT_ROAST_BASELINE: RoastBaseline = {
  mediumLoad: 600,
  fullLoad: 1500,
  fullMinPasses: 2,
};
