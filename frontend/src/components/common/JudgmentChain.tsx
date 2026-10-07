/**
 * <JudgmentChainTag> / <JudgmentChainCard>
 * 判定链展示：基准版本 → 做青失水 → 焙火火功 → 审评结论（定稿/待定稿）。
 * 已定稿批次标注冻结基准版本与「已保住当时判定」；未定稿标注当前基准版本，
 * 基准改版后这里随 useJudgmentChain 实时重算。
 */
import { Tag, Tooltip, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import GradeTag from './GradeTag';
import type { BatchVerdict } from '../../types/standard';
import { FIRE_LEVEL_COLOR, WATER_VERDICT_COLOR, WATER_VERDICT_LABEL } from '../../utils/tea';

export interface JudgmentChainTagProps {
  verdict: BatchVerdict | undefined;
  /** 是否显示定稿锁标 */
  showLock?: boolean;
}

/** 紧凑版：失水 / 火功 / 基准版本 三个标签（判定链节点） */
export function JudgmentChainTag({ verdict, showLock = true }: JudgmentChainTagProps) {
  if (!verdict) return <Tag>无判定</Tag>;
  return (
    <Tooltip
      title={
        verdict.finalized
          ? `已定稿：冻结基准 v${verdict.standardRev}，失水 ${verdict.waterLossPct}%、火功 ${verdict.fireLevel}（${verdict.fireLoad} ℃·h），基准改版不改变该结论`
          : `未定稿：按当前基准 v${verdict.standardRev} 实时判定，基准改版会自动重算失水与火功`
      }
    >
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <Tag color={WATER_VERDICT_COLOR[verdict.waterVerdict]}>
          {WATER_VERDICT_LABEL[verdict.waterVerdict]} {verdict.waterLossPct}%
        </Tag>
        <GradeTag kind="fire" value={verdict.fireLevel} showIcon={false} />
        <Tag color={verdict.finalized ? '#2f5136' : 'gold'}>
          {showLock && verdict.finalized ? <LockOutlined /> : null}
          基准 v{verdict.standardRev}
          {verdict.finalized ? ' · 已定稿' : ' · 待定稿'}
        </Tag>
      </span>
    </Tooltip>
  );
}

/** 卡片版：把基准、做青、焙火、审评四个节点串成一条链 */
export function JudgmentChainCard({ verdict }: JudgmentChainTagProps) {
  if (!verdict) {
    return <Typography.Text type="secondary">该批次暂无可显示的判定链。</Typography.Text>;
  }
  const fireColor = FIRE_LEVEL_COLOR[verdict.fireLevel];
  return (
    <div className="judgment-chain">
      <span className="judgment-node">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          基准
        </Typography.Text>
        <Tag color={verdict.finalized ? '#2f5136' : 'gold'}>
          v{verdict.standardRev}
          {verdict.finalized ? '（已冻结）' : '（当前）'}
        </Tag>
      </span>
      <span className="judgment-arrow">→</span>
      <span className="judgment-node">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          做青失水
        </Typography.Text>
        <Tag color={WATER_VERDICT_COLOR[verdict.waterVerdict]}>
          {WATER_VERDICT_LABEL[verdict.waterVerdict]} {verdict.waterLossPct}%
        </Tag>
      </span>
      <span className="judgment-arrow">→</span>
      <span className="judgment-node">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          焙火火功
        </Typography.Text>
        <Tag color={fireColor}>
          {verdict.fireLevel} · {verdict.fireLoad} ℃·h · {verdict.roastPassCount} 道
        </Tag>
      </span>
      <span className="judgment-arrow">→</span>
      <span className="judgment-node">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          审评结论
        </Typography.Text>
        {verdict.finalized ? (
          <Tag color="#2f5136">
            <LockOutlined /> 已定稿 · 保住当时判定
          </Tag>
        ) : (
          <Tag color="processing">待定稿 · 随基准重算</Tag>
        )}
      </span>
    </div>
  );
}

export default JudgmentChainTag;
