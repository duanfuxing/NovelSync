import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Typography, Tag, Button, Input, Switch, Space, Empty } from 'antd';
import { ClearOutlined, SearchOutlined, PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import axios from 'axios';

const { Text } = Typography;

const LOCAL_API = import.meta.env.VITE_LOCAL_API_BASE_URL;

interface LogItem {
  time: string;
  message: string;
}

// 日志级别判定
type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

const LOG_LEVELS: LogLevel[] = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];

const LEVEL_COLORS: Record<LogLevel, string> = {
  ERROR: '#ff4d4f',
  WARN: '#faad14',
  INFO: '#1677ff',
  DEBUG: '#8c8c8c',
  TRACE: '#bfbfbf',
};

const LEVEL_BG: Record<LogLevel, string> = {
  ERROR: 'rgba(255,77,79,0.08)',
  WARN: 'rgba(250,173,20,0.06)',
  INFO: 'transparent',
  DEBUG: 'transparent',
  TRACE: 'transparent',
};

const getLogLevel = (msg: string): LogLevel => {
  if (msg.includes('错误') || msg.includes('失败') || msg.includes('异常') || msg.includes('Error') || msg.includes('error')) return 'ERROR';
  if (msg.includes('警告') || msg.includes('Warning') || msg.includes('warning')) return 'WARN';
  if (msg.includes('DEBUG') || msg.includes('debug')) return 'DEBUG';
  if (msg.includes('TRACE') || msg.includes('trace')) return 'TRACE';
  return 'INFO';
};

const getModule = (msg: string): string => {
  const match = msg.match(/^\[([^\]]+)\]/);
  return match ? match[1] : 'System';
};

const getContent = (msg: string): string => {
  return msg.replace(/^\[[^\]]+\]\s*/, '');
};

