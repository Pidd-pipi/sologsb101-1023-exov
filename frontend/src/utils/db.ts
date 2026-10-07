/**
 * IndexedDB 持久化层（Dexie 封装）· 库名 gbtearock
 * - 结构版本号 version(1) 初版 + version(2) 索引与数据修正 + version(DB_VERSION=3) 工艺基准与判定链
 * - 山场 / 茶青批次 / 做青轮次 / 杀青揉捻 / 焙火 / 审评 / 山场工艺基准 七张分表存储
 * - 首屏自动播种互相引用的演示数据（山场 → 基准 / 批次 → 轮次/杀青/焙火/审评 三层贯通）
 * - 纯前端应用：不依赖任何后端、数据库服务或外部接口
 */
import Dexie, { type Table, type Transaction } from 'dexie';
import { CULTIVAR_OPTIONS, SOIL_OPTIONS, type Garden } from '../types/garden';
import { BATCH_STATES, type Batch } from '../types/batch';
import { TURN_LIMITS, type Turn } from '../types/turn';
import type { Fix } from '../types/fix';
import { ROAST_STATES, type Roast } from '../types/roast';
import type { Review } from '../types/review';
import {
  DEFAULT_STANDARD_NOTE,
  DEFAULT_STANDARD_PARAMS,
  type ProcessStandard,
  type StandardDraft,
} from '../types/standard';
import { clampScore, weightedTotalScore } from './tea';
import { buildProcessJudgment } from './standard';

/** 数据库名 = 英文短名 */
export const DB_NAME = 'gbtearock';

/** 当前数据结构版本号（每次调整字段结构必须 +1 并补迁移） */
export const DB_VERSION = 3;

/** 主键前缀，便于在导出 JSON 里肉眼区分实体 */
export const ID_PREFIX = {
  garden: 'garden',
  batch: 'batch',
  turn: 'turn',
  fix: 'fix',
  roast: 'roast',
  review: 'review',
  standard: 'standard',
} as const;

/** 乐观锁冲突：两个标签页同时提交同一批次，晚到者拿到的版本号已过期 */
export class ConcurrencyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyConflictError';
  }
}

class TeaRockDatabase extends Dexie {
  gardens!: Table<Garden, string>;
  batches!: Table<Batch, string>;
  turns!: Table<Turn, string>;
  fixes!: Table<Fix, string>;
  roasts!: Table<Roast, string>;
  reviews!: Table<Review, string>;
  standards!: Table<ProcessStandard, string>;

