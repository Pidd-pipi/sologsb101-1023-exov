/**
 * 判定链核心逻辑的运行时校验（不依赖 IndexedDB）：
 * 1) 基准改动 → 未定稿批次失水 / 火功重算；已定稿读冻结值不变；
 * 2) 贴合度随基准变化，拼配候选次序跟着重排；
 * 3) 区间 / 足火判定全部取基准参数。
 */
import {
  buildProcessJudgment,
  conformanceScoreOf,
  judgeWaterLossByStandard,
  fireLevelByStandard,
  isFullFireByStandard,
  clampStandardParams,
} from '../src/utils/standard';
import { DEFAULT_STANDARD_PARAMS, type ProcessStandard, type StandardParams } from '../src/types/standard';
import type { Turn } from '../src/types/turn';
import type { Roast } from '../src/types/roast';
import { buildBlendCandidates } from '../src/utils/tea';
import type { Batch } from '../src/types/batch';
import type { Garden } from '../src/types/garden';
import type { Review } from '../src/types/review';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function standard(gardenId: string, versionNo: number, params: Partial<StandardParams>): ProcessStandard {
  return {
    id: `standard-${gardenId}-v${versionNo}`,
    gardenId,
    versionNo,
    active: true,
    note: `v${versionNo}`,
    createdBy: 'tester',
    rev: 1,
    ...{ ...DEFAULT_STANDARD_PARAMS, ...params },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  };
}

const turns: Turn[] = [
  { id: 't1', batchId: 'b', roundNo: 1, shakeMin: 5, restMin: 45, roomTempC: 23, humidityPct: 72, waterLossPct: 9, rev: 1, createdAt: '', updatedAt: '' },
  { id: 't2', batchId: 'b', roundNo: 2, shakeMin: 7, restMin: 50, roomTempC: 24, humidityPct: 70, waterLossPct: 16, rev: 1, createdAt: '', updatedAt: '' },
];
const roasts: Roast[] = [
  { id: 'r1', batchId: 'b', passNo: 1, tempC: 110, hours: 8, charcoal: '荔枝炭', nextRoastDate: '', state: '已足火', rev: 1, createdAt: '', updatedAt: '' },
  { id: 'r2', batchId: 'b', passNo: 2, tempC: 120, hours: 6, charcoal: '荔枝炭', nextRoastDate: '', state: '已足火', rev: 1, createdAt: '', updatedAt: '' },
];

const v1 = standard('g', 1, {});
const v2 = standard('g', 2, { waterLossMaxPct: 15, fireFullLoad: 1800, fullFirePassesMin: 3 });

console.log('1) 基准改动 → 未定稿批次重算');
const j1 = buildProcessJudgment({ standard: v1, turns, roasts });
const j2 = buildProcessJudgment({ standard: v2, turns, roasts });
check('v1 失水 16% 在 12-20 区间判 ok', j1.waterLoss.level === 'ok');
check('v2 收紧到 15 上限后 16% 判 high（失水偏多）', j2.waterLoss.level === 'high');
check('v1 热负荷 1600 ≥ 1500 且 2 道 → 足火', j1.fireLevel === '足火' && j1.fullFire === true);
check('v2 足火阈值 1800 / 3 道 → 掉为中火、未达足火', j2.fireLevel === '中火' && j2.fullFire === false);
check('贴合度随基准变化（v2 更严，分数更低）', j2.conformanceScore < j1.conformanceScore, `${j1.conformanceScore} -> ${j2.conformanceScore}`);

console.log('2) 已定稿冻结判定不被新基准改写');
const frozenAt = buildProcessJudgment({ standard: v1, turns, roasts, frozen: true, finalizedAt: '2025-07-26' });
const batch: Batch = {
  id: 'b', gardenId: 'g', pickedAt: '2025-05-01', freshLeafKg: 20, tenderness: '一芽三叶', weather: '',
  state: '已审评', standardVersionNo: 1, finalizedAt: '2025-07-26', frozenJudgment: frozenAt, turnsRev: 1, roastsRev: 1,
  createdAt: '', updatedAt: '',
};
const garden: Garden = { id: 'g', name: '测试山场', altitudeM: 300, soil: '砾壤', cultivar: '肉桂', aspect: '南', createdAt: '', updatedAt: '' };
const review: Review = {
  id: 'rv', batchId: 'b', reviewedAt: '2025-07-26', aroma: 90, liquorColor: 90, taste: 90, leafBase: 90,
  totalScore: 90, blendNote: '', createdAt: '', updatedAt: '',
};
// 模拟 useProcessJudgment 的解析规则：定稿读 frozenJudgment
const resolved = batch.state === '已审评' && batch.frozenJudgment ? batch.frozenJudgment : j2;
check('定稿后即使 active 换成 v2，仍保住 v1 的足火判定', resolved.fireLevel === '足火' && resolved.frozen === true);

console.log('3) 拼配候选随基准重排（同总分按贴合度）');
const mk = (id: string, conf: number, frozen: boolean): Review => ({ ...review, id: `rv-${id}`, batchId: id });
const batches: Batch[] = ['b1', 'b2'].map((id) => ({
  ...batch, id, frozenJudgment: null, state: '已焙火', standardVersionNo: null, finalizedAt: null,
}));
const reviews: Review[] = [mk('b1', 0, false), mk('b2', 0, false)];
reviews[0].totalScore = 90;
reviews[1].totalScore = 90;
const judgments: Record<string, ReturnType<typeof buildProcessJudgment>> = {
  b1: { ...j2, conformanceScore: 60 },
  b2: { ...j2, conformanceScore: 88 },
};
const ranked = buildBlendCandidates(reviews, batches, [garden], judgments);
check('同总分 90：贴合度 88 的 b2 排在 60 的 b1 前', ranked[0].batchId === 'b2' && ranked[1].batchId === 'b1');
// 基准再改 → 贴合度反转 → 候选重排
judgments.b1.conformanceScore = 95;
const ranked2 = buildBlendCandidates(reviews, batches, [garden], judgments);
check('基准改动使 b1 贴合度反超后，b1 排到首位', ranked2[0].batchId === 'b1');

console.log('4) 迁移兜底：参数截断与区间判定');
const clamped = clampStandardParams({ waterLossMinPct: -99, waterLossMaxPct: 999, fireFullLoad: 10 });
check('非法值截断到合法区间', clamped.waterLossMinPct === 0 && clamped.waterLossMaxPct === 40);
check('失水 12% 在兜底 12-20 判 ok（老数据按当前值补齐的语义）', judgeWaterLossByStandard(12, DEFAULT_STANDARD_PARAMS).level === 'ok');
check('足火阈值 0 的极端基准：任何热负荷都判足火', fireLevelByStandard(roasts, { ...DEFAULT_STANDARD_PARAMS, fireFullLoad: 0 }) === '足火');
check('3 道要求下 2 道不达标', isFullFireByStandard(roasts, { ...DEFAULT_STANDARD_PARAMS, fullFirePassesMin: 3 }) === false);
check('conformanceScore 命中区间+足火为高分', conformanceScoreOf(turns, roasts, DEFAULT_STANDARD_PARAMS) >= 90);

if (failures > 0) {
  console.error(`\n${failures} 项校验失败`);
  process.exit(1);
}
console.log('\n全部判定链逻辑校验通过');
