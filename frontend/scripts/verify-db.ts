/**
 * Dexie 层集成校验（fake-indexeddb，模拟两个标签页同时提交）：
 * A. 全新库播种：每山场有 v1 基准，已定稿批次带冻结判定；
 * B. 乐观锁：标签页 A 先提交做青记录成功后，标签页 B 用旧 rev 提交被拒且不覆盖 A 的记录；
 * C. 基准发布：v2 生效、v1 留痕；并发发布晚到者被拒；
 * D. 定稿：finalizeBatch 锁定版本并冻结；之后基准再改，定稿判定不变、未定稿按新版本重算。
 */
import 'fake-indexeddb/auto';
import {
  db,
  initDatabase,
  listBatches,
  listTurnsByBatch,
  commitTurns,
  ConcurrencyConflictError,
  publishStandard,
  getActiveStandard,
  listStandards,
  finalizeBatch,
  createId,
  ID_PREFIX,
  nowIso,
} from '../src/utils/db';
import { buildProcessJudgment } from '../src/utils/standard';
import type { Batch } from '../src/types/batch';
import type { ProcessStandard } from '../src/types/standard';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

/** 与 useProcessJudgment 完全一致的解析规则：定稿读冻结，否则按当前生效基准复算 */
async function resolve(batch: Batch) {
  if (batch.state === '已审评' && batch.frozenJudgment) return batch.frozenJudgment;
  const [standard, turns, roasts] = await Promise.all([
    getActiveStandard(batch.gardenId),
    db.turns.where('batchId').equals(batch.id).toArray(),
    db.roasts.where('batchId').equals(batch.id).toArray(),
  ]);
  return buildProcessJudgment({ standard: standard ?? null, turns, roasts });
}