const DebugConsole: React.FC = () => {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [paused, setPaused] = useState(() => localStorage.getItem('debug_paused') === 'true');
  const [filter, setFilter] = useState('');
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(new Set(LOG_LEVELS));
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(localStorage.getItem('debug_paused') === 'true');

  const fetchLogs = useCallback(async () => {
    if (pausedRef.current) return;
    try {
      const res = await axios.get(`${LOCAL_API}/debug/logs`);
      if (res.data.code === 10000) {
        setLogs(res.data.data || []);
      }
    } catch { /* 静默 */ }
  }, []);

  const clearLogs = async () => {
    try {
      await axios.post(`${LOCAL_API}/debug/logs/clear`);
      setLogs([]);
    } catch { /* 静默 */ }
  };

  const toggleLevel = (level: LogLevel) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const togglePause = () => {
    setPaused((p) => {
      const next = !p;
      pausedRef.current = next;
      localStorage.setItem('debug_paused', String(next));
      return next;
    });
  };

  useEffect(() => {
    fetchLogs();
    const timer = setInterval(fetchLogs, 2000);
    return () => clearInterval(timer);
  }, [fetchLogs]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // 过滤日志
  const filteredLogs = logs.filter((l) => {
    const level = getLogLevel(l.message);
    if (!activeLevels.has(level)) return false;
    if (filter && !l.message.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 144px)', gap: 0 }}>

      {/* === 顶部标题栏 === */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '16px 20px', background: '#fff', borderRadius: '10px 10px 0 0',
        borderBottom: '1px solid #f0f0f0',
      }}>
        <div>
          <Text style={{ fontSize: 18, fontWeight: 700 }}>调试控制台</Text>
          <Text type="secondary" style={{ marginLeft: 12, fontSize: 13 }}>
            实时查看应用日志，用于调试和问题排查
          </Text>
        </div>
        <Space align="center">
          <Switch
            checked={!paused}
            onChange={() => togglePause()}
            checkedChildren="已启用"
            unCheckedChildren="已暂停"
            style={{ background: paused ? '#ff4d4f' : '#52c41a' }}
          />
        </Space>
      </div>

      {/* === 工具栏 === */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 20px', background: '#fafafa',
        borderBottom: '1px solid #f0f0f0',
        flexWrap: 'wrap',
      }}>
        {/* 左侧：Console + 级别过滤 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 12, fontWeight: 600, marginRight: 4, color: '#333' }}>CONSOLE</Text>
          <div style={{ width: 1, height: 16, background: '#e0e0e0', margin: '0 4px' }} />
          {LOG_LEVELS.map((level) => {
            const active = activeLevels.has(level);
            return (
              <Tag
                key={level}
                onClick={() => toggleLevel(level)}
                style={{
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: 4,
                  padding: '0 8px',
                  lineHeight: '22px',
                  userSelect: 'none',
                  color: active ? LEVEL_COLORS[level] : '#ccc',
                  borderColor: active ? LEVEL_COLORS[level] : '#e8e8e8',
                  background: active ? `${LEVEL_COLORS[level]}10` : '#f5f5f5',
                  opacity: active ? 1 : 0.5,
                  transition: 'all 0.2s',
                }}
              >
                {level}
              </Tag>
            );
          })}
        </div>

        {/* 右侧：搜索 + 操作 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Input
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            placeholder="Filter logs..."
            allowClear
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 180, borderRadius: 6, height: 30 }}
            size="small"
          />
          <Button
            size="small"
            icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
            onClick={togglePause}
            style={{ borderRadius: 6, height: 30, fontSize: 12 }}
          >
            {paused ? '恢复' : '暂停'}
          </Button>
          <Button
            size="small"
            icon={<ClearOutlined />}
            onClick={clearLogs}
            danger
            style={{ borderRadius: 6, height: 30, fontSize: 12 }}
          >
            清空
          </Button>
        </div>
      </div>

      {/* === 日志列表 === */}
      <div style={{
        flex: 1, overflow: 'hidden', background: '#f7f7f8',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          flex: 1, overflowY: 'auto', padding: '8px 0',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'SF Mono', Consolas, monospace",
          fontSize: 12, lineHeight: '24px',
        }}>
          {filteredLogs.length === 0 ? (
            <Empty
              description={<Text style={{ color: '#999' }}>暂无日志</Text>}
              style={{ marginTop: 80 }}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            filteredLogs.map((log, idx) => {
              const level = getLogLevel(log.message);
              const module = getModule(log.message);
              const content = getContent(log.message);
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    padding: '0 16px',
                    background: LEVEL_BG[level],
                    borderLeft: level === 'ERROR' ? '3px solid #ff4d4f' : level === 'WARN' ? '3px solid #faad14' : '3px solid transparent',
                  }}
                >
                  {/* 时间 */}
                  <span style={{ color: '#999', width: 68, flexShrink: 0 }}>{log.time}</span>
                  {/* 级别 */}
                  <span style={{
                    color: LEVEL_COLORS[level],
                    width: 48,
                    flexShrink: 0,
                    fontWeight: 600,
                    fontSize: 11,
                  }}>
                    {level}
                  </span>
                  {/* 模块 */}
                  <span style={{
                    color: '#0e7490',
                    width: 140,
                    flexShrink: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {module}
                  </span>
                  {/* 内容 */}
                  <span style={{ color: '#333', wordBreak: 'break-all' }}>{content}</span>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* === 底部状态栏 === */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '8px 20px',
        background: '#fafafa',
        borderRadius: '0 0 10px 10px',
        borderTop: '1px solid #eee',
      }}>
        <Text style={{ color: '#888', fontSize: 12 }}>
          {filteredLogs.length} 条日志{filter || activeLevels.size < LOG_LEVELS.length ? ` (共 ${logs.length} 条)` : ''}
        </Text>
        <Space size={16}>
          <span
            style={{ cursor: 'pointer', color: autoScroll ? '#1677ff' : '#666', fontSize: 12, userSelect: 'none' }}
            onClick={() => setAutoScroll(!autoScroll)}
          >
            ↓ {autoScroll ? '自动滚动' : '手动滚动'}
          </span>
          <span style={{ fontSize: 12 }}>
            <span style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
              background: paused ? '#ff4d4f' : '#52c41a',
              marginRight: 6, verticalAlign: 'middle',
            }} />
            <span style={{ color: paused ? '#ff4d4f' : '#52c41a' }}>
              {paused ? 'Paused' : 'Live'}
            </span>
          </span>
        </Space>
      </div>
    </div>
  );
};

export default DebugConsole;
