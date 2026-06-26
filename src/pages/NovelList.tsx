import React, { useEffect, useState, useCallback } from 'react';
import { App as AntdApp, Card, Input, DatePicker, Button, Tag, Image, Typography, Pagination, Spin, Empty, Avatar, Tooltip, Select, Modal, Upload } from 'antd';
import {
  SearchOutlined,
  ReloadOutlined,
  FireFilled,
  UserOutlined,
  EyeOutlined,
  CommentOutlined,
  DollarOutlined,
  LikeOutlined,
  StarOutlined,
  ShareAltOutlined,
  RiseOutlined,
  LinkOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
  EditOutlined,
  SaveOutlined,
  CloseCircleOutlined,
  AimOutlined,
  FileExcelOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';

const { Text, Title } = Typography;
const { RangePicker } = DatePicker;
const LOCAL_API = import.meta.env.VITE_LOCAL_API_BASE_URL;

interface NovelItem {
  articleId: string;
  nid: string;
  title: string;
  abstract: string;
  verticalCover: string;
  url: string;
  bjhName: string;
  bjhAvatar: string;
  orderAmount: number;
  readAmount: number;
  recCount: number;
  likeAmount: number;
  collectionAmount: number;
  shareAmount: number;
  isHot: number;
  isPaySubscribe: number;
  syncStatus: number;
  publishTime: string;
}

interface MatchFile {
  fileName: string;
  filePath: string;
  nameWithoutExt: string;
  similarity: number;
  fileSize: number;
}

interface PaginationInfo {
  currentPage: number;
  pageSize: number;
  total: number;
}

/**
 * LCS diff 高亮：对比 source（小说标题）和 target（文件名），
 * 返回双行渲染：source 用删除线标记缺失字符，target 用黄色荧光笔标记差异字符。
 */
const computeLCS = (a: string, b: string): boolean[][] => {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const inA = Array(m).fill(false), inB = Array(n).fill(false);
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { inA[i - 1] = true; inB[j - 1] = true; i--; j--; }
    else if (dp[i - 1][j] > dp[i][j - 1]) i--;
    else j--;
  }
  return [inA, inB];
};

/** 渲染 source（小说标题）：匹配字符正常显示，非 LCS 字符用红色删除线 */
const renderSourceDiff = (source: string, target: string): React.ReactNode => {
  const [inSource] = computeLCS(source, target);
  const spans: React.ReactNode[] = [];
  let buf = '', isMiss = false;
  const flush = (key: number) => {
    if (!buf) return;
    spans.push(
      isMiss
        ? <span key={key} style={{ color: '#cf1322', textDecoration: 'line-through', textDecorationColor: '#cf1322', opacity: 0.7 }}>{buf}</span>
        : <span key={key}>{buf}</span>
    );
    buf = '';
  };
  for (let k = 0; k < source.length; k++) {
    const miss = !inSource[k];
    if (miss !== isMiss) { flush(k); isMiss = miss; }
    buf += source[k];
  }
  flush(source.length);
  return <>{spans}</>;
};

/** 渲染 target（文件名）：匹配字符正常显示，非 LCS 字符用黄色荧光笔 + 绿色下划线 */
const renderTargetDiff = (source: string, target: string): React.ReactNode => {
  const [, inTarget] = computeLCS(source, target);
  const spans: React.ReactNode[] = [];
  let buf = '', isMiss = false;
  const flush = (key: number) => {
    if (!buf) return;
    spans.push(
      isMiss
        ? <span key={key} style={{ background: '#ffe58f', color: '#874d00', borderRadius: 2, padding: '0 1px', fontWeight: 600, textDecoration: 'underline', textDecorationColor: '#52c41a', textUnderlineOffset: 2 }}>{buf}</span>
        : <span key={key}>{buf}</span>
    );
    buf = '';
  };
  for (let k = 0; k < target.length; k++) {
    const miss = !inTarget[k];
    if (miss !== isMiss) { flush(k); isMiss = miss; }
    buf += target[k];
  }
  flush(target.length);
  return <>{spans}</>;
};