  constructor() {
    super(DB_NAME);

    // v1：初版结构（只保留最小索引，历史数据沿用 id 主键）
    this.version(1).stores({
      gardens: 'id, name, cultivar',
      batches: 'id, gardenId, state',
      turns: 'id, batchId, roundNo',
      fixes: 'id, batchId, operator',
      roasts: 'id, batchId, passNo, state',
      reviews: 'id, batchId, totalScore',
    });

    // v2：索引补齐（外键 / 状态 / 日期全部可查），并真实迁移历史数据：
    //     1) 补齐 createdAt / updatedAt；2) 山场补齐朝向、土壤与品种兜底值；
    //     3) 批次工序状态归一化；4) 轮次与焙火数值截断到合法区间；
    //     5) 审评总分由「四项简单平均」改为「分项加权换算」，迁移时按新权重重算。
    this.version(DB_VERSION)
      .stores({
        gardens: 'id, name, cultivar, soil, altitudeM, createdAt, updatedAt',
        batches: 'id, gardenId, pickedAt, state, tenderness, createdAt, updatedAt',
        turns: 'id, batchId, roundNo, [batchId+roundNo], createdAt, updatedAt',
        fixes: 'id, batchId, operator, createdAt, updatedAt',
        roasts: 'id, batchId, passNo, state, nextRoastDate, createdAt, updatedAt',
        reviews: 'id, batchId, reviewedAt, totalScore, createdAt, updatedAt',
      })
      .upgrade(async (tx) => {
        const stamp = nowIso();

        await tx
          .table<Garden, string>('gardens')
          .toCollection()
          .modify((row) => {
            if (!row.createdAt) row.createdAt = stamp;
            if (!row.updatedAt) row.updatedAt = row.createdAt;
            if (!row.aspect) row.aspect = '未标注朝向';
            if (!Number.isFinite(row.altitudeM)) row.altitudeM = 0;
            if (!SOIL_OPTIONS.includes(row.soil)) row.soil = SOIL_OPTIONS[0];
            if (!CULTIVAR_OPTIONS.includes(row.cultivar)) row.cultivar = CULTIVAR_OPTIONS[0];
          });

        await tx
          .table<Batch, string>('batches')
          .toCollection()
          .modify((row) => {
            if (!row.createdAt) row.createdAt = stamp;
            if (!row.updatedAt) row.updatedAt = row.createdAt;
            if (!BATCH_STATES.includes(row.state)) row.state = BATCH_STATES[0];
            if (!Number.isFinite(row.freshLeafKg) || row.freshLeafKg <= 0) row.freshLeafKg = 1;
            if (!row.pickedAt) row.pickedAt = stamp.slice(0, 10);
          });

        await tx
          .table<Turn, string>('turns')
          .toCollection()
          .modify((row) => {
            if (!row.createdAt) row.createdAt = stamp;
            if (!row.updatedAt) row.updatedAt = row.createdAt;
            if (!Number.isFinite(row.roundNo) || row.roundNo < 1) row.roundNo = 1;
            row.shakeMin = clampNumber(row.shakeMin, TURN_LIMITS.shakeMin.min, TURN_LIMITS.shakeMin.max);
            row.restMin = clampNumber(row.restMin, TURN_LIMITS.restMin.min, TURN_LIMITS.restMin.max);
            row.roomTempC = clampNumber(row.roomTempC, TURN_LIMITS.roomTempC.min, TURN_LIMITS.roomTempC.max);
            row.humidityPct = clampNumber(row.humidityPct, TURN_LIMITS.humidityPct.min, TURN_LIMITS.humidityPct.max);
            row.waterLossPct = clampNumber(
              row.waterLossPct,
              TURN_LIMITS.waterLossPct.min,
              TURN_LIMITS.waterLossPct.max,
            );
          });

        await tx
          .table<Fix, string>('fixes')
          .toCollection()
          .modify((row) => {
            if (!row.createdAt) row.createdAt = stamp;
            if (!row.updatedAt) row.updatedAt = row.createdAt;
            if (!row.operator) row.operator = '未署名';
            if (!Number.isFinite(row.wokTempC)) row.wokTempC = 180;
            if (!Number.isFinite(row.fixMin)) row.fixMin = 6;
            if (!Number.isFinite(row.rollMin)) row.rollMin = 10;
          });

        await tx
          .table<Roast, string>('roasts')
          .toCollection()
          .modify((row) => {
            if (!row.createdAt) row.createdAt = stamp;
            if (!row.updatedAt) row.updatedAt = row.createdAt;
            if (!ROAST_STATES.includes(row.state)) row.state = ROAST_STATES[0];
            if (typeof row.nextRoastDate !== 'string') row.nextRoastDate = '';
            if (!Number.isFinite(row.passNo) || row.passNo < 1) row.passNo = 1;
            if (!Number.isFinite(row.tempC)) row.tempC = 90;
            if (!Number.isFinite(row.hours)) row.hours = 4;
          });

        await tx
          .table<Review, string>('reviews')
          .toCollection()
          .modify((row) => {
            if (!row.createdAt) row.createdAt = stamp;
            if (!row.updatedAt) row.updatedAt = row.createdAt;
            if (typeof row.blendNote !== 'string') row.blendNote = '';
            if (!row.reviewedAt) row.reviewedAt = stamp.slice(0, 10);
            row.aroma = clampScore(row.aroma);
            row.liquorColor = clampScore(row.liquorColor);
            row.taste = clampScore(row.taste);
            row.leafBase = clampScore(row.leafBase);
            // v2 起总分改为分项加权换算，历史数据按新权重重算
            row.totalScore = weightedTotalScore({
              aroma: row.aroma,
              liquorColor: row.liquorColor,
              taste: row.taste,
              leafBase: row.leafBase,
            });
          });
      });

    // v3：工艺基准（一山场一份做青+焙火基准、版本化留痕）+ 判定链 + 乐观锁。
    //     老数据没有基准留痕：按「当前值」（v2 硬编码的判定阈值）为每个山场补一条 v1 基准，
    //     并把已定稿批次按当时记录冻结判定；未定稿批次留下版本指针，跟随新基准实时重算。
    this.version(DB_VERSION)
      .stores({
        gardens: 'id, name, cultivar, soil, altitudeM, createdAt, updatedAt',
        batches: 'id, gardenId, pickedAt, state, tenderness, standardVersionNo, createdAt, updatedAt',
        turns: 'id, batchId, roundNo, [batchId+roundNo], createdAt, updatedAt',
        fixes: 'id, batchId, operator, createdAt, updatedAt',
        roasts: 'id, batchId, passNo, state, nextRoastDate, createdAt, updatedAt',
        reviews: 'id, batchId, reviewedAt, totalScore, createdAt, updatedAt',
        standards: 'id, gardenId, versionNo, active, [gardenId+versionNo], createdAt, updatedAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table<Turn, string>('turns')
          .toCollection()
          .modify((row) => {
            if (!Number.isFinite(row.rev)) row.rev = 1;
          });

        await tx
          .table<Roast, string>('roasts')
          .toCollection()
          .modify((row) => {
            if (!Number.isFinite(row.rev)) row.rev = 1;
          });

        await tx
          .table<Batch, string>('batches')
          .toCollection()
          .modify((row) => {
            if (!Number.isFinite(row.turnsRev)) row.turnsRev = 1;
            if (!Number.isFinite(row.roastsRev)) row.roastsRev = 1;
            row.standardVersionNo = row.standardVersionNo ?? null;
            row.finalizedAt = row.finalizedAt ?? null;
            row.frozenJudgment = row.frozenJudgment ?? null;
          });

        // 老库无基准留痕：按当前值为每个山场补 v1，并冻结已定稿批次的当时判定
        await backfillStandardsV3(tx);
      });
  }
}

/**
 * v3 迁移：为每个山场按当前值补 v1 基准；已定稿（已审评）批次锁定 v1 并冻结判定。
 * 在升级事务内执行，tx 即 Dexie 升级事务（可直接 table(...) 读写）。
 */
