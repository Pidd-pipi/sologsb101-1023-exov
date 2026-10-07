/**
 * 端到端判定链校验（Node + fake-indexeddab + esbuild 打包运行，不属于 src，不参与 tsc）。
 * 覆盖：v2→v3 旧数据迁移补齐、乐观锁并发冲突、定稿冻结、基准改版重算/保住、拼配候选重排。
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import Dexie from 'dexie';
import { buildBatchVerdicts, buildProjectedCandidates, fireLevelFromLoad } from '../src/utils/tea';
import { DEFAULT_TURN_BASELINE } from '../src/types/standard';

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  ✅ ${name}`);
  } else {
    fail += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
async function freshFactory() {
  const factory = new IDBFactory();
  // Dexie 在打开时读取 Dexie.dependencies，显式切换才能让单例在场景间换后端
  Dexie.dependencies.indexedDB = factory;
  Dexie.dependencies.IDBKeyRange = IDBKeyRange;
  global.indexedDB = factory;
  global.IDBKeyRange = IDBKeyRange;
}

let dbm;
async function importDb() {
  if (!dbm) dbm = await import('../src/utils/db.ts');
  return dbm;
}

/* ----------------------- 场景 1：v2 → v3 迁移补齐 ----------------------- */
async function scenarioMigration() {
  console.log('场景 1：旧数据（无基准留痕）升级到 v3，按当前值补齐');
  await freshFactory();

  // 先手动建一个 v2 库并灌入旧式数据（无 standards / rev / frozen）
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('gbtearock', 2);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('gardens', { keyPath: 'id' });
      d.createObjectStore('batches', { keyPath: 'id' });
      const turns = d.createObjectStore('turns', { keyPath: 'id' });
      d.createObjectStore('fixes', { keyPath: 'id' });
      const roasts = d.createObjectStore('roasts', { keyPath: 'id' });
      const reviews = d.createObjectStore('reviews', { keyPath: 'id' });
      turns.createIndex('batchId', 'batchId', { unique: false });
      roasts.createIndex('batchId', 'batchId', { unique: false });
      reviews.createIndex('batchId', 'batchId', { unique: false });
    };
    req.onsuccess = () => {
      const d = req.result;
      const tx = d.transaction(['gardens', 'batches', 'turns', 'roasts', 'reviews'], 'readwrite');
      const stamp = '2025-01-01T00:00:00.000Z';
      tx.objectStore('gardens').put({
        id: 'g1', name: '旧山场', altitudeM: 300, soil: '砾壤', cultivar: '肉桂', aspect: '南向',
        createdAt: stamp, updatedAt: stamp,
      });
      tx.objectStore('batches').put({
        id: 'b1', gardenId: 'g1', pickedAt: '2025-05-01', freshLeafKg: 20, tenderness: '一芽三叶',
        weather: '晴', state: '已审评', createdAt: stamp, updatedAt: stamp,
      });
      tx.objectStore('turns').put({
        id: 't1', batchId: 'b1', roundNo: 1, shakeMin: 6, restMin: 50, roomTempC: 23, humidityPct: 70,
        waterLossPct: 15, createdAt: stamp, updatedAt: stamp,
      });
      tx.objectStore('roasts').put({
        id: 'r1', batchId: 'b1', passNo: 1, tempC: 110, hours: 8, charcoal: '荔枝炭', nextRoastDate: '',
        state: '已足火', createdAt: stamp, updatedAt: stamp,
      });
      tx.objectStore('roasts').put({
        id: 'r2', batchId: 'b1', passNo: 2, tempC: 120, hours: 6, charcoal: '荔枝炭', nextRoastDate: '',
        state: '已足火', createdAt: stamp, updatedAt: stamp,
      });
      tx.objectStore('reviews').put({
        id: 'rv1', batchId: 'b1', reviewedAt: '2025-07-01', aroma: 90, liquorColor: 88, taste: 89,
        leafBase: 86, totalScore: 88.7, blendNote: '', createdAt: stamp, updatedAt: stamp,
      });
      tx.oncomplete = () => { d.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  const dbm = await importDb();
  await dbm.db.open(); // 触发 v2→v3 upgrade
  const standards = await dbm.db.standards.toArray();
  check('每个山场补齐一版基准', standards.length === 1 && standards[0].rev === 1 && standards[0].isCurrent);
  check(
    '基准按内置当前值',
    standards[0].turn.waterLossMinPct === DEFAULT_TURN_BASELINE.waterLossMinPct &&
      standards[0].roast.fullLoad === 1500,
  );
  const t1 = await dbm.db.turns.get('t1');
  check('做青轮次补齐 rev=1 与 standardRev=1', t1.rev === 1 && t1.standardRev === 1);
  const r1 = await dbm.db.roasts.get('r1');
  check('焙火道次补齐 standardRev=1', r1.standardRev === 1);
  const rv1 = await dbm.db.reviews.get('rv1');
  check('审评补齐 rev=1', rv1.rev === 1);
  check('历史审评冻结快照已补齐', Boolean(rv1.frozen), JSON.stringify(rv1.frozen));
  check('冻结火功=足火（1600 ℃·h，2 道）', rv1.frozen.fireLevel === '足火' && rv1.frozen.fireLoad === 1600);
  check('冻结失水=到位（15%）', rv1.frozen.waterVerdict === 'ok' && rv1.frozen.waterLossPct === 15);
  check('冻结基准版本=1', rv1.frozen.standardRev === 1);
  await dbm.db.close();
}

/* ----------------------- 场景 2：乐观锁并发冲突 ----------------------- */
async function scenarioLock() {
  console.log('场景 2：两个标签页同时提交同一做青记录，晚到一次被拒绝');
  await freshFactory();
  const dbm = await importDb();
  await dbm.initDatabase();

  const [turn] = await dbm.db.turns.where('batchId').equals('batch-matouyan-0512').toArray();
  // 标签页 A 先提交成功
  const updatedA = await dbm.updateTurnIfCurrent(turn.id, turn.rev, { shakeMin: 7 });
  check('先到提交成功，rev +1', updatedA.rev === turn.rev + 1);
  // 标签页 B 用过期 rev 提交 → 必须被拒绝
  let conflict = null;
  try {
    await dbm.updateTurnIfCurrent(turn.id, turn.rev, { shakeMin: 99 });
  } catch (error) {
    conflict = error;
  }
  check('晚到提交抛 ConcurrentUpdateError', conflict instanceof dbm.ConcurrentUpdateError, String(conflict));
  const after = await dbm.db.turns.get(turn.id);
  check('对方刚录的做青记录未被盖掉（仍是 A 的 7 分钟）', after.shakeMin === 7, `实际 ${after.shakeMin}`);

  // 审评提交即定稿：未定稿批次提交后冻结快照并把批次推进到「已审评」
  const beforeBatch = await dbm.db.batches.get('batch-matouyan-0512');
  check('定稿前批次未到已审评', beforeBatch.state !== '已审评');
  const draft = { batchId: 'batch-matouyan-0512', reviewedAt: '2025-08-01', aroma: 88, liquorColor: 86, taste: 87, leafBase: 84, blendNote: '' };
  const saved = await dbm.submitReview({ draft });
  check('审评提交后冻结快照含基准版本', Boolean(saved.frozen) && saved.rev === 1 && saved.frozen.standardRev === 1, JSON.stringify(saved.frozen));
  const afterBatch = await dbm.db.batches.get('batch-matouyan-0512');
  check('定稿后批次回写为已审评', afterBatch.state === '已审评');

  // 两个标签页同时编辑同一审评：晚到一次（旧 rev）被拒绝
  let reviewConflict = null;
  try {
    await dbm.submitReview({ id: saved.id, draft: { ...draft, aroma: 60 }, expectedRev: saved.rev });
  } catch (error) {
    reviewConflict = error;
  }
  check('同一审评无并发时可改（rev 匹配）', reviewConflict === null, String(reviewConflict));
  let staleConflict = null;
  try {
    await dbm.submitReview({ id: saved.id, draft: { ...draft, aroma: 50 }, expectedRev: 1 });
  } catch (error) {
    staleConflict = error;
  }
  check('晚到审评提交（旧 rev=1）抛 ConcurrentUpdateError', staleConflict instanceof dbm.ConcurrentUpdateError, String(staleConflict));
  const finalReview = await dbm.db.reviews.get(saved.id);
  check('晚到审评未盖掉对方刚改的结论（香气 60 保留）', finalReview.aroma === 60 && finalReview.rev === 2, `aroma=${finalReview.aroma},rev=${finalReview.rev}`);

  await dbm.db.close();
}

/* ------------------ 场景 3：定稿冻结 + 基准改版重算/保住 + 候选重排 ------------------ */
async function scenarioChain() {
  console.log('场景 3：定稿保住当时判定，未定稿批次随新基准重算，候选重排');
  await freshFactory();
  const dbm = await importDb();
  await dbm.initDatabase();

  const loadAll = async () => ({
    batches: await dbm.db.batches.toArray(),
    turns: await dbm.db.turns.toArray(),
    roasts: await dbm.db.roasts.toArray(),
    reviews: await dbm.db.reviews.toArray(),
    standards: await dbm.db.standards.toArray(),
    gardens: await dbm.db.gardens.toArray(),
  });

  // 专用未定稿批次（挂马头岩，无审评）：失水 15%（命中马头岩 12-18%），两道焙火 975 ℃·h
  const stamp = new Date().toISOString();
  const pendingId = 'batch-pending-matou';
  await dbm.db.batches.put({
    id: pendingId, gardenId: 'garden-matouyan', pickedAt: '2025-05-20', freshLeafKg: 18,
    tenderness: '一芽三叶', weather: '多云', state: '已焙火', createdAt: stamp, updatedAt: stamp,
  });
  await dbm.db.turns.bulkPut([
    { id: 'pt1', batchId: pendingId, roundNo: 1, shakeMin: 6, restMin: 50, roomTempC: 23, humidityPct: 70, waterLossPct: 7, rev: 1, standardRev: 1, createdAt: stamp, updatedAt: stamp },
    { id: 'pt2', batchId: pendingId, roundNo: 2, shakeMin: 8, restMin: 60, roomTempC: 24, humidityPct: 68, waterLossPct: 15, rev: 1, standardRev: 1, createdAt: stamp, updatedAt: stamp },
  ]);
  await dbm.db.roasts.bulkPut([
    { id: 'pr1', batchId: pendingId, passNo: 1, tempC: 95, hours: 5, charcoal: '荔枝炭', nextRoastDate: '', state: '已足火', standardRev: 1, createdAt: stamp, updatedAt: stamp },
    { id: 'pr2', batchId: pendingId, passNo: 2, tempC: 100, hours: 5, charcoal: '荔枝炭', nextRoastDate: '', state: '已足火', standardRev: 1, createdAt: stamp, updatedAt: stamp },
  ]);

  let data = await loadAll();
  let verdicts = buildBatchVerdicts(data);
  const finalizedIds = data.reviews.map((r) => r.batchId);

  // 已定稿（有审评）批次
  const niu = verdicts.get('batch-niulankeng-0426');
  check('牛栏坑已定稿', niu.finalized === true);
  check('牛栏坑冻结 v1 火功=足火', niu.fireLevel === '足火' && niu.standardRev === 1);
  const hui = verdicts.get('batch-huiyuankeng-0503');
  check('慧苑坑已定稿且冻结 v1（失水 17.2% 命中慧苑 10-20%）', hui.finalized && hui.waterVerdict === 'ok');

  // 未定稿批次：马头岩当前基准 medium 600/full 1600，975 ℃·h → 中火，失水 15% → ok
  const pending = verdicts.get(pendingId);
  check('专用批次未定稿，按当前基准实时判定', pending.finalized === false);
  check('专用批次火功=中火（975 ℃·h，足火阈值 1600）', pending.fireLevel === '中火', pending.fireLevel);
  check('专用批次失水 15% 命中马头岩 12-18%', pending.waterVerdict === 'ok');
  let projected = buildProjectedCandidates(verdicts, data.batches, data.gardens);
  check('出现待定稿投影候选（含专用批次）', projected.some((p) => p.batchId === pendingId), JSON.stringify(projected.map((p) => p.batchId)));
  check('投影候选按投影分降序', projected.every((p, i) => i === 0 || projected[i - 1].projectedScore >= p.projectedScore));
  const scoreAtMedium = projected.find((p) => p.batchId === pendingId)?.projectedScore ?? 0;

  // 0512：未定稿、无焙火、失水 10.8% 低于马头岩下限 12% → low
  const matou0512 = verdicts.get('batch-matouyan-0512');
  check('马头岩 0512 未定稿且失水 low（10.8% < 12%）', matou0512.finalized === false && matou0512.waterVerdict === 'low', matou0512.waterVerdict);

  // —— 牛栏坑基准改版：足火阈值抬到 1800，失水上限收紧到 14
  await dbm.publishStandard('garden-niulankeng', {
    turn: { ...DEFAULT_TURN_BASELINE, waterLossMaxPct: 14 },
    roast: { mediumLoad: 600, fullLoad: 1800, fullMinPasses: 2 },
    changeNote: '改版测试',
  });
  data = await loadAll();
  verdicts = buildBatchVerdicts(data);

  const niu2 = verdicts.get('batch-niulankeng-0426');
  check('【已定稿】牛栏坑仍保住当时判定：足火 + v1', niu2.fireLevel === '足火' && niu2.standardRev === 1, `v${niu2.standardRev}/${niu2.fireLevel}`);
  check('【已定稿】失水结论冻结为 ok（15.6% 按旧 12-20）', niu2.waterVerdict === 'ok', niu2.waterVerdict);
  check('【已定稿】冻结热负荷仍是 1600', niu2.fireLoad === 1600);

  const currentNiu = data.standards.find((s) => s.gardenId === 'garden-niulankeng' && s.isCurrent);
  check('牛栏坑基准升到 v2，v1 转为历史', currentNiu.rev === 2 && data.standards.filter((s) => s.gardenId === 'garden-niulankeng').length === 2);

  const huiCurrent = data.standards.find((s) => s.gardenId === 'garden-huiyuankeng' && s.isCurrent);
  check('慧苑坑基准仍是 v1（改版只影响目标山场）', huiCurrent.rev === 1);

  // —— 马头岩基准改版：失水下限降到 8、中火阈值降到 560、足火阈值降到 900
  await dbm.publishStandard('garden-matouyan', {
    turn: { ...DEFAULT_TURN_BASELINE, waterLossMinPct: 8, waterLossMaxPct: 18 },
    roast: { mediumLoad: 560, fullLoad: 900, fullMinPasses: 2 },
    changeNote: '马头岩改版测试',
  });
  data = await loadAll();
  verdicts = buildBatchVerdicts(data);

  const pending2 = verdicts.get(pendingId);
  check('【未定稿】专用批次切到 v2，975 ℃·h 在足火阈值 900 下升为足火', pending2.standardRev === 2 && pending2.fireLevel === '足火', `${pending2.standardRev}/${pending2.fireLevel}`);
  const m0512v2 = verdicts.get('batch-matouyan-0512');
  check('【未定稿】马头岩 0512 失水按新下限 8% 重算为 ok，standardRev=2', m0512v2.waterVerdict === 'ok' && m0512v2.standardRev === 2, JSON.stringify({ w: m0512v2.waterVerdict, rev: m0512v2.standardRev }));

  const projected2 = buildProjectedCandidates(verdicts, data.batches, data.gardens);
  check('火功由中火升足火后投影分上升并重排', (projected2.find((p) => p.batchId === pendingId)?.projectedScore ?? 0) > scoreAtMedium);
  check('0512 失水到位但无焙火，仍不进投影候选', !projected2.some((p) => p.batchId === 'batch-matouyan-0512'));
  check('已定稿批次不进入待定稿投影候选', projected2.every((p) => !finalizedIds.includes(p.batchId)));

  // 纯函数自检：火功档位随基准切换
  check('同一热负荷 1600 在 1500 阈值下足火、在 1800 阈值下中火', fireLevelFromLoad(1600, { mediumLoad: 600, fullLoad: 1800, fullMinPasses: 2 }) === '中火');
  await dbm.db.close();
}

const SCENARIOS: Record<string, () => Promise<void>> = {
  migration: scenarioMigration,
  lock: scenarioLock,
  chain: scenarioChain,
};

async function main() {
  const which = process.argv[2];
  if (which) {
    await SCENARIOS[which]();
  } else {
    await scenarioMigration();
    await scenarioLock();
    await scenarioChain();
  }
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  if (fail > 0) process.exit(1);
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