/** 计算差异统计：缺失（标题有文件名没有）、多余（文件名有标题没有）、一致（LCS 长度） */
const getDiffStats = (source: string, target: string) => {
  const [inSource, inTarget] = computeLCS(source, target);
  const matched = inSource.filter(Boolean).length;
  const missing = source.length - matched;  // 标题中有但文件名缺失的字符
  const extra = target.length - inTarget.filter(Boolean).length;  // 文件名中多出的字符
  return { matched, missing, extra };
};

/* 数据指标项 */
const StatItem: React.FC<{ icon: React.ReactNode; value: number; label: string; color?: string }> = ({ icon, value, label, color }) => (
  <Tooltip title={`${label}: ${value.toLocaleString()}`}>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: color || '#999', cursor: 'default' }}>
      {icon} {value.toLocaleString()}
    </span>
  </Tooltip>
);

/* 可复制文本 */
const CopyableText: React.FC<{
  label: string;
  value: string;
  color: string;
  messageApi: ReturnType<typeof AntdApp.useApp>['message'];
}> = ({ label, value, color, messageApi }) => (
  <Tooltip title="点击复制">
    <span
      style={{ fontSize: 11, color, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => messageApi.success(`已复制 ${label}: ${value}`));
      }}
    >
      {label}: {value}
    </span>
  </Tooltip>
);