async function backfillStandardsV3(tx: Transaction): Promise<void> {
  const stamp = nowIso();
  const standardsTable = tx.table<ProcessStandard, string>('standards');

  const existing = await standardsTable.count();
  if (existing > 0) return;

  const gardens = await tx.table<Garden, string>('gardens').toArray();
  if (gardens.length === 0) return;

  const allTurns = await tx.table<Turn, string>('turns').toArray();
  const allRoasts = await tx.table<Roast, string>('roasts').toArray();

  await tx
    .table<Batch, string>('batches')
    .toCollection()
    .modify((batch) => {
      // 无论山场是否还在，都按当前值补参数；山场缺失时批次后续会在级联删除里一并清理
      const standard: ProcessStandard = {
        id: standardIdFor(batch.gardenId, 1),
        gardenId: batch.gardenId,
        versionNo: 1,
        active: true,
        note: DEFAULT_STANDARD_NOTE_MIGRATION,
        createdBy: '系统迁移',
        rev: 1,
        ...DEFAULT_STANDARD_PARAMS,
        createdAt: batch.createdAt || stamp,
        updatedAt: stamp,
      };
      // 同一山场只补一条（bulkPut 幂等，后写同 id 覆盖）
      void standardsTable.put(standard);

      if (batch.state === '已审评') {
        const turns = allTurns.filter((turn) => turn.batchId === batch.id);
        const roasts = allRoasts.filter((roast) => roast.batchId === batch.id);
        batch.standardVersionNo = 1;
        batch.finalizedAt = batch.finalizedAt || stamp;
        batch.frozenJudgment = buildProcessJudgment({
          standard,
          turns,
          roasts,
          frozen: true,
          finalizedAt: batch.finalizedAt,
        });
      }
    });
}

/** v3 迁移补齐基准的统一改动说明 */
const DEFAULT_STANDARD_NOTE_MIGRATION = '升级补齐：按车间当前通用判定值建档（做青温湿度 / 失水区间 / 足火热负荷阈值）';

/** 山场基准主键：一山场多版本，版本号进 id（同一山场同版本可幂等覆盖） */
export function standardIdFor(gardenId: string, versionNo: number): string {
  return `${ID_PREFIX.standard}-${gardenId}-v${versionNo}`;
}

export const db = new TeaRockDatabase();

