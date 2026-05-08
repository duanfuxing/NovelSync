import React, { useEffect, useState } from 'react';
import { Card, Typography, Tag, Row, Col, Statistic, Spin, Button, message, Dropdown } from 'antd';
import {
  IdcardOutlined,
  FileTextOutlined,
  DollarOutlined,
  CheckCircleFilled,
  SyncOutlined,
  ClockCircleOutlined,
  ExclamationCircleFilled,
  ThunderboltOutlined,
  DownOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import axios from 'axios';

const { Title, Text } = Typography;
const LOCAL_API = import.meta.env.VITE_LOCAL_API_BASE_URL;

interface DashboardStats {
  bjhCount: number;
  articleCount: number;
  totalOrderAmount: number;
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
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  const statCards = [
    {
      title: '百家号总数',
      value: stats?.bjhCount ?? 0,
      icon: <IdcardOutlined />,
      color: '#1677ff',
      bg: 'linear-gradient(135deg, #e8f4fd 0%, #d6e8fa 100%)',
    },
    {
      title: '已发布文章',
      value: stats?.articleCount ?? 0,
      icon: <FileTextOutlined />,
      color: '#52c41a',
      bg: 'linear-gradient(135deg, #f0f9eb 0%, #d9f2c7 100%)',
    },
    {
      title: '订单总金额',
      value: stats?.totalOrderAmount ?? 0,
      icon: <DollarOutlined />,
      color: '#faad14',
      bg: 'linear-gradient(135deg, #fffbe6 0%, #fff1b8 100%)',
    },
  ];

  return (
    <div style={{ display: 'flex', gap: 20, flexDirection: 'column' }}>
      {/* 第一排：统计卡片 */}
      <Row gutter={20}>
        {statCards.map((item) => (
          <Col span={8} key={item.title}>
            <Card
              bordered={false}
              style={{
                borderRadius: 12,
                boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                background: item.bg,
              }}
              bodyStyle={{ padding: '24px 28px' }}
            >
              <Statistic
                title={<Text style={{ color: '#666', fontSize: 13 }}>{item.title}</Text>}
                value={item.value}
                valueStyle={{ color: item.color, fontWeight: 700, fontSize: 32 }}
                prefix={React.cloneElement(item.icon as React.ReactElement, {
                  style: { fontSize: 20, marginRight: 6 },
                })}
              />
            </Card>
          </Col>
        ))}
      </Row>

      {/* 第二排：进程状态 */}
      <Card
        bordered={false}
        style={{ borderRadius: 12, boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}
        bodyStyle={{ padding: '20px 24px' }}
      >
        <Title level={5} style={{ margin: '0 0 16px', fontWeight: 700 }}>
          进程状态
        </Title>

        {/* 主进程 */}
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

        {/* Worker 子进程 */}
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
                  {/* 顶部：名称 + 状态 */}
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

                  {/* 下次运行倒计时 */}
                  {(() => {
                    if (w.status === 'running') {
                      return <Text type="secondary" style={{ fontSize: 11 }}>执行中...</Text>;
                    }
                    if (w.status === 'error') {
                      return <Text type="danger" style={{ fontSize: 11 }}>{w.message || '异常，等待重试...'}</Text>;
                    }
                    // 优先用 lastSuccessAt，首次启动时 fallback 到 updatedAt（注册时间）
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

                  {/* 操作按钮 */}
                  {['ArticleSyncWorker', 'OrderSyncWorker'].includes(w.workerName) ? (
                    <Dropdown
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
      </Card>
    </div>
  );
};

export default Dashboard;
