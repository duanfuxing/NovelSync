import React, { useState, useRef, useCallback } from 'react';
import { Form, Input, Button, Card, Typography, message, Space } from 'antd';
import { MobileOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAppStore } from '../store';

const { Title, Text } = Typography;
const LOCAL_API = import.meta.env.VITE_LOCAL_API_BASE_URL;

const Login: React.FC = () => {
  const [form] = Form.useForm();
  const [sendingCode, setSendingCode] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();
  const { setAuth, clientId } = useAppStore();

  // ========== 发送验证码 ==========
  const handleSendCode = useCallback(async () => {
    try {
      await form.validateFields(['phone']);
    } catch {
      return;
    }

    const phone = form.getFieldValue('phone');
    setSendingCode(true);

    try {
      const res = await axios.post(`${LOCAL_API}/auth/send-code`, {
        account: phone,
        channel: 'sms',
        action: 'login',
      });

      if (res.data.code === 10000) {
        message.success(res.data.message || '验证码已发送');
        // 启动 60 秒倒计时
        setCountdown(60);
        timerRef.current = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              if (timerRef.current) clearInterval(timerRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        message.error(res.data.message || '验证码发送失败');
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || '网络异常，请稍后重试';
      message.error(msg);
    } finally {
      setSendingCode(false);
    }
  }, [form]);

  // ========== 登录 ==========
  const onFinish = async (values: any) => {
    setLoginLoading(true);
    try {
      const res = await axios.post(`${LOCAL_API}/auth/login`, {
        account: values.phone,
        verifyCode: values.verifyCode,
        channel: 'sms',
        client_id: clientId,
      });

      if (res.data.code === 10000) {
        const d = res.data.data;
        setAuth(d.token, d.uid, {
          nickName: d.nickName,
          avatar: d.avatar,
          phone: d.phone,
          vipLevel: d.vipLevel,
          inkNumber: d.inkNumber,
        });
        message.success('登录成功，欢迎回来');
        navigate('/dashboard');
      } else {
        message.error(res.data.message || '登录失败，请检查验证码');
      }
    } catch (error: any) {
      const msg = error?.response?.data?.message || '网络异常，请稍后重试';
      message.error(msg);
    } finally {
      setLoginLoading(false);
    }
  };

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      background: 'linear-gradient(135deg, #e8f4fd 0%, #f5f7fa 50%, #eef1f5 100%)',
    }}>
      <Card style={{
        width: 440,
        padding: '28px 16px',
        boxShadow: '0 12px 40px rgba(22, 119, 255, 0.08)',
        border: 'none',
        borderRadius: 20,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 40, marginTop: 12 }}>
          <Title level={2} style={{ margin: 0, fontWeight: 800, letterSpacing: '1px' }}>
            <span style={{ color: '#1677ff' }}>Novel</span>
            <span style={{ color: '#111' }}>Sync</span>
          </Title>
          <Text type="secondary" style={{ marginTop: 10, display: 'block', fontSize: 13 }}>
            百家号小说同步工具 · 妙笔系统登录
          </Text>
        </div>

        <Form form={form} name="login" onFinish={onFinish} size="large" autoComplete="off">
          {/* 手机号 */}
          <Form.Item
            name="phone"
            rules={[
              { required: true, message: '请输入手机号' },
              { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确' },
            ]}
          >
            <Input
              prefix={<MobileOutlined style={{ color: '#bfbfbf', marginRight: 6 }} />}
              placeholder="请输入手机号"
              maxLength={11}
            />
          </Form.Item>

          {/* 验证码 */}
          <Form.Item
            name="verifyCode"
            rules={[
              { required: true, message: '请输入验证码' },
              { len: 6, message: '验证码为6位数字' },
            ]}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Input
                prefix={<SafetyCertificateOutlined style={{ color: '#bfbfbf', marginRight: 6 }} />}
                placeholder="请输入6位验证码"
                maxLength={6}
                style={{ flex: 1 }}
              />
              <Button
                type="default"
                disabled={countdown > 0}
                loading={sendingCode}
                onClick={handleSendCode}
                style={{
                  width: 130,
                  fontWeight: 500,
                  borderLeft: 'none',
                }}
              >
                {countdown > 0 ? `${countdown}s 后重试` : '获取验证码'}
              </Button>
            </Space.Compact>
          </Form.Item>

          {/* 登录按钮 */}
          <Form.Item style={{ marginTop: 24 }}>
            <Button
              type="primary"
              htmlType="submit"
              block
              loading={loginLoading}
              style={{
                height: 46,
                fontSize: 16,
                fontWeight: 600,
                borderRadius: 10,
                letterSpacing: '2px',
              }}
            >
              登  录
            </Button>
          </Form.Item>
        </Form>

        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            登录即代表您同意妙笔系统的服务条款
          </Text>
        </div>
      </Card>
    </div>
  );
};

export default Login;
