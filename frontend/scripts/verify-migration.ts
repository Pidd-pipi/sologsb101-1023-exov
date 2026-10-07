/**
 * v2 → v3 升级迁移校验：
 * 老库没有 standards 表、批次没有冻结字段、轮次/焙火没有 rev。
 * 升级必须：1) 每个山场按当前值补一条 v1 基准；2) 已定稿批次锁定 v1 并冻结当时判定；
 * 3) 未定稿批次不冻结；4) turns/roasts/batches 的乐观锁字段补齐为 1。
 */
import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { db, DB_NAME, listBatches, listStandards } from '../src/utils/db';
import type { Garden } from '../src/types/garden';
import type { Batch } from '../src/types/batch';
import type { Turn } from '../src/types/turn';
import type { Roast } from '../src/types/roast';
import type { Review } from '../src/types/review';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

/** 先用「只认识 v2 结构」的 Dexie 实例灌一批老格式数据（故意缺基准 / rev / 冻结字段） */
async function seedLegacyV2(): Promise<void> {
  const legacy = new Dexie(DB_NAME);
  legacy.version(2).stores({
    gardens: 'id, name, cultivar, soil, altitudeM, createdAt, updatedAt',
    batches: 'id, gardenId, pickedAt, state, tenderness, createdAt, updatedAt',
    turns: 'id, batchId, roundNo, [batchId+roundNo], createdAt, updatedAt',
    fixes: 'id, batchId, operator, createdAt, updatedAt',
    roasts: 'id, batchId, passNo, state, nextRoastDate, createdAt, updatedAt',
    reviews: 'id, batchId, reviewedAt, totalScore, createdAt, updatedAt',
  });
  const stamp = '2025-04-26T00:00:00.000Z';
  const gardens = legacy.table('gardens') as Table<Garden, string>;
  const batches = legacy.table('batches') as Table<Batch, string>;
  const turns = legacy.table('turns') as Table<Turn, string>;
  const roasts = legacy.table('roasts') as Table<Roast, string>;
  const reviews = legacy.table('reviews') as Table<Review, string>;

  await gardens.bulkPut([
    { id: 'g1', name: '老山场甲', altitudeM: 300, soil: '砾壤', cultivar: '肉桂', aspect: '南', createdAt: stamp, updatedAt: stamp },
    { id: 'g2', name: '老山场乙', altitudeM: 500, soil: '红壤', cultivar: '水仙', aspect: '北', createdAt: stamp, updatedAt: stamp },
  ]);
  const oldBatch = (id: string, gardenId: string, state: Batch['state']): Batch =>
    ({ id, gardenId, pickedAt: '2025-05-01', freshLeafKg: 20, tenderness: '一芽三叶', weather: '', state, createdAt: stamp, updatedAt: stamp } as Batch);
  await batches.bulkPut([oldBatch('b-done', 'g1', '已审评'), oldBatch('b-live', 'g2', '做青中')]);

  await turns.bulkPut([
    { id: 't1', batchId: 'b-done', roundNo: 1, shakeMin: 5, restMin: 45, roomTempC: 23, humidityPct: 72, waterLossPct: 16, createdAt: stamp, updatedAt: stamp } as Turn,
    { id: 't2', batchId: 'b-live', roundNo: 1, shakeMin: 4, restMin: 40, roomTempC: 22, humidityPct: 70, waterLossPct: 8, createdAt: stamp, updatedAt: stamp } as Turn,
  ]);
  // 1600 ℃·h：按当前值阈值 1500 应判足火
  await roasts.bulkPut([
    { id: 'r1', batchId: 'b-done', passNo: 1, tempC: 100, hours: 8, charcoal: '荔枝炭', nextRoastDate: '', state: '已足火', createdAt: stamp, updatedAt: stamp } as Roast,
    { id: 'r2', batchId: 'b-done', passNo: 2, tempC: 100, hours: 8, charcoal: '荔枝炭', nextRoastDate: '', state: '已足火', createdAt: stamp, updatedAt: stamp } as Roast,
  ]);
  await reviews.bulkPut([
    { id: 'rv1', batchId: 'b-done', reviewedAt: '2025-07-01', aroma: 90, liquorColor: 90, taste: 90, leafBase: 90, totalScore: 90, blendNote: '', createdAt: stamp, updatedAt: stamp },
  ]);
  legacy.close();
}

async function main(): Promise<void> {
  console.log('准备 v2 老库（无基准留痕）');
  await seedLegacyV2();

  console.log('用当前代码（v3）打开，触发 .upgrade()');
  await db.open();

  const standards = await listStandards();
  const batches = await listBatches();
  check('迁移后每个山场补出 1 条基准（共 2 条 v1）',
    standards.length === 2 && standards.every((s) => s.versionNo === 1 && s.active));

  const g1 = standards.find((s) => s.gardenId === 'g1');
  check('基准按「当前值」补齐：失水 12-20 / 足火 1500',
    g1?.waterLossMinPct === 12 && g1.waterLossMaxPct === 20 && g1.fireFullLoad === 1500);

  const done = batches.find((b) => b.id === 'b-done');
  const live = batches.find((b) => b.id === 'b-live');
  check('已定稿批次锁定 v1', done?.standardVersionNo === 1);
  check('已定稿批次冻结当时判定：失水 16% 命中、足火 1600 判足火',
    done?.frozenJudgment?.frozen === true &&
    done.frozenJudgment.waterLoss.level === 'ok' &&
    done.frozenJudgment.fireLevel === '足火' &&
    done.frozenJudgment.fireLoad === 1600);
  check('冻结判定带定稿时间', Boolean(done?.finalizedAt));
  check('未定稿批次不冻结', live?.frozenJudgment === null && live?.standardVersionNo === null);
  check('批次乐观锁字段补齐 turnsRev/roastsRev = 1', done?.turnsRev === 1 && live?.roastsRev === 1);
  const legacyTurn = await db.turns.get('t1');
  const legacyRoast = await db.roasts.get('r1');
  check('轮次 / 焙火行级 rev 补齐为 1', legacyTurn?.rev === 1 && legacyRoast?.rev === 1);

  if (failures > 0) {
    console.error(`\n${failures} 项校验失败`);
    process.exit(1);
  }
  console.log('\n全部 v2→v3 迁移校验通过');
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