/** 数值截断到区间内 */
function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 当前时间 ISO 字符串 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** 生成主键：前缀 + 时间戳 + 随机串（浏览器优先使用 crypto.randomUUID） */
export function createId(prefix: string): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  const tail =
    cryptoObj && typeof cryptoObj.randomUUID === 'function'
      ? cryptoObj.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}${tail}`;
}

/** 相对今天偏移若干天的 YYYY-MM-DD（播种复焙提醒用） */
function shiftDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* ------------------------------ 打开与播种 ------------------------------ */

/**
 * 打开数据库：首次使用时灌入演示数据，保证每个页面打开都有内容。
 * 判断语句固定为 count() === 0 → seedDatabase()。
 */
export async function initDatabase(): Promise<void> {
  await db.open();
  if ((await db.gardens.count()) === 0) {
    await seedDatabase();
  }
}

/** 幂等播种：固定 id + bulkPut，重复执行不会产生重复行 */
export async function seedDatabase(): Promise<void> {
  const stamp = nowIso();

  const gardens: Garden[] = [
    {
      id: 'garden-niulankeng',
      name: '牛栏坑',
      altitudeM: 285,
      soil: '砾壤',
      cultivar: '肉桂',
      aspect: '东南向',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'garden-huiyuankeng',
      name: '慧苑坑',
      altitudeM: 420,
      soil: '砾壤',
      cultivar: '水仙',
      aspect: '北向',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'garden-matouyan',
      name: '马头岩',
      altitudeM: 640,
      soil: '沙壤',
      cultivar: '肉桂',
      aspect: '南向',
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];

  const batches: Batch[] = [
    {
      id: 'batch-niulankeng-0426',
      gardenId: 'garden-niulankeng',
      pickedAt: '2025-04-26',
      freshLeafKg: 42.5,
      tenderness: '一芽三叶',
      weather: '晴，北风 2 级，晨露已干',
      state: '已审评',
      standardVersionNo: null,
      finalizedAt: null,
      frozenJudgment: null,
      turnsRev: 1,
      roastsRev: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'batch-huiyuankeng-0503',
      gardenId: 'garden-huiyuankeng',
      pickedAt: '2025-05-03',
      freshLeafKg: 58,
      tenderness: '开面采',
      weather: '多云，相对湿度 78%',
      state: '已审评',
      standardVersionNo: null,
      finalizedAt: null,
      frozenJudgment: null,
      turnsRev: 1,
      roastsRev: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'batch-matouyan-0508',
      gardenId: 'garden-matouyan',
      pickedAt: '2025-05-08',
      freshLeafKg: 36.8,
      tenderness: '一芽两叶',
      weather: '晴热，午后 29 ℃',
      state: '已焙火',
      standardVersionNo: null,
      finalizedAt: null,
      frozenJudgment: null,
      turnsRev: 1,
      roastsRev: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'batch-matouyan-0512',
      gardenId: 'garden-matouyan',
      pickedAt: '2025-05-12',
      freshLeafKg: 21.4,
      tenderness: '开面采',
      weather: '阴，间歇小雨，叶面有水',
      state: '做青中',
      standardVersionNo: null,
      finalizedAt: null,
      frozenJudgment: null,
      turnsRev: 1,
      roastsRev: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];

  const turns: Turn[] = [
    turnSeed('turn-niu-1', 'batch-niulankeng-0426', 1, 4, 40, 23, 72, 4.5, stamp),
    turnSeed('turn-niu-2', 'batch-niulankeng-0426', 2, 6, 50, 24, 70, 9.2, stamp),
    turnSeed('turn-niu-3', 'batch-niulankeng-0426', 3, 8, 60, 25, 68, 15.6, stamp),
    turnSeed('turn-hui-1', 'batch-huiyuankeng-0503', 1, 5, 45, 22, 75, 3.8, stamp),
    turnSeed('turn-hui-2', 'batch-huiyuankeng-0503', 2, 8, 55, 23, 71, 9.6, stamp),
    turnSeed('turn-hui-3', 'batch-huiyuankeng-0503', 3, 10, 70, 24, 66, 17.2, stamp),
    turnSeed('turn-matou-1', 'batch-matouyan-0508', 1, 3, 35, 21, 78, 3.2, stamp),
    turnSeed('turn-matou-2', 'batch-matouyan-0508', 2, 5, 45, 22, 74, 8.4, stamp),
    turnSeed('turn-matou-3', 'batch-matouyan-0512', 1, 6, 50, 24, 70, 4.1, stamp),
    turnSeed('turn-matou-4', 'batch-matouyan-0512', 2, 9, 60, 25, 68, 10.8, stamp),
  ];

  const fixes: Fix[] = [
    {
      id: 'fix-niulankeng',
      batchId: 'batch-niulankeng-0426',
      wokTempC: 180,
      fixMin: 6,
      rollPressure: '中',
      rollMin: 12,
      operator: '陈水金',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'fix-huiyuankeng',
      batchId: 'batch-huiyuankeng-0503',
      wokTempC: 165,
      fixMin: 7,
      rollPressure: '轻',
      rollMin: 15,
      operator: '陈水金',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'fix-matouyan',
      batchId: 'batch-matouyan-0508',
      wokTempC: 195,
      fixMin: 5,
      rollPressure: '重',
      rollMin: 8,
      operator: '林清和',
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];

  const roasts: Roast[] = [
    {
      id: 'roast-niu-pass1',
      batchId: 'batch-niulankeng-0426',
      passNo: 1,
      tempC: 110,
      hours: 8,
      charcoal: '荔枝炭',
      nextRoastDate: '',
      state: '已足火',
      rev: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'roast-niu-pass2',
      batchId: 'batch-niulankeng-0426',
      passNo: 2,
      tempC: 120,
      hours: 6,
      charcoal: '荔枝炭',
      nextRoastDate: shiftDate(-2),
      state: '已足火',
      rev: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'roast-hui-pass1',
      batchId: 'batch-huiyuankeng-0503',
      passNo: 1,
      tempC: 95,
      hours: 5,
      charcoal: '龙眼炭',
      nextRoastDate: shiftDate(3),
      state: '焙火中',
      rev: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'roast-hui-pass2',
      batchId: 'batch-huiyuankeng-0503',
      passNo: 2,
      tempC: 100,
      hours: 4,
      charcoal: '机制炭',
      nextRoastDate: '',
      state: '待焙',
      rev: 1,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];

  const reviewSeed: Array<Omit<Review, 'totalScore'>> = [
    {
      id: 'review-niulankeng',
      batchId: 'batch-niulankeng-0426',
      reviewedAt: '2025-07-12',
      aroma: 93,
      liquorColor: 90,
      taste: 92,
      leafBase: 89,
      blendNote: '拼配方案 A · 占 35%',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'review-huiyuankeng',
      batchId: 'batch-huiyuankeng-0503',
      reviewedAt: '2025-07-18',
      aroma: 88,
      liquorColor: 85,
      taste: 87,
      leafBase: 84,
      blendNote: '拼配方案 A · 占 40%',
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: 'review-matouyan',
      batchId: 'batch-matouyan-0508',
      reviewedAt: '2025-07-25',
      aroma: 80,
      liquorColor: 82,
      taste: 78,
      leafBase: 79,
      blendNote: '待定，退火后复评',
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const reviews: Review[] = reviewSeed.map((row) => ({
    ...row,
    totalScore: weightedTotalScore({
      aroma: row.aroma,
      liquorColor: row.liquorColor,
      taste: row.taste,
      leafBase: row.leafBase,
    }),
  }));

  // 每个山场一份做青 + 焙火基准（v1）；数值即车间现行判定值
  const standards: ProcessStandard[] = [
    {
      id: standardIdFor('garden-niulankeng', 1),
      gardenId: 'garden-niulankeng',
      versionNo: 1,
      active: true,
      note: '牛栏坑肉桂：坑涧小气候，走水宜稳，足火吃透',
      createdBy: '陈水金',
      rev: 1,
      ...DEFAULT_STANDARD_PARAMS,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: standardIdFor('garden-huiyuankeng', 1),
      gardenId: 'garden-huiyuankeng',
      versionNo: 1,
      active: true,
      note: '慧苑水仙：叶张肥厚，静置可长，中火打底再复焙',
      createdBy: '陈水金',
      rev: 1,
      ...DEFAULT_STANDARD_PARAMS,
      fireMediumLoad: 560,
      fireFullLoad: 1400,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: standardIdFor('garden-matouyan', 1),
      gardenId: 'garden-matouyan',
      versionNo: 1,
      active: true,
      note: '马头岩肉桂：岗上风大日照强，注意控温走水、保香轻火起步',
      createdBy: '林清和',
      rev: 1,
      ...DEFAULT_STANDARD_PARAMS,
      turnRoomTempMax: 25,
      waterLossMaxPct: 19,
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];

  // 已定稿批次：锁定 v1 并按当时记录冻结判定，基准再改也不重算
  const finalizedBatches = batches
    .filter((batch) => batch.state === '已审评')
    .map((batch) => {
      const standard = standards.find((item) => item.gardenId === batch.gardenId) ?? null;
      const frozen = buildProcessJudgment({
        standard,
        turns: turns.filter((turn) => turn.batchId === batch.id),
        roasts: roasts.filter((roast) => roast.batchId === batch.id),
        frozen: true,
        finalizedAt: '2025-07-26',
      });
      return {
        ...batch,
        standardVersionNo: 1,
        finalizedAt: '2025-07-26',
        frozenJudgment: frozen,
      };
    });
  const frozenById = new Map(finalizedBatches.map((batch) => [batch.id, batch]));
  const batchesToSeed = batches.map((batch) => frozenById.get(batch.id) ?? batch);

  await db.transaction(
    'rw',
    [db.gardens, db.batches, db.turns, db.fixes, db.roasts, db.reviews, db.standards],
    async () => {
      if ((await db.gardens.count()) === 0) await db.gardens.bulkPut(gardens);
      if ((await db.batches.count()) === 0) await db.batches.bulkPut(batchesToSeed);
      if ((await db.turns.count()) === 0) await db.turns.bulkPut(turns);
      if ((await db.fixes.count()) === 0) await db.fixes.bulkPut(fixes);
      if ((await db.roasts.count()) === 0) await db.roasts.bulkPut(roasts);
      if ((await db.reviews.count()) === 0) await db.reviews.bulkPut(reviews);
      if ((await db.standards.count()) === 0) await db.standards.bulkPut(standards);
    },
  );
}

/** 播种用的轮次构造器，避免重复字段声明 */
function turnSeed(
  id: string,
  batchId: string,
  roundNo: number,
  shakeMin: number,
  restMin: number,
  roomTempC: number,
  humidityPct: number,
  waterLossPct: number,
  stamp: string,
): Turn {
  return {
    id,
    batchId,
    roundNo,
    shakeMin,
    restMin,
    roomTempC,
    humidityPct,
    waterLossPct,
    rev: 1,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/* ------------------------------- 山场 ------------------------------- */

export async function listGardens(): Promise<Garden[]> {
  const rows = await db.gardens.toArray();
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

export async function getGarden(id: string): Promise<Garden | undefined> {
  return db.gardens.get(id);
}

export async function putGarden(row: Garden): Promise<void> {
  await db.gardens.put(row);
}

/** 删除山场：级联删除其批次及批次下的轮次 / 杀青 / 焙火 / 审评，以及山场基准的全部历史版本 */
export async function removeGarden(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.gardens, db.batches, db.turns, db.fixes, db.roasts, db.reviews, db.standards],
    async () => {
      const batches = await db.batches.where('gardenId').equals(id).toArray();
      const batchIds = batches.map((batch) => batch.id);
      if (batchIds.length > 0) {
        await db.turns.where('batchId').anyOf(batchIds).delete();
        await db.fixes.where('batchId').anyOf(batchIds).delete();
        await db.roasts.where('batchId').anyOf(batchIds).delete();
        await db.reviews.where('batchId').anyOf(batchIds).delete();
        await db.batches.where('gardenId').equals(id).delete();
      }
      await db.standards.where('gardenId').equals(id).delete();
      await db.gardens.delete(id);
    },
  );
}

/** 新建山场后挂上 v1 基准（事务内幂等；已有基准则直接返回当前生效版本） */
export async function ensureStandardForGarden(gardenId: string, createdBy = '车间'): Promise<ProcessStandard> {
  return db.transaction('rw', db.standards, async () => {
    const existing = await getActiveStandard(gardenId);
    if (existing) return existing;
    const stamp = nowIso();
    const standard: ProcessStandard = {
      id: standardIdFor(gardenId, 1),
      gardenId,
      versionNo: 1,
      active: true,
      note: DEFAULT_STANDARD_NOTE,
      createdBy,
      rev: 1,
      ...DEFAULT_STANDARD_PARAMS,
      createdAt: stamp,
      updatedAt: stamp,
    };
    await db.standards.put(standard);
    return standard;
  });
}

/* ------------------------------ 茶青批次 ------------------------------ */

export async function listBatches(): Promise<Batch[]> {
  const rows = await db.batches.toArray();
  return rows.sort((a, b) => b.pickedAt.localeCompare(a.pickedAt));
}

export async function listBatchesByGarden(gardenId: string): Promise<Batch[]> {
  const rows = await db.batches.where('gardenId').equals(gardenId).toArray();
  return rows.sort((a, b) => b.pickedAt.localeCompare(a.pickedAt));
}

export async function getBatch(id: string): Promise<Batch | undefined> {
  return db.batches.get(id);
}

export async function putBatch(row: Batch): Promise<void> {
  await db.batches.put(row);
}

export async function putBatches(rows: Batch[]): Promise<void> {
  await db.batches.bulkPut(rows);
}

/** 删除批次：级联删除轮次 / 杀青 / 焙火 / 审评 / 判定链引用 */
export async function removeBatch(id: string): Promise<void> {
  await db.transaction('rw', db.batches, db.turns, db.fixes, db.roasts, db.reviews, async () => {
    await db.turns.where('batchId').equals(id).delete();
    await db.fixes.where('batchId').equals(id).delete();
    await db.roasts.where('batchId').equals(id).delete();
    await db.reviews.where('batchId').equals(id).delete();
    await db.batches.delete(id);
  });
}

/** 带乐观锁版本号的行（做青 / 焙火提交助手共用） */
interface RevRow {
  id: string;
  rev?: number;
  updatedAt?: string;
}

/** 待提交的行集合：新增 / 更新 / 删除 */
export interface RevCommit<T extends RevRow> {
  upserts: T[];
  deleteIds?: string[];
}

/**
 * 做青 / 焙火记录的乐观锁提交：
 * 两个标签页同时编辑同一批次时，先提交者把批次 turnsRev/roastsRev +1，
 * 晚到者手里的 expectedRev 已过期 → 抛 ConcurrencyConflictError，整事务回滚，不盖掉对方刚录的记录。
 * 返回提交后批次的新版本号，供调用方更新本地基准值。
 */
async function commitChildRows<T extends RevRow>(
  batchId: string,
  revKey: 'turnsRev' | 'roastsRev',
  table: Table<T, string>,
  expectedRev: number,
  commit: RevCommit<T>,
): Promise<number> {
  return db.transaction('rw', db.batches, table, async () => {
    const batch = await db.batches.get(batchId);
    if (!batch) throw new Error('批次不存在或已被删除');
    if (!Number.isFinite(expectedRev) || batch[revKey] !== expectedRev) {
      throw new ConcurrencyConflictError('该批次的工艺记录已被别人更新，请刷新查看最新数据后再提交（本次修改未保存）');
    }
    const stamp = nowIso();
    const upserts = commit.upserts.map((row) => ({ ...row, rev: (Number.isFinite(row.rev) ? (row.rev as number) : 0) + 1, updatedAt: stamp }));
    if (upserts.length > 0) await table.bulkPut(upserts);
    if (commit.deleteIds && commit.deleteIds.length > 0) await table.bulkDelete(commit.deleteIds);
    const nextRev = expectedRev + 1;
    await db.batches.update(batchId, { [revKey]: nextRev, updatedAt: stamp } as Partial<Batch>);
    return nextRev;
  });
}

/** 提交一批做青轮次（整批重排 roundNo 后一次性 upsert，可带删除） */
export async function commitTurns(batchId: string, expectedRev: number, commit: RevCommit<Turn>): Promise<number> {
  return commitChildRows(batchId, 'turnsRev', db.turns, expectedRev, commit);
}

/** 提交一批焙火道次（整批重排 passNo 后一次性 upsert，可带删除） */
export async function commitRoasts(batchId: string, expectedRev: number, commit: RevCommit<Roast>): Promise<number> {
  return commitChildRows(batchId, 'roastsRev', db.roasts, expectedRev, commit);
}

/**
 * 批次定稿（进入「已审评」）：锁定当前山场生效基准版本，并按当时记录冻结判定。
 * 基准以后再改，该批次始终展示 frozenJudgment（保住当时判定）。
 */
export async function finalizeBatch(batchId: string, finalizedAt = nowIso()): Promise<Batch> {
  return db.transaction('rw', db.batches, db.turns, db.roasts, db.standards, async () => {
    const batch = await db.batches.get(batchId);
    if (!batch) throw new Error('批次不存在或已被删除');
    const [turns, roasts, standard] = await Promise.all([
      db.turns.where('batchId').equals(batchId).toArray(),
      db.roasts.where('batchId').equals(batchId).toArray(),
      getActiveStandard(batch.gardenId),
    ]);
    const frozen = buildProcessJudgment({ standard: standard ?? null, turns, roasts, frozen: true, finalizedAt });
    const next: Batch = {
      ...batch,
      state: '已审评',
      standardVersionNo: standard ? standard.versionNo : batch.standardVersionNo ?? 1,
      finalizedAt,
      frozenJudgment: frozen,
      updatedAt: finalizedAt,
    };
    await db.batches.put(next);
    return next;
  });
}

/* ------------------------------ 做青轮次 ------------------------------ */

export async function listTurnsByBatch(batchId: string): Promise<Turn[]> {
  const rows = await db.turns.where('batchId').equals(batchId).toArray();
  return rows.sort((a, b) => a.roundNo - b.roundNo);
}

export async function listAllTurns(): Promise<Turn[]> {
  const rows = await db.turns.toArray();
  return rows.sort((a, b) => a.batchId.localeCompare(b.batchId) || a.roundNo - b.roundNo);
}

export async function putTurn(row: Turn): Promise<void> {
  await db.turns.put(row);
}

export async function putTurns(rows: Turn[]): Promise<void> {
  await db.turns.bulkPut(rows);
}

export async function removeTurn(id: string): Promise<void> {
  await db.turns.delete(id);
}

/* ----------------------------- 杀青揉捻 ----------------------------- */

export async function listFixes(): Promise<Fix[]> {
  const rows = await db.fixes.toArray();
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listFixesByBatch(batchId: string): Promise<Fix[]> {
  return db.fixes.where('batchId').equals(batchId).toArray();
}

export async function putFix(row: Fix): Promise<void> {
  await db.fixes.put(row);
}

export async function removeFix(id: string): Promise<void> {
  await db.fixes.delete(id);
}

/* -------------------------------- 焙火 -------------------------------- */

export async function listRoasts(): Promise<Roast[]> {
  const rows = await db.roasts.toArray();
  return rows.sort((a, b) => a.batchId.localeCompare(b.batchId) || a.passNo - b.passNo);
}

export async function listRoastsByBatch(batchId: string): Promise<Roast[]> {
  const rows = await db.roasts.where('batchId').equals(batchId).toArray();
  return rows.sort((a, b) => a.passNo - b.passNo);
}

export async function putRoast(row: Roast): Promise<void> {
  await db.roasts.put(row);
}

export async function putRoasts(rows: Roast[]): Promise<void> {
  await db.roasts.bulkPut(rows);
}

export async function removeRoast(id: string): Promise<void> {
  await db.roasts.delete(id);
}

/* -------------------------------- 审评 -------------------------------- */

export async function listReviews(): Promise<Review[]> {
  const rows = await db.reviews.toArray();
  return rows.sort((a, b) => b.totalScore - a.totalScore);
}

export async function listReviewsByBatch(batchId: string): Promise<Review[]> {
  const rows = await db.reviews.where('batchId').equals(batchId).toArray();
  return rows.sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
}

export async function putReview(row: Review): Promise<void> {
  await db.reviews.put(row);
}

export async function removeReview(id: string): Promise<void> {
  await db.reviews.delete(id);
}

/* ------------------------------ 工艺基准 ------------------------------ */

/** 取一个山场当前生效的基准版本（无则 undefined） */
export async function getActiveStandard(gardenId: string): Promise<ProcessStandard | undefined> {
  const rows = await db.standards.where('gardenId').equals(gardenId).toArray();
  return rows
    .filter((row) => row.active)
    .sort((a, b) => b.versionNo - a.versionNo)[0];
}

/** 取一个山场指定版本的基准（判定链回溯历史版本使用） */
export async function getStandardByVersion(gardenId: string, versionNo: number): Promise<ProcessStandard | undefined> {
  return db.standards.get(standardIdFor(gardenId, versionNo));
}

/** 全部基准（含历史版本），按山场名、版本号排序 */
export async function listStandards(): Promise<ProcessStandard[]> {
  const rows = await db.standards.toArray();
  return rows.sort((a, b) => a.gardenId.localeCompare(b.gardenId) || b.versionNo - a.versionNo);
}

/** 各山场当前生效基准（key = gardenId） */
export async function listActiveStandards(): Promise<Record<string, ProcessStandard>> {
  const rows = await db.standards.toArray();
  const map: Record<string, ProcessStandard> = {};
  rows
    .filter((row) => row.active)
    .forEach((row) => {
      const current = map[row.gardenId];
      if (!current || row.versionNo > current.versionNo) map[row.gardenId] = row;
    });
  return map;
}

/**
 * 发布山场基准新版本：旧版本置为 inactive（留痕不删），新版本号 +1 且 active。
 * 基于 expectedRev 做乐观锁：别人刚发布过新版本，本次提交被拒并提示刷新。
 * 基准改动不直接改写任何记录；未定稿批次下次复算自动用新版本，已定稿批次冻结值不受影响。
 */
export async function publishStandard(draft: StandardDraft, expectedRev: number): Promise<ProcessStandard> {
  return db.transaction('rw', db.standards, async () => {
    const active = await getActiveStandard(draft.gardenId);
    if (active && active.rev !== expectedRev) {
      throw new ConcurrencyConflictError('该山场基准已被别人更新，请刷新查看最新版本后再发布（本次修改未保存）');
    }
    const stamp = nowIso();
    const nextVersionNo = active ? active.versionNo + 1 : 1;
    // rev 沿版本链单调递增：两个标签页都基于旧 rev 发布时，后到者会在这里被 CAS 拒绝
    const next: ProcessStandard = {
      ...draft,
      id: standardIdFor(draft.gardenId, nextVersionNo),
      versionNo: nextVersionNo,
      active: true,
      rev: active ? active.rev + 1 : 1,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (active) await db.standards.update(active.id, { active: false, updatedAt: stamp });
    await db.standards.put(next);
    return next;
  });
}

/* ---------------------------- 整库导入导出 ---------------------------- */

/** 整库快照（导出 / 导入 JSON 的结构） */
export interface DatabaseSnapshot {
  name: string;
  schemaVersion: number;
  exportedAt: string;
  gardens: Garden[];
  batches: Batch[];
  turns: Turn[];
  fixes: Fix[];
  roasts: Roast[];
  reviews: Review[];
  standards: ProcessStandard[];
}

/** 导出整库快照 */
export async function exportSnapshot(): Promise<DatabaseSnapshot> {
  const [gardens, batches, turns, fixes, roasts, reviews, standards] = await Promise.all([
    db.gardens.toArray(),
    db.batches.toArray(),
    db.turns.toArray(),
    db.fixes.toArray(),
    db.roasts.toArray(),
    db.reviews.toArray(),
    db.standards.toArray(),
  ]);
  return {
    name: DB_NAME,
    schemaVersion: DB_VERSION,
    exportedAt: nowIso(),
    gardens,
    batches,
    turns,
    fixes,
    roasts,
    reviews,
    standards,
  };
}

/** 用快照覆盖整库（导入存档）；老存档缺少基准 / 冻结字段时按当前值补齐 */
export async function importSnapshot(snapshot: DatabaseSnapshot): Promise<void> {
  await db.transaction(
    'rw',
    [db.gardens, db.batches, db.turns, db.fixes, db.roasts, db.reviews, db.standards],
    async () => {
      await Promise.all([
        db.gardens.clear(),
        db.batches.clear(),
        db.turns.clear(),
        db.fixes.clear(),
        db.roasts.clear(),
        db.reviews.clear(),
        db.standards.clear(),
      ]);
      const normalizedTurns = (snapshot.turns ?? []).map((row) => ({ ...row, rev: normalizeRev(row.rev) }));
      const normalizedRoasts = (snapshot.roasts ?? []).map((row) => ({ ...row, rev: normalizeRev(row.rev) }));
      const standards = normalizeSnapshotStandards(snapshot.standards ?? [], snapshot);
      const batches = (snapshot.batches ?? []).map((batch) =>
        normalizeSnapshotBatch(batch, standards, normalizedTurns, normalizedRoasts),
      );
      await db.gardens.bulkPut(snapshot.gardens);
      await db.standards.bulkPut(standards);
      await db.batches.bulkPut(batches);
      await db.turns.bulkPut(normalizedTurns);
      await db.fixes.bulkPut(snapshot.fixes);
      await db.roasts.bulkPut(normalizedRoasts);
      await db.reviews.bulkPut(snapshot.reviews);
    },
  );
}

function normalizeRev(rev: unknown): number {
  return typeof rev === 'number' && Number.isFinite(rev) && rev > 0 ? Math.round(rev) : 1;
}

/**
 * 老存档没有基准留痕：导入时按当前值，为山场（含批次引用到但存档里缺行的山场）补一条 v1。
 */
function normalizeSnapshotStandards(rows: ProcessStandard[] | undefined, snapshot: DatabaseSnapshot): ProcessStandard[] {
  if (rows && rows.length > 0) return rows;
  const stamp = nowIso();
  const gardenIds = new Set<string>(snapshot.gardens.map((garden) => garden.id));
  snapshot.batches.forEach((batch) => gardenIds.add(batch.gardenId));
  return [...gardenIds].map((gardenId) => ({
    id: standardIdFor(gardenId, 1),
    gardenId,
    versionNo: 1,
    active: true,
    note: '导入补齐：按车间当前通用判定值建档',
    createdBy: '系统导入',
    rev: 1,
    ...DEFAULT_STANDARD_PARAMS,
    createdAt: stamp,
    updatedAt: stamp,
  }));
}

/** 已定稿批次缺冻结判定时，按当时记录 + 补出的基准 v1 冻结，保住「当时判定」语义 */
function normalizeSnapshotBatch(
  batch: Batch,
  standards: ProcessStandard[],
  turns: Turn[],
  roasts: Roast[],
): Batch {
  const stamp = batch.updatedAt || nowIso();
  const active = standards.find((row) => row.gardenId === batch.gardenId && row.active);
  const next: Batch = {
    ...batch,
    standardVersionNo: batch.standardVersionNo ?? null,
    finalizedAt: batch.finalizedAt ?? null,
    frozenJudgment: batch.frozenJudgment ?? null,
    turnsRev: normalizeRev(batch.turnsRev),
    roastsRev: normalizeRev(batch.roastsRev),
    updatedAt: stamp,
  };
  if (batch.state === '已审评' && active && !next.frozenJudgment) {
    next.standardVersionNo = active.versionNo;
    next.finalizedAt = next.finalizedAt || stamp;
    next.frozenJudgment = buildProcessJudgment({
      standard: active,
      turns: turns.filter((turn) => turn.batchId === batch.id),
      roasts: roasts.filter((roast) => roast.batchId === batch.id),
      frozen: true,
      finalizedAt: next.finalizedAt,
    });
  }
  return next;
}

/** 清空全部表（不重新播种） */
export async function clearAllTables(): Promise<void> {
  await db.transaction(
    'rw',
    [db.gardens, db.batches, db.turns, db.fixes, db.roasts, db.reviews, db.standards],
    async () => {
      await Promise.all([
        db.gardens.clear(),
        db.batches.clear(),
        db.turns.clear(),
        db.fixes.clear(),
        db.roasts.clear(),
        db.reviews.clear(),
        db.standards.clear(),
      ]);
    },
  );
}

/** 清空全部数据并重新灌入演示数据 */
export async function resetDatabase(): Promise<void> {
  await clearAllTables();
  await seedDatabase();
}

/** 各表行数概览（页脚与统计徽标使用） */
export async function countAll(): Promise<Record<string, number>> {
  const [gardens, batches, turns, fixes, roasts, reviews, standards] = await Promise.all([
    db.gardens.count(),
    db.batches.count(),
    db.turns.count(),
    db.fixes.count(),
    db.roasts.count(),
    db.reviews.count(),
    db.standards.count(),
  ]);
  return { gardens, batches, turns, fixes, roasts, reviews, standards };
}