async function main(): Promise<void> {
  console.log('A) 全新库播种 / v3 结构');
  await initDatabase();
  const [gardenCount, standardCount, batches] = await Promise.all([
    db.gardens.count(),
    db.standards.count(),
    listBatches(),
  ]);
  check('播种 3 个山场', gardenCount === 3);
  check('每个山场一份 v1 基准（共 3 条）', standardCount === 3);
  const niu = batches.find((b) => b.id === 'batch-niulankeng-0426');
  check('已定稿批次锁定 v1', niu?.standardVersionNo === 1);
  check('已定稿批次带冻结判定（足火）', niu?.frozenJudgment?.frozen === true && niu.frozenJudgment?.fireLevel === '足火');
  const matouLive = batches.find((b) => b.id === 'batch-matouyan-0512');
  check('未定稿批次无冻结', matouLive?.frozenJudgment === null && matouLive?.standardVersionNo === null);

  console.log('B) 两个标签页同时提交同一批次做青记录（乐观锁）');
  const liveId = 'batch-matouyan-0512';
  const before = await db.batches.get(liveId);
  const baseTurns = await listTurnsByBatch(liveId);
  check('批次初始 turnsRev = 1', before?.turnsRev === 1);

  const stamp = nowIso();
  const mkTurn = (id: string, waterLossPct: number) => ({
    id, batchId: liveId, roundNo: 0,
    shakeMin: 10, restMin: 55, roomTempC: 23, humidityPct: 68, waterLossPct, rev: 0,
    createdAt: stamp, updatedAt: stamp,
  });
  const turnA = mkTurn(createId(ID_PREFIX.turn), 15.5);
  const turnB = mkTurn(createId(ID_PREFIX.turn), 30);

  // 标签页 A 基于 rev=1 追加一轮
  const revAfterA = await commitTurns(liveId, 1, { upserts: [...baseTurns, turnA].map((t, i) => ({ ...t, roundNo: i + 1 })) });
  check('标签页 A 提交成功，turnsRev 升到 2', revAfterA === 2);

  // 标签页 B 也基于打开页面时读到的 rev=1（晚到）
  let rejected = false;
  try {
    await commitTurns(liveId, 1, { upserts: [...baseTurns, turnB].map((t, i) => ({ ...t, roundNo: i + 1 })) });
  } catch (error) {
    rejected = error instanceof ConcurrencyConflictError;
  }
  check('标签页 B（晚到、旧 rev）被 ConcurrencyConflictError 拒绝', rejected);
  const after = await listTurnsByBatch(liveId);
  check('A 刚录的轮次仍在（未被 B 盖掉）', after.some((t) => t.id === turnA.id));
  check('B 的记录没有落库', !after.some((t) => t.id === turnB.id));
  check('轮次仍为 3 且 roundNo 连续', after.length === 3 && after.map((t) => t.roundNo).join(',') === '1,2,3');

  // B 刷新拿到 rev=2 后重试，成功
  const revAfterB = await commitTurns(liveId, 2, { upserts: [...after, turnB].map((t, i) => ({ ...t, roundNo: i + 1 })) });
  check('B 刷新到最新 rev 后重试成功（turnsRev = 3）', revAfterB === 3);

  console.log('C) 基准发布新版本 / 版本留痕 / 并发发布');
  const matouV1 = await getActiveStandard('garden-matouyan');
  check('马头岩当前为 v1', matouV1?.versionNo === 1);
  const draft = (over: Partial<ProcessStandard> = {}) => ({
    gardenId: 'garden-matouyan',
    note: '雨水青收紧失水上限',
    createdBy: '林清和',
    turnRoomTempMin: 20, turnRoomTempMax: 25,
    turnHumidityMin: 60, turnHumidityMax: 80,
    waterLossMinPct: 12, waterLossMaxPct: 14,
    shakeMinMin: 3, shakeMinMax: 12,
    fireMediumLoad: 600, fireFullLoad: 1500, fullFirePassesMin: 2,
    ...over,
  });
  const v2 = await publishStandard(draft(), matouV1?.rev ?? 1);
  check('发布后得到 v2', v2.versionNo === 2 && v2.active === true);
  const history = (await listStandards())
    .filter((s) => s.gardenId === 'garden-matouyan')
    .sort((a, b) => a.versionNo - b.versionNo);
  check('v1 仍保留留痕且已置为 inactive', history.length === 2 && history[0].active === false && history[1].active === true);

  let publishRejected = false;
  try {
    await publishStandard(draft({ note: '冲突版本' }), matouV1?.rev ?? 1);
  } catch (error) {
    publishRejected = error instanceof ConcurrencyConflictError;
  }
  check('两个标签页同时发布基准，晚到者被拒', publishRejected);

  console.log('D) 定稿冻结与基准传播');
  const pre0508 = await db.batches.get('batch-matouyan-0508');
  check('0508 定稿前未冻结', pre0508?.state === '已焙火' && pre0508.frozenJudgment === null);
  const finalized = await finalizeBatch('batch-matouyan-0508');
  check('定稿后状态=已审评、锁定 v2、冻结判定非空',
    finalized.state === '已审评' && finalized.standardVersionNo === 2 && finalized.frozenJudgment?.frozen === true);

  // 再发 v3：大幅放宽，已定稿 0508 不变；未定稿 0512 的判定随新版本变化
  const beforeFrozenLevel = finalized.frozenJudgment?.fireLevel;
  const beforeFrozenWater = finalized.frozenJudgment?.waterLoss.label;
  await publishStandard(
    draft({
      note: '再放宽',
      turnRoomTempMin: 18, turnRoomTempMax: 28,
      waterLossMinPct: 10, waterLossMaxPct: 24,
      fireMediumLoad: 300, fireFullLoad: 900, fullFirePassesMin: 1,
    }),
    v2.rev,
  );

  const j0508 = await resolve(await db.batches.get('batch-matouyan-0508') as Batch);
  const j0512 = await resolve(await db.batches.get('batch-matouyan-0512') as Batch);
  const jNiu = await resolve(await db.batches.get('batch-niulankeng-0426') as Batch);
  check('已定稿 0508 保住当时火功与失水判定', j0508.frozen === true && j0508.fireLevel === beforeFrozenLevel && j0508.waterLoss.label === beforeFrozenWater);
  check('未定稿 0512 按新基准 v3 实时判定', j0512.standardVersionNo === 3 && j0512.frozen === false);
  check('牛栏坑已定稿批次不受马头岩基准改动影响', jNiu.standardVersionNo === 1 && jNiu.frozen === true);

  if (failures > 0) {
    console.error(`\n${failures} 项校验失败`);
    process.exit(1);
  }
  console.log('\n全部 Dexie 集成校验通过');
  db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