const NovelList: React.FC = () => {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const { novelSyncReady, novelSyncReason } = useAppStore();
  const [data, setData] = useState<NovelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<PaginationInfo>({ currentPage: 1, pageSize: 10, total: 0 });

  const [keyword, setKeyword] = useState('');
  const [appId, setAppId] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [sortField, setSortField] = useState('publish_time');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [bjhOptions, setBjhOptions] = useState<{ value: string; label: string }[]>([]);

  // NID 文件过滤相关
  const [nidFilter, setNidFilter] = useState<string[]>([]);
  const [nidFileName, setNidFileName] = useState('');

  // 匹配文件相关
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchTitle, setMatchTitle] = useState('');
  const [matchFiles, setMatchFiles] = useState<MatchFile[]>([]);
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  const fetchData = useCallback(async (page = 1, pageSize = 10, overrideSort?: { field: string; order: string }, overrideNids?: string[]) => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        page,
        page_size: pageSize,
        sort_field: overrideSort?.field ?? sortField,
        sort_order: overrideSort?.order ?? sortOrder,
      };
      if (keyword) params.keyword = keyword;
      if (appId) params.app_id = appId;
      if (syncStatus) params.sync_status = syncStatus;
      if (dateRange?.[0]) params.start_date = dateRange[0].format('YYYY-MM-DD');
      if (dateRange?.[1]) params.end_date = dateRange[1].format('YYYY-MM-DD');
      // NID 文件过滤
      const activeNids = overrideNids ?? nidFilter;
      if (activeNids.length > 0) params.nids = activeNids.join(',');

      const res = await axios.get(`${LOCAL_API}/novels/list`, { params });
      if (res.data.code === 10000) {
        setData(res.data.data.list ?? []);
        setPagination(res.data.data.pagination);
      }
    } catch (err) {
      console.error('[NovelList] 查询失败', err);
    } finally {
      setLoading(false);
    }
  }, [keyword, appId, syncStatus, dateRange, sortField, sortOrder, nidFilter]);

  useEffect(() => {
    if (!novelSyncReady) return;
    fetchData();
    // 拉取百家号列表作为下拉选项
    axios.get(`${LOCAL_API}/sync/bjh/cookies`).then(res => {
      if (res.data.code === 10000) {
        const list = (res.data.data ?? []).map((c: any) => ({ value: c.bjh_id, label: c.bjh_name || c.bjh_id }));
        setBjhOptions(list);
      }
    }).catch(() => {});
  }, [novelSyncReady]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!novelSyncReady) {
    return (
      <Card
        style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: 56, textAlign: 'center' } }}
      >
        <SettingOutlined style={{ fontSize: 46, color: '#1677ff', marginBottom: 16 }} />
        <Title level={4} style={{ margin: '0 0 8px' }}>小说同步未启用</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          {novelSyncReason || '请先在设置中启用小说自动同步并配置小说监控目录。'}
        </Text>
        <Button type="primary" icon={<SettingOutlined />} onClick={() => navigate('/settings')}>
          前往设置
        </Button>
      </Card>
    );
  }

  const handleSearch = () => fetchData(1, pagination.pageSize);

  const handleReset = async () => {
    setKeyword('');
    setAppId('');
    setSyncStatus('');
    setDateRange(null);
    setSortField('publish_time');
    setSortOrder('desc');
    setNidFilter([]);
    setNidFileName('');
    setLoading(true);
    try {
      const res = await axios.get(`${LOCAL_API}/novels/list`, { params: { page: 1, page_size: 10, sort_field: 'publish_time', sort_order: 'desc' } });
      if (res.data.code === 10000) {
        setData(res.data.data.list ?? []);
        setPagination(res.data.data.pagination);
      }
    } catch (err) {
      console.error('[NovelList] 重置查询失败', err);
    } finally {
      setLoading(false);
    }
  };

  /** 上传文件到后端解析 NID 列（支持 CSV 和 Excel） */
  const handleNidFileUpload = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post(`${LOCAL_API}/novels/parse-nid-file`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.code === 10000) {
        const { nids, count, total } = res.data.data;
        setNidFilter(nids);
        setNidFileName(file.name);
        const dupInfo = total > count ? `（原始 ${total} 条，去重 ${total - count} 条）` : '';
        message.success(`已加载 ${count} 个 NID 过滤条件${dupInfo}`);
        fetchData(1, pagination.pageSize, undefined, nids);
      } else {
        message.error(res.data.message || '文件解析失败');
      }
    } catch (err) {
      console.error('[NovelList] 上传 NID 文件失败', err);
      message.error('文件上传失败，请重试');
    }
    return false;
  };

  /** 清除 NID 过滤 */
  const handleClearNidFilter = () => {
    setNidFilter([]);
    setNidFileName('');
    fetchData(1, pagination.pageSize, undefined, []);
  };

  const handleSortFieldChange = (value: string) => {
    setSortField(value);
    fetchData(1, pagination.pageSize, { field: value, order: sortOrder });
  };

  const toggleSortOrder = () => {
    const next = sortOrder === 'desc' ? 'asc' : 'desc';
    setSortOrder(next);
    fetchData(1, pagination.pageSize, { field: sortField, order: next });
  };

  const handleMatchFiles = async (title: string) => {
    setMatchTitle(title);
    setMatchModalOpen(true);
    setMatchLoading(true);
    setMatchFiles([]);
    try {
      const res = await axios.get(`${LOCAL_API}/novels/match-files`, { params: { title } });
      if (res.data.code === 10000) {
        setMatchFiles(res.data.data ?? []);
      } else {
        message.warning(res.data.message || '匹配失败');
      }
    } catch (err) {
      message.error('匹配请求失败');
    } finally {
      setMatchLoading(false);
    }
  };

  const handleRevealFile = async (filePath: string) => {
    try {
      const res = await axios.get(`${LOCAL_API}/novels/reveal-file`, { params: { file_path: filePath } });
      if (res.data.code !== 10000) message.warning(res.data.message || '定位失败');
    } catch {
      message.error('定位文件请求失败');
    }
  };

  const handleStartRename = (idx: number) => {
    setRenamingIdx(idx);
    setRenameValue(matchTitle); // 预填小说标题
  };

  const handleCancelRename = () => {
    setRenamingIdx(null);
    setRenameValue('');
  };

  const handleSaveRename = async (idx: number) => {
    const file = matchFiles[idx];
    if (!file || !renameValue.trim()) return;
    if (renameValue.trim() === file.nameWithoutExt) {
      handleCancelRename();
      return;
    }
    setRenameLoading(true);
    try {
      const res = await axios.post(`${LOCAL_API}/novels/rename-file`, {
        filePath: file.filePath,
        newName: renameValue.trim(),
      });
      if (res.data.code === 10000) {
        message.success('重命名成功');
        const d = res.data.data;
        setMatchFiles(prev => prev.map((f, i) => i === idx ? {
          ...f,
          fileName: d.fileName,
          filePath: d.newPath,
          nameWithoutExt: d.nameWithoutExt,
          similarity: 1, // 重命名为标题后相似度=100%
        } : f));
        handleCancelRename();
      } else {
        message.warning(res.data.message || '重命名失败');
      }
    } catch {
      message.error('重命名请求失败');
    } finally {
      setRenameLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getSimilarityColor = (s: number) => s >= 0.8 ? '#52c41a' : s >= 0.6 ? '#1677ff' : '#faad14';
  const getSimilarityTag = (s: number) => s >= 0.8 ? 'green' : s >= 0.6 ? 'blue' : 'orange';

  return (
    <div>
      {/* 搜索栏 */}
      <Card
        style={{ marginBottom: 16, borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: '16px 24px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Input
            placeholder="搜索 ID / NID / 标题"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={handleSearch}
            style={{ width: 280 }}
            prefix={<SearchOutlined style={{ color: '#bbb' }} />}
            allowClear
          />
          <Select
            value={appId || undefined}
            onChange={(v) => { setAppId(v || ''); fetchData(1, pagination.pageSize); }}
            onClear={() => { setAppId(''); setTimeout(() => fetchData(1, pagination.pageSize), 0); }}
            allowClear
            placeholder="百家号"
            style={{ width: 140 }}
            options={bjhOptions}
          />
          <Select
            value={syncStatus || undefined}
            onChange={(v) => { setSyncStatus(v || ''); fetchData(1, pagination.pageSize); }}
            onClear={() => { setSyncStatus(''); setTimeout(() => fetchData(1, pagination.pageSize), 0); }}
            allowClear
            placeholder="同步状态"
            style={{ width: 120 }}
            options={[
              { value: '0', label: '待同步' },
              { value: '1', label: '已同步' },
            ]}
          />
          <RangePicker value={dateRange as any} onChange={(dates) => setDateRange(dates as any)} style={{ width: 240 }} placeholder={['开始日期', '结束日期']} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
            <Select
              value={sortField}
              onChange={handleSortFieldChange}
              style={{ width: 120 }}
              size="middle"
              options={[
                { value: 'publish_time', label: '发布时间' },
                { value: 'read_amount', label: '阅读量' },
                { value: 'order_amount', label: '订单金额' },
                { value: 'like_amount', label: '点赞' },
                { value: 'collection_amount', label: '收藏' },
                { value: 'share_amount', label: '分享' },
                { value: 'rec_count', label: '推荐量' },
              ]}
            />
            <Button
              icon={sortOrder === 'desc' ? <SortDescendingOutlined /> : <SortAscendingOutlined />}
              onClick={toggleSortOrder}
              title={sortOrder === 'desc' ? '当前：降序，点击切换升序' : '当前：升序，点击切换降序'}
            />
          </div>
          <Upload
            accept=".csv,.tsv,.txt,.xlsx"
            showUploadList={false}
            beforeUpload={handleNidFileUpload}
          >
            <Tooltip title="上传包含 NID 列的表格文件（CSV / Excel），批量过滤列表">
              <Button icon={<FileExcelOutlined />}>NID 过滤</Button>
            </Tooltip>
          </Upload>
          {nidFilter.length > 0 && (
            <Tag
              color="purple"
              closable
              onClose={handleClearNidFilter}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: 0, borderRadius: 4, fontSize: 12 }}
            >
              <FileExcelOutlined /> {nidFileName}（{nidFilter.length} 个 NID）
            </Tag>
          )}
          <Button type="primary" onClick={handleSearch}>查询</Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
        </div>
      </Card>

      {/* 列表区域 */}
      <Card
        style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: 0 } }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Title level={5} style={{ margin: 0 }}>小说列表</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>共 {pagination.total} 条记录</Text>
          </div>
        }
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
        ) : data.length === 0 ? (
          <Empty style={{ padding: 60 }} description="暂无数据" />
        ) : (
          <>
            {data.map((item, index) => (
              <div
                key={item.articleId}
                style={{
                  display: 'flex',
                  gap: 16,
                  padding: '18px 24px',
                  borderBottom: index < data.length - 1 ? '1px solid #f0f0f0' : 'none',
                  transition: 'background 0.2s',
                  cursor: 'default',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#fafafa')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {/* 左：封面图 */}
                <div style={{ flexShrink: 0 }}>
                  {item.verticalCover ? (
                    <Image
                      src={item.verticalCover}
                      referrerPolicy="no-referrer"
                      width={120}
                      height={80}
                      style={{ borderRadius: 6, objectFit: 'cover' }}
                      fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjgwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iODAiIGZpbGw9IiNmMGYwZjAiLz48L3N2Zz4="
                    />
                  ) : (
                    <div style={{ width: 120, height: 80, background: '#f5f5f5', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>无封面</Text>
                    </div>
                  )}
                </div>

                {/* 中：内容区 */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  {/* 标题 */}
                  <Tooltip title={item.title} placement="topLeft">
                    <div style={{
                      fontWeight: 600,
                      fontSize: 14,
                      color: '#1a1a1a',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      lineHeight: '22px',
                    }}>
                      {item.isHot ? <FireFilled style={{ color: '#ff4d4f', marginRight: 4, fontSize: 13 }} /> : null}
                      {item.title || '—'}
                    </div>
                  </Tooltip>

                  {/* 标签行 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    {item.isPaySubscribe === 1 && <Tag color="blue" style={{ borderRadius: 4, fontSize: 11, margin: 0, lineHeight: '18px' }}>付费订阅</Tag>}
                    <Tag color="green" style={{ borderRadius: 4, fontSize: 11, margin: 0, lineHeight: '18px' }}>已发布</Tag>
                    <Tag color={item.syncStatus === 1 ? 'cyan' : 'orange'} style={{ borderRadius: 4, fontSize: 11, margin: 0, lineHeight: '18px' }}>
                      {item.syncStatus === 1 ? '已同步' : '待同步'}
                    </Tag>
                    {item.bjhName && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 6 }}>
                        <Avatar size={22} src={item.bjhAvatar} icon={<UserOutlined />} />
                        <Text type="secondary" style={{ fontSize: 13 }}>{item.bjhName}</Text>
                      </span>
                    )}
                  </div>

                  {/* 数据指标行 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 8 }}>
                    <StatItem icon={<EyeOutlined />} value={item.readAmount} label="阅读量" />
                    <StatItem icon={<DollarOutlined />} value={item.orderAmount} label="订单金额" color="#faad14" />
                    <StatItem icon={<LikeOutlined />} value={item.likeAmount} label="点赞" />
                    <StatItem icon={<StarOutlined />} value={item.collectionAmount} label="收藏" />
                    <StatItem icon={<ShareAltOutlined />} value={item.shareAmount} label="分享" />
                    <StatItem icon={<RiseOutlined />} value={item.recCount} label="推荐量" />
                  </div>
                </div>

                {/* 右：日期 + 操作 */}
                <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', minWidth: 180 }}>
                  <Text style={{ fontSize: 12, color: '#999' }}>
                    {item.publishTime ? item.publishTime.replace('T', ' ').substring(0, 19) : '—'}
                  </Text>
                  <div style={{ display: 'flex', gap: 12, marginTop: 'auto', alignItems: 'center' }}>
                    <CopyableText label="ID" value={item.articleId} color="#1677ff" messageApi={message} />
                    {item.nid && (
                      <CopyableText label="NID" value={item.nid} color="#722ed1" messageApi={message} />
                    )}
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        <LinkOutlined style={{ marginRight: 2 }} />查看原文
                      </a>
                    )}
                    {item.syncStatus === 0 && (
                      <Button
                        type="link"
                        size="small"
                        icon={<FolderOpenOutlined />}
                        style={{ fontSize: 12, padding: 0 }}
                        onClick={() => handleMatchFiles(item.title)}
                      >
                        匹配文件
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* 分页 */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '20px 24px', borderTop: '1px solid #f0f0f0' }}>
              <Pagination
                current={pagination.currentPage}
                pageSize={pagination.pageSize}
                total={pagination.total}
                onChange={(page, pageSize) => fetchData(page, pageSize)}
              />
            </div>
          </>
        )}
      </Card>

      {/* 匹配文件弹窗 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderOpenOutlined />
            <span>本地文件匹配</span>
          </div>
        }
        open={matchModalOpen}
        onCancel={() => setMatchModalOpen(false)}
        footer={null}
        width={800}
      >
        {/* 搜索标题展示 */}
        <div style={{ background: '#fafafa', borderRadius: 8, padding: '10px 14px', marginBottom: 16, border: '1px solid #f0f0f0' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>小说标题：</Text>
          <Text strong style={{ fontSize: 13 }}>{matchTitle}</Text>
        </div>

        {matchLoading ? (
          <div style={{ textAlign: 'center', padding: 50 }}>
            <Spin />
            <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>扫描本地文件中...</Text>
          </div>
        ) : matchFiles.length === 0 ? (
          <Empty description="未找到相似文件，请确认本地监控目录是否正确" style={{ padding: '40px 0' }} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {matchFiles.map((file, idx) => (
              <div
                key={idx}
                style={{
                  border: '1px solid #f0f0f0',
                  borderRadius: 10,
                  padding: '14px 16px',
                  transition: 'all 0.2s',
                  cursor: 'default',
                  background: idx === 0 ? '#f6ffed' : '#fff',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = getSimilarityColor(file.similarity); e.currentTarget.style.boxShadow = `0 2px 8px ${getSimilarityColor(file.similarity)}22`; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = '#f0f0f0'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                {/* 摘要行：相似度 + 差异统计 */}
                {(() => {
                  const stats = getDiffStats(matchTitle, file.nameWithoutExt);
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      <Tag color={getSimilarityTag(file.similarity)} style={{ margin: 0, fontSize: 12, borderRadius: 4, fontWeight: 600 }}>
                        相似度 {(file.similarity * 100).toFixed(0)}%
                      </Tag>
                      {stats.missing > 0 && (
                        <span style={{ fontSize: 12, color: '#cf1322' }}>缺失 {stats.missing} 字</span>
                      )}
                      {stats.extra > 0 && (
                        <span style={{ fontSize: 12, color: '#d48806' }}>多余 {stats.extra} 字</span>
                      )}
                      {stats.missing === 0 && stats.extra === 0 && (
                        <span style={{ fontSize: 12, color: '#52c41a' }}>完全一致</span>
                      )}
                    </div>
                  );
                })()}

                {/* 双行对比 */}
                <div style={{ display: 'flex', gap: 10 }}>
                  <FileTextOutlined style={{ color: getSimilarityColor(file.similarity), fontSize: 18, flexShrink: 0, marginTop: 2 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 10, color: '#ff4d4f', background: '#fff1f0', borderRadius: 3, padding: '0 5px', lineHeight: '16px', flexShrink: 0 }}>标题</span>
                      <span style={{ fontSize: 15, color: '#666', wordBreak: 'break-all', lineHeight: '22px' }}>
                        {renderSourceDiff(matchTitle, file.nameWithoutExt)}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <span style={{ fontSize: 10, color: '#389e0d', background: '#f6ffed', borderRadius: 3, padding: '0 5px', lineHeight: '16px', flexShrink: 0 }}>文件</span>
                      <span style={{ fontSize: 15, fontWeight: 500, wordBreak: 'break-all', lineHeight: '22px' }}>
                        {renderTargetDiff(matchTitle, file.nameWithoutExt)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 第二行：相似度条 */}
                <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: '#f0f0f0', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.round(file.similarity * 100)}%`,
                    background: `linear-gradient(90deg, ${getSimilarityColor(file.similarity)}88, ${getSimilarityColor(file.similarity)})`,
                    borderRadius: 2,
                    transition: 'width 0.6s ease',
                  }} />
                </div>

                {/* 第三行：重命名输入 or 路径 */}
                {renamingIdx === idx ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <Input
                      size="small"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onPressEnter={() => handleSaveRename(idx)}
                      style={{ flex: 1, fontSize: 12 }}
                      suffix={<Text type="secondary" style={{ fontSize: 11 }}>{file.fileName.substring(file.nameWithoutExt.length)}</Text>}
                      autoFocus
                    />
                    <Button
                      type="primary"
                      size="small"
                      icon={<SaveOutlined />}
                      loading={renameLoading}
                      onClick={() => handleSaveRename(idx)}
                    >
                      保存
                    </Button>
                    <Button
                      size="small"
                      icon={<CloseCircleOutlined />}
                      onClick={handleCancelRename}
                    />
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
                    <Tooltip title={file.filePath}>
                      <Text type="secondary" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 520 }}>
                        {file.filePath}
                      </Text>
                    </Tooltip>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      <Button
                        type="link"
                        size="small"
                        icon={<EditOutlined />}
                        style={{ fontSize: 12, padding: 0 }}
                        onClick={() => handleStartRename(idx)}
                      >
                        修改文件名
                      </Button>
                      <Button
                        type="link"
                        size="small"
                        icon={<AimOutlined />}
                        style={{ fontSize: 12, padding: 0 }}
                        onClick={() => handleRevealFile(file.filePath)}
                      >
                        在 Finder 中显示
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default NovelList;
