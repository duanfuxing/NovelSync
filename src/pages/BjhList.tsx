import React, { useEffect, useRef, useState } from 'react';
import { App as AntdApp, Avatar, Badge, Button, Card, Col, Empty, Row, Spin, Tag, Typography } from 'antd';
import { CheckCircleFilled, ReloadOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';

const { Text, Title } = Typography;
const LOCAL_API = import.meta.env.VITE_LOCAL_API_BASE_URL;
const ACCOUNT_SYNC_INTERVAL = Number(import.meta.env.VITE_WORKER_INTERVAL_ACCOUNT_SYNC) || 3600;
const POLL_INTERVAL_MS = ACCOUNT_SYNC_INTERVAL * 1000;

const formatInterval = (seconds: number): string => {
  if (seconds >= 3600) return `${seconds / 3600} 小时`;
  if (seconds >= 60) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
};

interface BjhCookie {
  id: number;
  bjh_id: string;
  bjh_name: string;
  bjh_avatar: string;
  cookie_str: string;
  status: number;
  last_used: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const BjhList: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const { novelSyncReady, novelSyncReason } = useAppStore();
  const [cookies, setCookies] = useState<BjhCookie[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string>('—');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** 只读取本地 SQLite 数据，不触发云端同步 */
  const fetchCookies = async () => {
    try {
      const res = await axios.get(`${LOCAL_API}/sync/bjh/cookies`);
      if (res.data.code === 10000) {
        setCookies(res.data.data ?? []);
        setLastSync(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      }
    } catch (err) {
      console.error('[BjhList] 拉取百家号列表失败', err);
    }
  };

  /** 异步触发 Worker 同步，延迟刷新列表 */
  const triggerSync = async () => {
    setSyncing(true);
    try {
      const res = await axios.post(`${LOCAL_API}/workers/trigger?worker_name=AccountSyncWorker`);
      if (res.data.code === 10000) {
        message.success('百家号同步已触发');
      } else {
        message.error(res.data.message || '触发失败');
      }
    } catch (err) {
      message.error('触发同步失败');
    } finally {
      // 延迟 3 秒刷新列表，等待 Worker 完成
      setTimeout(async () => {
        await fetchCookies();
        setSyncing(false);
      }, 3000);
    }
  };

  useEffect(() => {
    if (!novelSyncReady) {
      setLoading(false);
      return;
    }
    fetchCookies().then(() => setLoading(false));
    timerRef.current = setInterval(() => fetchCookies(), POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [novelSyncReady]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!novelSyncReady) {
    return (
      <Card
        style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: 56, textAlign: 'center' } }}
      >
        <SettingOutlined style={{ fontSize: 46, color: '#1677ff', marginBottom: 16 }} />
        <Title level={4} style={{ margin: '0 0 8px' }}>百家号同步未启用</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          {novelSyncReason || '请先在设置中启用小说自动同步并配置小说监控目录。'}
        </Text>
        <Button type="primary" icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
          前往设置
        </Button>
      </Card>
    );
  }

  return (
    <div style={{ padding: '0 0 24px' }}>
      {/* 页面头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 24,
          background: '#fff',
          borderRadius: 12,
          padding: '20px 28px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0, fontWeight: 700 }}>
            百家号账号列表
          </Title>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>

          {/* 刷新本地列表 */}
          <Tag
            icon={<ReloadOutlined />}
            color="default"
            style={{ cursor: 'pointer', fontSize: 12, borderRadius: 6 }}
            onClick={async () => {
              setLoading(true);
              const t = Date.now();
              await fetchCookies();
              // 最少展示 1 秒加载动画，避免闪烁
              const elapsed = Date.now() - t;
              if (elapsed < 1000) await new Promise(r => setTimeout(r, 1000 - elapsed));
              setLoading(false);
            }}
          >
            刷新
          </Tag>

          {/* 云端同步 */}
          <Tag
            icon={syncing ? <SyncOutlined spin /> : <SyncOutlined />}
            color="blue"
            style={{ cursor: syncing ? 'not-allowed' : 'pointer', fontSize: 12, borderRadius: 6 }}
            onClick={() => !syncing && triggerSync()}
          >
            {syncing ? '同步中...' : '立即同步'}
          </Tag>

          <Text type="secondary" style={{ fontSize: 12 }}>
            上次更新：{lastSync}
          </Text>

          {/* 账号总数 badge */}
          <Badge
            count={cookies.length}
            style={{ backgroundColor: '#1677ff' }}
            overflowCount={99}
          />
        </div>
      </div>

      <Text style={{ fontSize: 12, color: '#4a6fa5', display: 'block', marginBottom: 16 }}>
        💡 系统每 {formatInterval(ACCOUNT_SYNC_INTERVAL)} 自动从云端拉取最新分配数据。Cookie 失效时，本地数据将自动完成覆盖同步。
      </Text>

      {/* 卡片列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}>
          <Spin size="large" />
          <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>正在从云端同步百家号数据...</Text>
        </div>
      ) : cookies.length === 0 ? (
        <Empty
          description="暂无分配的百家号账号，请联系管理员"
          style={{
            background: '#fff',
            borderRadius: 12,
            padding: 60,
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}
        />
      ) : (
        <Row gutter={[16, 16]}>
          {cookies.map((item) => (
            <Col key={item.bjh_id} xs={24} sm={12} md={8} lg={6}>
              <Card
                hoverable
                style={{
                  borderRadius: 12,
                  border: '1px solid #f0f0f0',
                  boxShadow: '0 2px 8px rgba(22, 119, 255, 0.06)',
                  transition: 'all 0.25s',
                }}
                styles={{ body: { padding: '20px 20px 16px' } }}
              >
                {/* 头像 + 在线状态 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                  <Badge
                    dot
                    status={item.status === 1 ? 'success' : 'error'}
                    offset={[-4, 52]}
                  >
                    <Avatar
                      src={item.bjh_avatar}
                      size={56}
                      style={{ border: '2px solid #e8f0fe', flexShrink: 0 }}
                    />
                  </Badge>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 15,
                        color: '#1a1a1a',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 140,
                      }}
                      title={item.bjh_name}
                    >
                      {item.bjh_name || '—'}
                    </div>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      ID: {item.bjh_id}
                    </Text>
                  </div>
                </div>

                {/* 状态行 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 12,
                    borderTop: '1px solid #f5f5f5',
                  }}
                >
                  <Tag
                    icon={item.status === 1 ? <CheckCircleFilled /> : undefined}
                    color={item.status === 1 ? 'success' : 'error'}
                    style={{ borderRadius: 6, fontSize: 11 }}
                  >
                    {item.status === 1 ? '凭证有效' : '已失效'}
                  </Tag>
                  {item.last_used && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      上次使用：{item.last_used.substring(0, 16)}
                    </Text>
                  )}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      )}

    </div>
  );
};

export default BjhList;
