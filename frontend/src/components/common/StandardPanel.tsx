/**
 * <StandardPanel> 山场做青 / 焙火基准管理
 * 展示某山场当前生效基准与历史版本留痕，并支持「改版发布」：
 * 旧当前版本转为历史（isCurrent=false），追加一条 rev+1 的新当前版本。
 * 发布后判定链自动重算 —— 未定稿批次按新基准重算失水与火功，已定稿批次保住冻结判定。
 */
import { useMemo, useState } from 'react';
import { App, Button, Form, Input, InputNumber, Modal, Space, Tag, Timeline, Typography } from 'antd';
import { EditOutlined, HistoryOutlined } from '@ant-design/icons';
import type { Garden } from '../../types/garden';
import {
  DEFAULT_ROAST_BASELINE,
  DEFAULT_TURN_BASELINE,
  STANDARD_LIMITS,
  type GardenStandard,
  type StandardDraft,
} from '../../types/standard';
import { useStandardStore, selectCurrentStandard, selectStandardHistory } from '../../stores/standardStore';

export interface StandardPanelProps {
  garden: Garden;
}

export default function StandardPanel({ garden }: StandardPanelProps) {
  const { message } = App.useApp();
  const [form] = Form.useForm<StandardDraft>();
  const standards = useStandardStore((state) => state.standards);
  const publishStandard = useStandardStore((state) => state.publishStandard);

  const [modalOpen, setModalOpen] = useState(false);

  const current = useMemo(() => selectCurrentStandard(standards, garden.id), [standards, garden.id]);
  const history = useMemo(() => selectStandardHistory(standards, garden.id), [standards, garden.id]);
  const baseline = current ?? { turn: DEFAULT_TURN_BASELINE, roast: DEFAULT_ROAST_BASELINE };

  const openModal = (): void => {
    form.setFieldsValue({
      turn: { ...baseline.turn },
      roast: { ...baseline.roast },
      changeNote: '',
    });
    setModalOpen(true);
  };

  const submit = async (values: StandardDraft): Promise<void> => {
    try {
      const next = await publishStandard(garden.id, values);
      message.success(
        `已发布「${garden.name}」第 ${next.rev} 版基准：未定稿批次按新基准重算失水与火功，已定稿批次保住当时判定`,
      );
      setModalOpen(false);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '基准改版失败');
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 10, justifyContent: 'space-between', width: '100%' }}>
        <Typography.Text strong>
          做青 / 焙火基准
          {current ? <Tag color="#2f5136" style={{ marginLeft: 8 }}>当前 v{current.rev}</Tag> : <Tag style={{ marginLeft: 8 }}>无留痕</Tag>}
        </Typography.Text>
        <Button size="small" type="primary" icon={<EditOutlined />} onClick={openModal}>
          改版基准
        </Button>
      </Space>

      <div className="standard-version-card is-current" style={{ marginBottom: 12 }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Text style={{ fontSize: 12 }}>
            做青：室温 {baseline.turn.roomTempMinC}-{baseline.turn.roomTempMaxC} ℃ ｜ 湿度 {baseline.turn.humidityMinPct}-
            {baseline.turn.humidityMaxPct}% ｜ 全程失水 {baseline.turn.waterLossMinPct}-{baseline.turn.waterLossMaxPct}% ｜ 摇青基准{' '}
            {baseline.turn.shakeBaseMin} 分钟
          </Typography.Text>
          <Typography.Text style={{ fontSize: 12 }}>
            焙火：中火 {baseline.roast.mediumLoad} ℃·h ｜ 足火 {baseline.roast.fullLoad} ℃·h ｜ 足火至少 {baseline.roast.fullMinPasses} 道
          </Typography.Text>
          {current?.changeNote ? (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              改版说明：{current.changeNote}
            </Typography.Text>
          ) : null}
        </Space>
      </div>

      {history.length > 1 ? (
        <Timeline
          items={history.map((standard: GardenStandard) => ({
            color: standard.isCurrent ? 'green' : 'gray',
            children: (
              <Space direction="vertical" size={0}>
                <Space size={6}>
                  <strong>v{standard.rev}</strong>
                  {standard.isCurrent ? <Tag color="green">当前</Tag> : <Tag>历史</Tag>}
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    失水 {standard.turn.waterLossMinPct}-{standard.turn.waterLossMaxPct}% · 足火 {standard.roast.fullLoad} ℃·h
                  </Typography.Text>
                </Space>
                {standard.changeNote ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {standard.changeNote}
                  </Typography.Text>
                ) : null}
              </Space>
            ),
          }))}
        />
      ) : (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          <HistoryOutlined /> 暂无历史版本，改版后此处会保留每版基准留痕。
        </Typography.Text>
      )}

      <Modal
        open={modalOpen}
        title={`改版基准 · ${garden.name}`}
        okText="发布新版本"
        cancelText="取消"
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={(values: StandardDraft) => void submit(values)}>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            发布后旧版本转为历史留痕，未定稿批次立即按新基准重算失水与火功；已定稿（已审评）批次冻结在当时版本，不受影响。
          </Typography.Paragraph>
          <Typography.Text strong>做青基准</Typography.Text>
          <Space wrap style={{ display: 'flex', marginTop: 8 }}>
            <Form.Item
              label="室温下限 ℃"
              name={['turn', 'roomTempMinC']}
              rules={[{ type: 'number', min: STANDARD_LIMITS.roomTempC.min, max: STANDARD_LIMITS.roomTempC.max }]}
            >
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              label="室温上限 ℃"
              name={['turn', 'roomTempMaxC']}
              rules={[{ type: 'number', min: STANDARD_LIMITS.roomTempC.min, max: STANDARD_LIMITS.roomTempC.max }]}
            >
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              label="湿度下限 %"
              name={['turn', 'humidityMinPct']}
              rules={[{ type: 'number', min: STANDARD_LIMITS.humidityPct.min, max: STANDARD_LIMITS.humidityPct.max }]}
            >
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              label="湿度上限 %"
              name={['turn', 'humidityMaxPct']}
              rules={[{ type: 'number', min: STANDARD_LIMITS.humidityPct.min, max: STANDARD_LIMITS.humidityPct.max }]}
            >
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              label="失水下限 %"
              name={['turn', 'waterLossMinPct']}
              rules={[{ type: 'number', min: STANDARD_LIMITS.waterLossPct.min, max: STANDARD_LIMITS.waterLossPct.max }]}
            >
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              label="失水上限 %"
              name={['turn', 'waterLossMaxPct']}
              rules={[{ type: 'number', min: STANDARD_LIMITS.waterLossPct.min, max: STANDARD_LIMITS.waterLossPct.max }]}
            >
              <InputNumber style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              label="单轮摇青基准(分)"
              name={['turn', 'shakeBaseMin']}
              rules={[{ type: 'number', min: STANDARD_LIMITS.shakeBaseMin.min, max: STANDARD_LIMITS.shakeBaseMin.max }]}
            >
              <InputNumber style={{ width: 130 }} />
            </Form.Item>
          </Space>

          <Typography.Text strong>焙火基准</Typography.Text>
          <Space wrap style={{ display: 'flex', marginTop: 8 }}>
            <Form.Item
              label="中火阈值 ℃·h"
              name={['roast', 'mediumLoad']}
              rules={[{ type: 'number', min: STANDARD_LIMITS.fireLoad.min, max: STANDARD_LIMITS.fireLoad.max }]}
            >
              <InputNumber style={{ width: 130 }} />
            </Form.Item>
            <Form.Item
              label="足火阈值 ℃·h"
              name={['roast', 'fullLoad']}
              rules={[{ type: 'number', min: STANDARD_LIMITS.fireLoad.min, max: STANDARD_LIMITS.fireLoad.max }]}
            >
              <InputNumber style={{ width: 130 }} />
            </Form.Item>
            <Form.Item
              label="足火最少道次"
              name={['roast', 'fullMinPasses']}
              rules={[{ type: 'number', min: STANDARD_LIMITS.fullMinPasses.min, max: STANDARD_LIMITS.fullMinPasses.max }]}
            >
              <InputNumber style={{ width: 130 }} />
            </Form.Item>
          </Space>

          <Form.Item label="改版说明" name="changeNote" rules={[{ max: 80, message: '改版说明不超过 80 个字' }]}>
            <Input placeholder="例如 今年青叶偏嫩，失水下限下调到 10%" allowClear />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
