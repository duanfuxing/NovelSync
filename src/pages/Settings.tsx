import React, { useEffect, useState } from 'react';
import { Alert, App as AntdApp, Button, Card, Input, Space, Switch, Tag, Typography } from 'antd';
import {
  BookOutlined,
  CheckCircleOutlined,
  FolderOpenOutlined,
  PictureOutlined,
  SettingOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useAppStore } from '../store';

const { Title, Text, Paragraph } = Typography;
const LOCAL_API = import.meta.env.VITE_LOCAL_API_BASE_URL;

const Settings: React.FC = () => {
  const { clientId, setWatchPath: storeSetWatchPath, setNovelSyncState: storeSetNovelSyncState } = useAppStore();
  const { message } = AntdApp.useApp();
  const [watchPath, setWatchPath] = useState<string | null>(null);
  const [novelSyncEnabled, setNovelSyncEnabled] = useState(false);
  const [novelSyncReady, setNovelSyncReady] = useState(false);
  const [novelSyncReason, setNovelSyncReason] = useState('小说自动同步未启用');
  const [materialOutputDir, setMaterialOutputDir] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingNovelSync, setSavingNovelSync] = useState(false);
  const [savingWatchPath, setSavingWatchPath] = useState(false);
  const [savingMaterialDir, setSavingMaterialDir] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      setLoading(true);
      try {
        const [novelRes, materialRes] = await Promise.allSettled([
          axios.get(`${LOCAL_API}/settings/novel-sync`, { params: { client_id: clientId } }),
          axios.get(`${LOCAL_API}/settings/material-output-dir`, { params: { client_id: clientId } }),
        ]);

        if (novelRes.status === 'fulfilled' && novelRes.value.data.code === 10000) {
          const novelData = novelRes.value.data.data ?? {};
          setNovelSyncEnabled(Boolean(novelData.enabled));
          setNovelSyncReady(Boolean(novelData.ready));
          setNovelSyncReason(novelData.reason || '小说同步未就绪');
          setWatchPath(novelData.watchPath ?? null);
          storeSetNovelSyncState({
            enabled: Boolean(novelData.enabled),
            ready: Boolean(novelData.ready),
            reason: novelData.reason,
            watchPath: novelData.watchPath ?? null,
          });
        } else {
          setNovelSyncEnabled(false);
          setNovelSyncReady(false);
          setNovelSyncReason('小说同步状态读取失败');
          storeSetNovelSyncState({
            enabled: false,
            ready: false,
            reason: '小说同步状态读取失败',
            watchPath: null,
          });
        }

        if (materialRes.status === 'fulfilled' && materialRes.value.data.code === 10000) {
          setMaterialOutputDir(materialRes.value.data.data?.materialOutputDir ?? null);
        }
      } catch (error) {
        setNovelSyncEnabled(false);
        setNovelSyncReady(false);
        setNovelSyncReason('设置加载失败');
        storeSetNovelSyncState({
          enabled: false,
          ready: false,
          reason: '设置加载失败',
          watchPath: null,
        });
        message.error('设置加载失败');
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [clientId]);

  const handleNovelSyncChange = async (enabled: boolean) => {
    setSavingNovelSync(true);
    try {
      const res = await axios.post(`${LOCAL_API}/settings/novel-sync`, {
        client_id: clientId,
        enabled,
      });
      if (res.data.code === 10000) {
        const nextState = res.data.data ?? {};
        setNovelSyncEnabled(Boolean(nextState.enabled));
        setNovelSyncReady(Boolean(nextState.ready));
        setNovelSyncReason(nextState.reason || '小说同步未就绪');
        setWatchPath(nextState.watchPath ?? watchPath);
        storeSetNovelSyncState({
          enabled: Boolean(nextState.enabled),
          ready: Boolean(nextState.ready),
          reason: nextState.reason,
          watchPath: nextState.watchPath ?? watchPath,
        });
        message.success(nextState.enabled ? '已启用小说自动同步' : '已关闭小说自动同步');
      } else {
        message.error(res.data.message || '保存小说同步设置失败');
      }
    } catch (error: any) {
      message.error(error?.message || '保存小说同步设置失败');
    } finally {
      setSavingNovelSync(false);
    }
  };

  const handlePickWatchPath = async () => {
    setSavingWatchPath(true);
    try {
      const pickRes = await axios.get(`${LOCAL_API}/settings/pick-directory`);
      if (pickRes.data.code !== 10000) return;

      const selectedPath = pickRes.data.data.path as string;
      const saveRes = await axios.post(`${LOCAL_API}/settings/watch-path`, {
        client_id: clientId,
        watch_path: selectedPath,
      });
      if (saveRes.data.code === 10000) {
        const nextState = saveRes.data.data ?? {};
        setWatchPath(nextState.watchPath ?? selectedPath);
        setNovelSyncEnabled(Boolean(nextState.enabled));
        setNovelSyncReady(Boolean(nextState.ready));
        setNovelSyncReason(nextState.reason || '小说同步未就绪');
        storeSetWatchPath(nextState.watchPath ?? selectedPath);
        storeSetNovelSyncState({
          enabled: Boolean(nextState.enabled),
          ready: Boolean(nextState.ready),
          reason: nextState.reason,
          watchPath: nextState.watchPath ?? selectedPath,
        });
        message.success('小说监控目录已保存');
      } else {
        message.error(saveRes.data.message || '保存监控目录失败');
      }
    } catch (error: any) {
      message.error(error?.message || '选择监控目录失败');
    } finally {
      setSavingWatchPath(false);
    }
  };

  const handlePickMaterialDir = async () => {
    setSavingMaterialDir(true);
    try {
      const pickRes = await axios.get(`${LOCAL_API}/settings/pick-material-output-directory`);
      if (pickRes.data.code !== 10000) return;

      const selectedPath = pickRes.data.data.path as string;
      const saveRes = await axios.post(`${LOCAL_API}/settings/material-output-dir`, {
        client_id: clientId,
        material_output_dir: selectedPath,
      });
      if (saveRes.data.code === 10000) {
        setMaterialOutputDir(selectedPath);
        message.success('素材输出目录已保存');
      } else {
        message.error(saveRes.data.message || '保存素材输出目录失败');
      }
    } catch (error: any) {
      message.error(error?.message || '选择素材输出目录失败');
    } finally {
      setSavingMaterialDir(false);
    }
  };

  return (
    <div style={{ maxWidth: 1160, margin: '0 auto', padding: '0 0 24px' }}>
      <Card
        loading={loading}
        style={{ borderRadius: 12, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: '24px 28px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              width: 58,
              height: 58,
              borderRadius: '50%',
              background: '#edf4ff',
              color: '#1677ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <SettingOutlined style={{ fontSize: 30 }} />
          </div>
          <div>
            <Title level={3} style={{ margin: 0, fontWeight: 800 }}>设置</Title>
            <Text type="secondary" style={{ fontSize: 15 }}>
              配置小说同步与素材生成的相关设置。
            </Text>
          </div>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <Card
          title={
            <Space>
              <BookOutlined style={{ color: '#1677ff', fontSize: 24 }} />
              <span>小说同步设置</span>
            </Space>
          }
          style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
          styles={{ body: { padding: 24 } }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
            <Text style={{ width: 128 }}>启用小说自动同步</Text>
            <Switch checked={novelSyncEnabled} loading={savingNovelSync} onChange={handleNovelSyncChange} />
          </div>

          {novelSyncEnabled ? (
            <Alert
              type={novelSyncReady ? 'success' : 'warning'}
              showIcon
              icon={novelSyncReady ? <CheckCircleOutlined /> : <WarningOutlined />}
              message={novelSyncReady ? '已启用：将同步百家号文章、订单，并扫描本地小说文件。' : `已启用：${novelSyncReason}`}
              style={{ marginBottom: 22, borderRadius: 8 }}
            />
          ) : (
            <Alert
              type="warning"
              showIcon
              icon={<WarningOutlined />}
              message="未启用：不会同步百家号文章、订单，也不会扫描本地小说文件。"
              style={{ marginBottom: 22, borderRadius: 8 }}
            />
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
            <Text style={{ width: 128 }}>小说监控目录</Text>
            <Input
              value={watchPath || ''}
              placeholder="未设置监控目录"
              disabled
              style={{ flex: 1 }}
            />
            <Button
              icon={<FolderOpenOutlined />}
              disabled={!novelSyncEnabled}
              loading={savingWatchPath}
              onClick={handlePickWatchPath}
            >
              选择监控目录
            </Button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Text style={{ width: 128 }}>状态</Text>
            <Tag color={novelSyncReady ? 'success' : novelSyncEnabled ? 'warning' : 'orange'} style={{ borderRadius: 16, padding: '3px 14px' }}>
              {!novelSyncEnabled ? '未启用' : novelSyncReady ? '运行中' : '未就绪'}
            </Tag>
          </div>

          <Paragraph type="secondary" style={{ margin: '22px 0 0', fontSize: 13 }}>
            开启后需设置小说监控目录。
          </Paragraph>
        </Card>

        <Card
          title={
            <Space>
              <PictureOutlined style={{ color: '#1677ff', fontSize: 24 }} />
              <span>素材生成设置</span>
            </Space>
          }
          style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
          styles={{ body: { padding: 24 } }}
        >
          <Alert
            type={materialOutputDir ? 'success' : 'warning'}
            showIcon
            icon={materialOutputDir ? <CheckCircleOutlined /> : <WarningOutlined />}
            message={materialOutputDir ? '已设置素材输出目录' : '请先设置素材输出目录'}
            style={{ marginBottom: 28, borderRadius: 8 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
            <Text style={{ width: 128 }}>素材输出目录</Text>
            <Input
              value={materialOutputDir || ''}
              placeholder="未设置素材输出目录"
              disabled
              style={{ flex: 1 }}
            />
            <Button
              type="primary"
              ghost
              icon={<FolderOpenOutlined />}
              loading={savingMaterialDir}
              onClick={handlePickMaterialDir}
            >
              {materialOutputDir ? '重新选择目录' : '选择目录'}
            </Button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Text style={{ width: 128 }}>状态</Text>
            <Tag color={materialOutputDir ? 'success' : 'warning'} style={{ borderRadius: 16, padding: '3px 14px' }}>
              {materialOutputDir ? '可用' : '待设置'}
            </Tag>
          </div>
        </Card>
      </div>

    </div>
  );
};

export default Settings;
