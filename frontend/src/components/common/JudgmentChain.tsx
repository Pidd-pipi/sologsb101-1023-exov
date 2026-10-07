/**
 * <JudgmentChain> 判定链：基准（版本）→ 做青失水 / 焙火火功 → 审评结论（定稿与否）。
 * 未定稿标注「跟随当前基准实时判定」；已定稿标注「已定稿 · 锁定 vN，判定冻结」。
 * 被做青页、焙火页、审评页、拼配页与山场详情消费。
 */
import { Tag, Tooltip, Typography } from 'antd';
import { LockOutlined, SyncOutlined } from '@ant-design/icons';
import type { ProcessJudgment } from '../../types/standard';
import { FIRE_LEVEL_COLOR } from '../../utils/tea';

export interface JudgmentChainProps {
  judgment: ProcessJudgment | undefined;
  /** 审评结论文案（已审评批次传入，例如「91.2 分 · 一级 · 拼配候选」） */
  conclusion?: string;
  /** 紧凑模式：只渲染一行关键标签 */
  compact?: boolean;
}

const VERDICT_COLOR = { low: 'blue', ok: 'green', high: 'orange' } as const;

export function JudgmentChain({ judgment, conclusion, compact = false }: JudgmentChainProps) {
  if (!judgment) {
    return <Typography.Text type="secondary">判定链：暂无基准与工艺数据</Typography.Text>;
  }

  const versionTag = judgment.frozen ? (
    <Tooltip title={`定稿时间：${judgment.finalizedAt ?? '—'}；基准改动不会重算本批次`}>
      <Tag icon={<LockOutlined />} color="gold">
        已定稿 · 基准 v{judgment.standardVersionNo ?? '—'} 已冻结
      </Tag>
    </Tooltip>
  ) : (
    <Tooltip title="未定稿：基准一改动，失水与火功判定立即按新基准重算">
      <Tag icon={<SyncOutlined />} color="processing">
        跟随基准 v{judgment.standardVersionNo ?? '—'} 实时判定
      </Tag>
    </Tooltip>
  );

  if (compact) {
    return (
      <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {versionTag}
        <Tag color={VERDICT_COLOR[judgment.waterLoss.level]}>失水 {judgment.finalWaterLossPct}% · {judgment.waterLoss.label}</Tag>
        <Tag color={FIRE_LEVEL_COLOR[judgment.fireLevel]}>
          {judgment.fireLevel} {judgment.fireLoad}℃·h
        </Tag>
        {conclusion ? <Tag color="volcano">{conclusion}</Tag> : null}
      </span>
    );
  }

  return (
    <div className="judgment-chain" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          判定链：
        </Typography.Text>
        {versionTag}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {judgment.standardNote}
        </Typography.Text>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Tag color={VERDICT_COLOR[judgment.waterLoss.level]}>
          做青失水 {judgment.finalWaterLossPct}% · {judgment.waterLoss.label}
        </Tag>
        {judgment.roomTemp ? <Tag color={VERDICT_COLOR[judgment.roomTemp.level]}>室温 · {judgment.roomTemp.label}</Tag> : null}
        {judgment.humidity ? <Tag color={VERDICT_COLOR[judgment.humidity.level]}>湿度 · {judgment.humidity.label}</Tag> : null}
        <Tag color={FIRE_LEVEL_COLOR[judgment.fireLevel]}>
          焙火 {judgment.fireLevel}（累计 {judgment.fireLoad}℃·h{judgment.fullFire ? ' · 足火达标' : ''}）
        </Tag>
        <Tooltip title="失水命中目标 60 分 + 达到基准足火 40 分；拼配候选在总分相近时按此重排">
          <Tag>工艺贴合度 {judgment.conformanceScore}</Tag>
        </Tooltip>
        {conclusion ? <Tag color="volcano">审评结论：{conclusion}</Tag> : null}
      </div>
    </div>
  );
}

export default JudgmentChain;
