import React, { useEffect, useState } from 'react';
import { Alert, Button, Card, Space, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  FolderOpenOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import { useAppStore } from '../store';

const { Title, Text } = Typography;
const LOCAL_API = import.meta.env.VITE_LOCAL_API_BASE_URL;

const Settings: React.FC = () => {
  const { clientId, setWatchPath: storeSetWatchPath } = useAppStore();
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  // 页面加载时拉取已保存的 watch_path
  useEffect(() => {
    axios
      .get(`${LOCAL_API}/settings/watch-path`, { params: { client_id: clientId } })
      .then((res) => {
        if (res.data.code === 10000) {
          const path = res.data.data?.watchPath ?? null;
          setSavedPath(path);
        }
      })
      .catch(() => { });
  }, [clientId]);

  const handlePickAndSave = async () => {
    setSaving(true);
    setStatus('idle');
    try {
      // Step 1: 唤起系统原生目录选择器
      const pickRes = await axios.get(`${LOCAL_API}/settings/pick-directory`);
      if (pickRes.data.code !== 10000) {
        // 用户取消了选择，静默处理
        setSaving(false);
        return;
      }
      const selectedPath = pickRes.data.data.path as string;

      // Step 2: 保存至本地 SQLite
      const saveRes = await axios.post(`${LOCAL_API}/settings/watch-path`, {
        client_id: clientId,
        watch_path: selectedPath,
      });
      if (saveRes.data.code === 10000) {
        setSavedPath(selectedPath);
        storeSetWatchPath(selectedPath); // 全局状态同步，弹窗自动关闭
        setStatus('success');
      } else {
        setErrMsg(saveRes.data.message ?? '保存失败');
        setStatus('error');
      }
    } catch (e: any) {
      setErrMsg(e?.message ?? '网络异常');
      setStatus('error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: '0' }}>
      {/* 页头 */}
      <div
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: '20px 28px',
          marginBottom: 20,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <Title level={4} style={{ margin: 0, fontWeight: 700 }}>
          设置
        </Title>
      </div>

      {/* 监控目录设置卡片 */}
      <Card
        title={
          <Space>
            <FolderOpenOutlined style={{ color: '#1677ff' }} />
            <span>本地监控目录</span>
          </Space>
        }
        style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
          选择小说原稿存放的本地文件夹，系统将自动监控该目录下的文件变动。
        </Text>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16, fontSize: 12, color: '#faad14' }}>
          ⚠ 注意：系统仅同步 .doc、.docx 格式的文档
        </Text>

        {/* 当前已保存路径 */}
        {savedPath ? (
          <div style={{ marginBottom: 16 }}>
            <Tag
              icon={<CheckCircleOutlined />}
              color="success"
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6 }}
            >
              当前已设置：{savedPath}
            </Tag>
          </div>
        ) : (
          <Alert
            icon={<WarningOutlined />}
            message="尚未设置监控目录，后台进程暂不启动"
            type="warning"
            showIcon
            style={{ marginBottom: 16, borderRadius: 8 }}
          />
        )}

        {/* 选择目录按钮 */}
        <Button
          type="primary"
          icon={<FolderOpenOutlined />}
          loading={saving}
          onClick={handlePickAndSave}
          size="large"
          block
          style={{ borderRadius: 8, height: 48, fontSize: 15 }}
        >
          {savedPath ? '重新选择目录' : '选择监控目录'}
        </Button>

        {/* 操作结果反馈 */}
        {status === 'success' && (
          <Alert
            message="监控目录已保存"
            type="success"
            showIcon
            style={{ marginTop: 14, borderRadius: 8 }}
          />
        )}
        {status === 'error' && (
          <Alert
            message={errMsg}
            type="error"
            showIcon
            style={{ marginTop: 14, borderRadius: 8 }}
          />
        )}


      </Card>
    </div>
  );
};

export default Settings;
