/**
 * /standards 山场工艺基准
 * - 每个山场一份做青（室温 / 湿度 / 失水 / 摇青区间）+ 焙火（中火 / 足火热负荷阈值）基准
 * - 基准版本化留痕：发布即生成 vN+1，旧版本保留可查；同一山场仅一条生效
 * - 发布前显示影响面：未定稿批次按新基准重算失水与火功，已定稿批次保住当时判定
 * - 两个标签页同时发布：晚到者 rev 不匹配，提示已被别人更新
 */
import { useMemo, useState, useEffect } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Tag,
  Timeline,
  Typography,
  Alert,
} from 'antd';
import { HistoryOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import StatBadge from '../components/common/StatBadge';
import EmptyPanel from '../components/common/EmptyPanel';
import { useGardenStore } from '../stores/gardenStore';
import { useBatchStore } from '../stores/batchStore';
import { activeStandardOf, standardHistoryOf, standardImpact, useStandardStore } from '../stores/standardStore';
import { ConcurrencyConflictError } from '../utils/db';
import { STANDARD_LIMITS, type ProcessStandard, type StandardDraft, type StandardParams } from '../types/standard';
import { clampStandardParams } from '../utils/standard';

type StandardFormValues = Omit<StandardDraft, 'gardenId'>;

export default function StandardBoard() {
  const { message } = App.useApp();
  const [form] = Form.useForm<StandardFormValues>();

  const gardens = useGardenStore((state) => state.gardens);
  const batches = useBatchStore((state) => state.batches);
  const loadGardens = useGardenStore((state) => state.loadGardens);
  const loadBatches = useBatchStore((state) => state.loadBatches);

  const standards = useStandardStore((state) => state.standards);
  const loading = useStandardStore((state) => state.loading);
  const loadStandards = useStandardStore((state) => state.loadStandards);
  const publishStandard = useStandardStore((state) => state.publishStandard);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingGardenId, setEditingGardenId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** 打开发布弹窗时读到的基准 rev，提交时做乐观锁比对 */
  const [expectedRev, setExpectedRev] = useState(1);

  useEffect(() => {
    void Promise.all([loadGardens(), loadBatches(), loadStandards()]);
  }, [loadBatches, loadGardens, loadStandards]);

  const activeByGarden = useMemo(() => {
    const map = new Map<string, ProcessStandard>();
    gardens.forEach((garden) => {
      const active = activeStandardOf(standards, garden.id);
      if (active) map.set(garden.id, active);
    });
    return map;
  }, [gardens, standards]);

  const totalVersions = standards.length;
  const avgVersion =
    gardens.length > 0 ? Math.round((totalVersions / Math.max(1, gardens.length)) * 10) / 10 : 0;

  const openPublishModal = (gardenId: string): void => {
    const active = activeStandardOf(standards, gardenId);
    setEditingGardenId(gardenId);
    setExpectedRev(active?.rev ?? 1);
    setModalOpen(true);
    form.setFieldsValue({
      ...(active ? pickParams(active) : clampStandardParams({})),
      note: '',
      createdBy: active?.createdBy ?? '',
    });
  };

  const editingGarden = gardens.find((garden) => garden.id === editingGardenId) ?? null;
  const impact = editingGardenId ? standardImpact(batches, editingGardenId) : null;

  const submit = async (values: StandardFormValues): Promise<void> => {
    if (!editingGardenId) return;
    setSubmitting(true);
    try {
      const draft: StandardDraft = {
        ...clampStandardParams(values),
        gardenId: editingGardenId,
        note: values.note.trim() || '车间基准调整',
        createdBy: values.createdBy.trim() || '未署名',
      };
      const published = await publishStandard(draft, expectedRev);
      message.success(`已发布 v${published.versionNo}：未定稿批次将按新基准重算失水与火功，已定稿批次判定不变`);
      setModalOpen(false);
      setEditingGardenId(null);
    } catch (error) {
      if (error instanceof ConcurrencyConflictError) {
        message.error(error.message);
        await loadStandards();
        if (editingGardenId) {
          const latest = activeStandardOf(useStandardStore.getState().standards, editingGardenId);
          if (latest) {
            setExpectedRev(latest.rev);
            form.setFieldsValue(pickParams(latest));
          }
        }
      } else {
        message.error(error instanceof Error ? error.message : '基准发布失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (gardens.length === 0) {
    return (
      <EmptyPanel
        title="还没有山场"
        description="先到「山场与批次台账」建山场；系统会在首个批次登记时按车间当前值自动补 v1 基准。"
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>
            山场工艺基准
          </Typography.Title>
          <div className="page-hint">
            每个山场一份做青与焙火基准：基准一改，未定稿批次按新版本重算失水与火功，已定稿批次保住当时判定，拼配候选跟着重排。
          </div>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => void loadStandards()} loading={loading}>
            刷新
          </Button>
        </Space>
      </div>

      <div className="stat-row">
        <StatBadge label="山场基准" value={gardens.length} suffix="份" tone="primary" />
        <StatBadge label="历史版本合计" value={totalVersions} suffix="个" tone="info" />
        <StatBadge label="平均版本号" value={avgVersion} suffix="" />
        <StatBadge label="未定稿批次" value={batches.filter((b) => b.state !== '已审评').length} suffix="个" tone="warning" hint="基准改动后实时重算" />
        <StatBadge label="已定稿批次" value={batches.filter((b) => b.state === '已审评').length} suffix="个" tone="success" hint="判定冻结，不随基准变" />
      </div>

      <Row gutter={[14, 14]}>
        {gardens.map((garden) => {
          const active = activeByGarden.get(garden.id);
          const history = standardHistoryOf(standards, garden.id);
          const gardenImpact = standardImpact(batches, garden.id);
          return (
            <Col key={garden.id} xs={24} xl={12}>
              <Card
                className="panel-card"
                title={
                  <Space size={8} wrap>
                    <span>{garden.name}</span>
                    <Tag color="magenta">{garden.cultivar}</Tag>
                    {active ? <Tag color="green">当前 v{active.versionNo}</Tag> : <Tag color="red">缺基准</Tag>}
                  </Space>
                }
                extra={
                  <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => openPublishModal(garden.id)}>
                    调整基准 / 发新版本
                  </Button>
                }
              >
                {!active ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="该山场还没有基准，点右上角按当前值建 v1"
                  />
                ) : (
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <ParamGrid active={active} />
                    <Space size={8} wrap>
                      <Tag color="processing">改动将重算 {gardenImpact.affectedBatchIds.length} 个未定稿批次</Tag>
                      <Tag color="gold">{gardenImpact.frozenBatchIds.length} 个已定稿批次判定冻结</Tag>
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      v{active.versionNo} 说明：{active.note}（{active.createdBy}）
                    </Typography.Text>

                    <div>
                      <Space size={6} style={{ marginBottom: 6 }}>
                        <HistoryOutlined />
                        <Typography.Text strong style={{ fontSize: 13 }}>
                          版本留痕（{history.length}）
                        </Typography.Text>
                      </Space>
                      <Timeline
                        items={history.slice(0, 5).map((row) => ({
                          color: row.active ? 'green' : 'gray',
                          children: (
                            <Space size={8} wrap style={{ fontSize: 12 }}>
                              <strong>v{row.versionNo}</strong>
                              {row.active ? <Tag color="green" style={{ marginInlineEnd: 0 }}>生效中</Tag> : <Tag>已停用</Tag>}
                              <span>失水 {row.waterLossMinPct}-{row.waterLossMaxPct}%</span>
                              <span>足火 ≥{row.fireFullLoad}℃·h/{row.fullFirePassesMin} 道</span>
                              <Typography.Text type="secondary">{row.note}</Typography.Text>
                            </Space>
                          ),
                        }))}
                      />
                    </div>
                  </Space>
                )}
              </Card>
            </Col>
          );
        })}
      </Row>

      <Modal
        open={modalOpen}
        title={editingGarden ? `调整基准 · ${editingGarden.name}（发布新版本，旧版留痕）` : '发布基准'}
        okText="发布新版本"
        cancelText="取消"
        confirmLoading={submitting}
        width={720}
        onCancel={() => {
          setModalOpen(false);
          setEditingGardenId(null);
        }}
        onOk={() => form.submit()}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={(values: StandardFormValues) => void submit(values)}>
          {impact ? (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 14 }}
              message={`发布后：${impact.affectedBatchIds.length} 个未定稿批次立即按新基准重算失水与火功；${impact.frozenBatchIds.length} 个已定稿批次保住当时判定不变。`}
            />
          ) : null}
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            做青基准
          </Typography.Title>
          <Row gutter={12}>
            <Col span={12}>
              <StandardNumberItem label="室温下限（℃）" name="turnRoomTempMin" limit={STANDARD_LIMITS.turnRoomTempMin} />
            </Col>
            <Col span={12}>
              <StandardNumberItem label="室温上限（℃）" name="turnRoomTempMax" limit={STANDARD_LIMITS.turnRoomTempMax} />
            </Col>
            <Col span={12}>
              <StandardNumberItem label="湿度下限（%）" name="turnHumidityMin" limit={STANDARD_LIMITS.turnHumidityMin} />
            </Col>
            <Col span={12}>
              <StandardNumberItem label="湿度上限（%）" name="turnHumidityMax" limit={STANDARD_LIMITS.turnHumidityMax} />
            </Col>
            <Col span={12}>
              <StandardNumberItem label="失水率目标下限（%）" name="waterLossMinPct" limit={STANDARD_LIMITS.waterLossMinPct} />
            </Col>
            <Col span={12}>
              <StandardNumberItem label="失水率目标上限（%）" name="waterLossMaxPct" limit={STANDARD_LIMITS.waterLossMaxPct} />
            </Col>
            <Col span={12}>
              <StandardNumberItem label="单轮摇青下限（分钟）" name="shakeMinMin" limit={STANDARD_LIMITS.shakeMinMin} />
            </Col>
            <Col span={12}>
              <StandardNumberItem label="单轮摇青上限（分钟）" name="shakeMinMax" limit={STANDARD_LIMITS.shakeMinMax} />
            </Col>
          </Row>

          <Typography.Title level={5}>焙火基准</Typography.Title>
          <Row gutter={12}>
            <Col span={8}>
              <StandardNumberItem label="中火阈值（℃·h）" name="fireMediumLoad" limit={STANDARD_LIMITS.fireMediumLoad} step={10} />
            </Col>
            <Col span={8}>
              <StandardNumberItem label="足火阈值（℃·h）" name="fireFullLoad" limit={STANDARD_LIMITS.fireFullLoad} step={10} />
            </Col>
            <Col span={8}>
              <StandardNumberItem label="足火最少道次" name="fullFirePassesMin" limit={STANDARD_LIMITS.fullFirePassesMin} step={1} />
            </Col>
          </Row>

          <Form.Item
            label="本次改动说明"
            name="note"
            rules={[{ required: true, message: '请填写改动说明，便于版本留痕回溯' }, { max: 60, message: '不超过 60 字' }]}
          >
            <Input placeholder="例如 春茶雨水青，收紧失水上限到 19%" allowClear />
          </Form.Item>
          <Form.Item label="定稿人" name="createdBy" rules={[{ required: true, message: '请填写定稿人' }, { max: 20 }]}>
            <Input placeholder="例如 陈水金" allowClear />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function pickParams(active: ProcessStandard): StandardFormValues {
  return {
    turnRoomTempMin: active.turnRoomTempMin,
    turnRoomTempMax: active.turnRoomTempMax,
    turnHumidityMin: active.turnHumidityMin,
    turnHumidityMax: active.turnHumidityMax,
    waterLossMinPct: active.waterLossMinPct,
    waterLossMaxPct: active.waterLossMaxPct,
    shakeMinMin: active.shakeMinMin,
    shakeMinMax: active.shakeMinMax,
    fireMediumLoad: active.fireMediumLoad,
    fireFullLoad: active.fireFullLoad,
    fullFirePassesMin: active.fullFirePassesMin,
    note: '',
    createdBy: active.createdBy,
  };
}

function StandardNumberItem({
  label,
  name,
  limit,
  step = 1,
}: {
  label: string;
  name: keyof StandardParams;
  limit: { min: number; max: number };
  step?: number;
}) {
  return (
    <Form.Item label={label} name={name} rules={[{ required: true, message: '请填写' }, { type: 'number', ...limit }]}>
      <InputNumber min={limit.min} max={limit.max} step={step} style={{ width: '100%' }} />
    </Form.Item>
  );
}

function ParamGrid({ active }: { active: ProcessStandard }) {
  const items: Array<{ label: string; value: string }> = [
    { label: '做青室温', value: `${active.turnRoomTempMin}-${active.turnRoomTempMax} ℃` },
    { label: '做青湿度', value: `${active.turnHumidityMin}-${active.turnHumidityMax} %` },
    { label: '失水目标', value: `${active.waterLossMinPct}-${active.waterLossMaxPct} %` },
    { label: '单轮摇青', value: `${active.shakeMinMin}-${active.shakeMinMax} 分钟` },
    { label: '中火阈值', value: `≥ ${active.fireMediumLoad} ℃·h` },
    { label: '足火阈值', value: `≥ ${active.fireFullLoad} ℃·h / ${active.fullFirePassesMin} 道` },
  ];
  return (
    <Row gutter={[8, 8]}>
      {items.map((item) => (
        <Col span={8} key={item.label}>
          <div className="mono" style={{ background: 'rgba(47,81,54,0.06)', borderRadius: 6, padding: '6px 8px' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {item.label}
            </Typography.Text>
            <div style={{ fontWeight: 600 }}>{item.value}</div>
          </div>
        </Col>
      ))}
    </Row>
  );
}
