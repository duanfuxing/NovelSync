import React, { useEffect, useState } from 'react';
import { App as AntdApp, Card, Typography, Tag, Row, Col, Statistic, Spin, Button, Dropdown } from 'antd';
import {
  SettingOutlined,
  IdcardOutlined,
  FileTextOutlined,
  DollarOutlined,
  PictureOutlined,
  FileImageOutlined,
  CheckCircleFilled,
  SyncOutlined,
  ClockCircleOutlined,
  ExclamationCircleFilled,
  ThunderboltOutlined,
  DownOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';

const { Title, Text } = Typography;
const LOCAL_API = import.meta.env.VITE_LOCAL_API_BASE_URL;

interface DashboardStats {
  bjhCount: number;
  articleCount: number;
  totalOrderAmount: number;
  novel?: {
    bjhCount: number;
    articleCount: number;
    totalOrderAmount: number;
    enabled: boolean;
    ready: boolean;
    reason: string;
  };
  material?: {
    taskCount: number;
    successImageCount: number;
    failedImageCount: number;
    runningTaskCount: number;
    todayImageCount: number;
    latestTask?: {
      title: string;
      status: string;
      successCount: number;
      failedCount: number;
      requestedCount: number;
      createdAt: string;
    } | null;
  };
}

interface WorkerStatusItem {
  workerName: string;
  status: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  message: string | null;
  updatedAt: string | null;
  intervalSeconds: number;
}

const WORKER_LABEL_MAP: Record<string, string> = {
  AccountSyncWorker: '百家号同步',
  ArticleSyncWorker: '文章同步',
  OrderSyncWorker: '订单同步',
  FileWatcherWorker: '本地小说同步',
};

const STATUS_CONFIG: Record<string, { color: string; tagColor: string; icon: React.ReactNode; text: string }> = {
  running: { color: '#1677ff', tagColor: 'processing', icon: <SyncOutlined spin />, text: '运行中' },
  sleeping: { color: '#52c41a', tagColor: 'success', icon: <CheckCircleFilled />, text: '待命中' },
  error: { color: '#ff4d4f', tagColor: 'error', icon: <ExclamationCircleFilled />, text: '异常' },
  idle: { color: '#d9d9d9', tagColor: 'default', icon: <ClockCircleOutlined />, text: '未启动' },
};

// 格式化倒计时
const formatCountdown = (seconds: number): string => {
  if (seconds <= 0) return '即将执行';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const { novelSyncReady, novelSyncReason } = useAppStore();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [workers, setWorkers] = useState<WorkerStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const triggerWorker = async (workerName: string, forceFull: boolean = false) => {
    setTriggering(workerName);
    try {
      const params = new URLSearchParams({ worker_name: workerName });
      if (forceFull) params.append('force_full', 'true');
      const res = await axios.post(`${LOCAL_API}/workers/trigger?${params.toString()}`);
      if (res.data.code === 10000) {
        message.success(res.data.message || `${WORKER_LABEL_MAP[workerName] ?? workerName} 已触发`);
      } else {
        message.error(res.data.message);
      }
    } catch (err) {
      message.error('触发失败');
    } finally {
      setTriggering(null);
      setTimeout(fetchData, 2000);
    }
  };

  const fetchData = async () => {
    try {
      const [statsRes, workersRes] = await Promise.all([
        axios.get(`${LOCAL_API}/dashboard/stats`),
        axios.get(`${LOCAL_API}/workers/status`),
      ]);
      if (statsRes.data.code === 10000) setStats(statsRes.data.data);
      if (workersRes.data.code === 10000) setWorkers(workersRes.data.data ?? []);
    } catch (err) {
      console.error('[Dashboard] 加载失败', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30_000);
    return () => clearInterval(timer);
  }, []);

  // 每秒更新倒计时
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 120 }}>
        <Spin size="large" />
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>加载中...</Text>
      </div>
    );
  }

  const novelStats = stats?.novel ?? {
    bjhCount: stats?.bjhCount ?? 0,
    articleCount: stats?.articleCount ?? 0,
    totalOrderAmount: stats?.totalOrderAmount ?? 0,
    enabled: novelSyncReady,
    ready: novelSyncReady,
    reason: novelSyncReason,
  };
  const materialStats = stats?.material ?? {
    taskCount: 0,
    successImageCount: 0,
    failedImageCount: 0,
    runningTaskCount: 0,
    todayImageCount: 0,
    latestTask: null,
  };
  const novelReady = Boolean(novelStats.ready && novelSyncReady);
  const novelUnavailableTitle = novelStats.enabled ? '小说同步未就绪' : '小说同步未开启';
  const novelUnavailableReason = novelStats.reason || novelSyncReason || '开启并完成配置后，系统会自动恢复同步统计和任务进程。';

  const novelStatCards = [
    {
      title: '百家号总数',
      value: novelReady ? novelStats.bjhCount : '--',
      icon: <IdcardOutlined />,
      color: '#1677ff',
      bg: 'linear-gradient(135deg, #e8f4fd 0%, #d6e8fa 100%)',
    },
    {
      title: '已发布文章',
      value: novelReady ? novelStats.articleCount : '--',
      icon: <FileTextOutlined />,
      color: '#52c41a',
      bg: 'linear-gradient(135deg, #f0f9eb 0%, #d9f2c7 100%)',
    },
    {
      title: '订单总金额',
      value: novelReady ? novelStats.totalOrderAmount : '--',
      icon: <DollarOutlined />,
      color: '#faad14',
      bg: 'linear-gradient(135deg, #fffbe6 0%, #fff1b8 100%)',
    },
  ];

  const materialStatCards = [
    {
      title: '素材任务数',
      value: materialStats.taskCount,
      icon: <PictureOutlined />,
      color: '#1677ff',
    },
    {
      title: '成功图片',
      value: materialStats.successImageCount,
      icon: <CheckCircleFilled />,
      color: '#52c41a',
    },
    {
      title: '失败图片',
      value: materialStats.failedImageCount,
      icon: <ExclamationCircleFilled />,
      color: '#ff4d4f',
    },
    {
      title: '今日生成',
      value: materialStats.todayImageCount,
      icon: <FileImageOutlined />,
      color: '#722ed1',
    },
  ];

  const workerStatusGrid = (
    <Row gutter={[12, 12]}>
      {workers.map((w) => {
        const cfg = STATUS_CONFIG[w.status] ?? STATUS_CONFIG.idle;
        const label = WORKER_LABEL_MAP[w.workerName] ?? w.workerName;
        return (
          <Col span={6} key={w.workerName}>
            <div
              style={{
                padding: '16px',
                borderRadius: 10,
                border: '1px solid #f0f0f0',
                background: '#fafafa',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: cfg.color, fontSize: 14 }}>{cfg.icon}</span>
                  <Text style={{ fontWeight: 600, fontSize: 13 }}>{label}</Text>
                </div>
                <Tag
                  color={cfg.tagColor}
                  style={{ borderRadius: 4, fontSize: 11, margin: 0 }}
                >
                  {cfg.text}
                </Tag>
              </div>

              {(() => {
                if (w.status === 'running') {
                  return <Text type="secondary" style={{ fontSize: 11 }}>执行中...</Text>;
                }
                if (w.status === 'error') {
                  return <Text type="danger" style={{ fontSize: 11 }}>{w.message || '异常，等待重试...'}</Text>;
                }
                const baseTime = w.lastSuccessAt || w.updatedAt;
                if (baseTime && w.intervalSeconds) {
                  const nextRun = new Date(baseTime + 'Z').getTime() + w.intervalSeconds * 1000;
                  const remaining = Math.max(0, Math.floor((nextRun - now) / 1000));
                  return (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {w.lastSuccessAt ? '下次运行' : '首次运行'}: <span style={{ fontFamily: 'monospace', color: remaining <= 60 ? '#faad14' : '#666' }}>{formatCountdown(remaining)}</span>
                    </Text>
                  );
                }
                return <Text type="secondary" style={{ fontSize: 11 }}>等待首次运行</Text>;
              })()}

              {['ArticleSyncWorker', 'OrderSyncWorker'].includes(w.workerName) ? (
                <Dropdown
                  disabled={!novelReady}
                  menu={{
                    items: [
                      {
                        key: 'incremental',
                        icon: <ThunderboltOutlined />,
                        label: '增量同步',
                        onClick: () => triggerWorker(w.workerName),
                      },
                      {
                        key: 'full',
                        icon: <HistoryOutlined />,
                        label: '全量同步（历史全部）',
                        onClick: () => triggerWorker(w.workerName, true),
                      },
                    ],
                  }}
                  trigger={['click']}
                >
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    icon={<ThunderboltOutlined />}
                    loading={triggering === w.workerName}
                    disabled={!novelReady}
                    style={{ fontSize: 12, height: 28 }}
                    block
                  >
                    立即同步 <DownOutlined style={{ fontSize: 10, marginLeft: 2 }} />
                  </Button>
                </Dropdown>
              ) : (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<ThunderboltOutlined />}
                  loading={triggering === w.workerName}
                  onClick={() => triggerWorker(w.workerName)}
                  disabled={!novelReady}
                  style={{ fontSize: 12, height: 28 }}
                  block
                >
                  立即同步
                </Button>
              )}
            </div>
          </Col>
        );
      })}
    </Row>
  );

  return (
    <div style={{ display: 'flex', gap: 20, flexDirection: 'column' }}>
      <Card
        variant="borderless"
        style={{ position: 'relative', overflow: 'hidden', borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}
        styles={{ body: { padding: '20px 24px' } }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Title level={5} style={{ margin: 0 }}>小说同步</Title>
            {novelReady ? (
              <Tag color="success" style={{ borderRadius: 4, margin: 0 }}>运行中</Tag>
            ) : (
              <Tag color="default" style={{ borderRadius: 4, margin: 0 }}>{novelStats.enabled ? '未就绪' : '未开启'}</Tag>
            )}
          </div>
        }
      >
        <div style={{ minHeight: 250 }}>
          <div
            style={{
              opacity: novelReady ? 1 : 0.35,
              filter: novelReady ? 'none' : 'blur(1px)',
              pointerEvents: novelReady ? 'auto' : 'none',
              transition: 'opacity 0.2s ease, filter 0.2s ease',
            }}
          >
            <Row gutter={12} style={{ marginBottom: 18 }}>
              {novelStatCards.map((item) => (
                <Col span={8} key={item.title}>
                  <div style={{ padding: '14px 12px', borderRadius: 8, background: novelReady ? '#fafafa' : '#f5f5f5', opacity: novelReady ? 1 : 0.72 }}>
                    <Statistic
                      title={<Text style={{ color: '#666', fontSize: 12 }}>{item.title}</Text>}
                      value={item.value}
                      valueStyle={{ color: novelReady ? item.color : '#999', fontWeight: 700, fontSize: 24 }}
                      prefix={React.cloneElement(item.icon as React.ReactElement, {
                        style: { fontSize: 16, marginRight: 4 },
                      })}
                    />
                  </div>
                </Col>
              ))}
            </Row>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 16px',
                background: '#f6ffed',
                borderRadius: 8,
                border: '1px solid #b7eb8f',
                marginBottom: 16,
              }}
            >
              <CheckCircleFilled style={{ color: '#52c41a', fontSize: 16 }} />
              <Text style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>主进程 (API Server)</Text>
              <Tag color="success" style={{ borderRadius: 4, margin: 0 }}>运行中</Tag>
            </div>

            {workerStatusGrid}
          </div>
        </div>
        {!novelReady && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              zIndex: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 12,
              background: 'rgba(255, 255, 255, 0.78)',
              backdropFilter: 'blur(2px)',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                maxWidth: '88%',
                padding: '22px 24px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SettingOutlined style={{ fontSize: 28, color: '#8c8c8c', marginBottom: 10 }} />
              <Title level={5} style={{ margin: 0 }}>{novelUnavailableTitle}</Title>
              <Text type="secondary" style={{ display: 'block', marginTop: 8, marginBottom: 16, fontSize: 12 }}>
                {novelUnavailableReason}
              </Text>
              <Button type="primary" icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
                去设置
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card
        variant="borderless"
        style={{ borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}
        styles={{ body: { padding: '20px 24px' } }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Title level={5} style={{ margin: 0 }}>素材制作</Title>
            <Tag color={materialStats.runningTaskCount > 0 ? 'processing' : 'success'} style={{ borderRadius: 4, margin: 0 }}>
              {materialStats.runningTaskCount > 0 ? `${materialStats.runningTaskCount} 个任务运行中` : '待命中'}
            </Tag>
          </div>
        }
      >
        <Row gutter={12}>
          {materialStatCards.map((item) => (
            <Col span={6} key={item.title}>
              <div style={{ padding: '14px 10px', borderRadius: 8, background: '#fafafa' }}>
                <Statistic
                  title={<Text style={{ color: '#666', fontSize: 12 }}>{item.title}</Text>}
                  value={item.value}
                  valueStyle={{ color: item.color, fontWeight: 700, fontSize: 24 }}
                  prefix={React.cloneElement(item.icon as React.ReactElement, {
                    style: { fontSize: 16, marginRight: 4 },
                  })}
                />
              </div>
            </Col>
          ))}
        </Row>
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 8, background: '#f7f9fc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            最近任务：{materialStats.latestTask?.title || '暂无任务'}
          </Text>
          <Button size="small" type="link" onClick={() => navigate('/material-generation')} style={{ padding: 0 }}>
            查看素材生成
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default Dashboard;
