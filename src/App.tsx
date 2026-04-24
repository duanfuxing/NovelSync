import React, { useEffect } from 'react';
import { ConfigProvider, Layout, Typography, Menu, Avatar, Dropdown, Modal, Button, Spin } from 'antd';
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { AppstoreOutlined, DashboardOutlined, SettingOutlined, UserOutlined, LogoutOutlined, IdcardOutlined, FolderOpenOutlined, BookOutlined, BugOutlined } from '@ant-design/icons';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BjhList from './pages/BjhList';
import NovelList from './pages/NovelList';
import DebugConsole from './pages/DebugConsole';
import Settings from './pages/Settings';
import { useAppStore } from './store';

const { Header, Content, Sider } = Layout;
const { Title, Text } = Typography;

const AppMenu = () => {
  const location = useLocation();
  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: <Link to="/dashboard">主页</Link> },
    { key: '/bjh-list', icon: <IdcardOutlined />, label: <Link to="/bjh-list">百家号列表</Link> },
    { key: '/novel-list', icon: <BookOutlined />, label: <Link to="/novel-list">小说列表</Link> },
    { key: '/debug', icon: <BugOutlined />, label: <Link to="/debug">调试</Link> },
    { key: '/settings', icon: <SettingOutlined />, label: <Link to="/settings">设置</Link> },
  ];
  return (
    <Menu
      mode="inline"
      selectedKeys={[location.pathname]}
      style={{ borderRight: 0, marginTop: 16 }}
      items={menuItems}
    />
  );
};

const UserDropdown: React.FC = () => {
  const { userProfile, logout } = useAppStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await (logout as any)();
    navigate('/login');
  };

  const items = [
    {
      key: 'user-info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <div style={{ fontWeight: 600, color: '#333' }}>{userProfile?.nickName || '未知用户'}</div>
          <div style={{ fontSize: 12, color: '#999' }}>{userProfile?.phone || ''}</div>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
      onClick: handleLogout,
    },
  ];

  return (
    <Dropdown menu={{ items }} placement="bottomRight" trigger={['click']}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '4px 8px', borderRadius: 8, transition: 'background 0.2s' }}>
        <Avatar
          src={userProfile?.avatar}
          icon={!userProfile?.avatar && <UserOutlined />}
          size={32}
          style={{ backgroundColor: '#1677ff' }}
        />
        <Text style={{ fontSize: 13, color: '#333', fontWeight: 500, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {userProfile?.nickName || '用户'}
        </Text>
      </div>
    </Dropdown>
  );
};

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { watchPath, watchPathChecked } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();

  // watchPath 检查完毕、未设置，且用户不在设置页时才弹窗
  const showModal = watchPathChecked && !watchPath && location.pathname !== '/settings';

  return (
    <>
      <Layout style={{ minHeight: '100vh', background: '#f5f7fa' }}>
        {/* 顶部统一导航栏 */}
        <Header style={{
          height: 60, lineHeight: '60px', padding: '0 24px',
          background: '#fff', display: 'flex', alignItems: 'center',
          borderBottom: '1px solid #e8e8e8', zIndex: 10,
        }}>
          <div style={{ width: 360, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>
            <Title level={4} style={{ margin: 0, letterSpacing: '1px', fontWeight: 800 }}>
              <span style={{ color: '#1677ff' }}>Novel</span>
              <span style={{ color: '#121212' }}>Sync</span>
            </Title>
            <span style={{ width: 1, height: 16, background: '#ddd' }} />
            <Text style={{ color: '#121212', fontSize: 'inherit', fontWeight: 400 }}>百家号同步工具</Text>
          </div>
          <div style={{ flex: 1 }}>
            {/* <Text style={{ color: '#999', fontSize: 13 }}>百家号同步工具</Text> */}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#52c41a', marginRight: -10 }}></span>
            <Text style={{ color: '#666', fontSize: 13 }}>服务运行中</Text>
            <UserDropdown />
          </div>
        </Header>
        <Layout style={{ background: '#f5f7fa' }}>
          <Sider width={250} theme="light" style={{ borderRight: '1px solid #e8e8e8', background: '#fff' }}>
            <AppMenu />
          </Sider>
          <Layout style={{ background: '#f5f7fa' }}>
            <Content style={{ margin: '24px', padding: '0', minHeight: 280, borderRadius: 12, overflowY: 'auto', height: 'calc(100vh - 60px - 48px)' }}>
              {children}
            </Content>
          </Layout>
        </Layout>
      </Layout>

      {/* 全局拦截弹窗：监控目录未设置（独立于 Layout 层级，避免 z-index 问题） */}
      <Modal
        open={showModal}
        closable={false}
        maskClosable={false}
        centered
        footer={null}
        width={480}
        zIndex={1050}
      >
        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <FolderOpenOutlined style={{ fontSize: 48, color: '#1677ff', marginBottom: 16 }} />
          <Title level={4} style={{ margin: '0 0 8px' }}>请先设置监控目录</Title>
          <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 24 }}>
            您还未配置本地小说原稿的监控目录，后台进程暂未启动。<br />
            请前往设置页面选择一个本地文件夹后再使用。
          </Text>
          <Button
            type="primary"
            size="large"
            icon={<SettingOutlined />}
            style={{ width: '100%', borderRadius: 8 }}
            onClick={() => navigate('/settings')}
          >
            前往设置监控目录
          </Button>
        </div>
      </Modal>
    </>
  );
};

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { token, sessionLoading } = useAppStore();

  if (sessionLoading) {
    return (
      <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#f5f7fa' }}>
        <Spin size="large" tip="正在恢复会话..." />
      </div>
    );
  }

  if (!token) return <Navigate to="/login" replace />;
  return <MainLayout>{children}</MainLayout>;
};

/** 应用启动时尝试从本地 SQLite 恢复登录会话 */
const SessionRestorer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { restoreSession, token } = useAppStore();

  useEffect(() => {
    if (token) {
      restoreSession();
    } else {
      // 没有本地 token，直接设置 loading 为 false
      useAppStore.setState({ sessionLoading: false });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children}</>;
};

const App: React.FC = () => {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1677ff',
          colorBgContainer: '#fff',
          colorBorder: '#f0f0f0',
          borderRadius: 8,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial"
        }
      }}
    >
      <BrowserRouter>
        <SessionRestorer>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/bjh-list" element={<ProtectedRoute><BjhList /></ProtectedRoute>} />
            <Route path="/novel-list" element={<ProtectedRoute><NovelList /></ProtectedRoute>} />
            <Route path="/debug" element={<ProtectedRoute><DebugConsole /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </SessionRestorer>
      </BrowserRouter>
    </ConfigProvider>
  );
};
export default App;
