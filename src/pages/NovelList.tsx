import React, { useEffect, useState, useCallback } from 'react';
import { Card, Input, DatePicker, Button, Tag, Image, Typography, Pagination, Spin, Empty, Avatar, Tooltip, message, Select } from 'antd';
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
} from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

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

interface PaginationInfo {
  currentPage: number;
  pageSize: number;
  total: number;
}

/* 数据指标项 */
const StatItem: React.FC<{ icon: React.ReactNode; value: number; label: string; color?: string }> = ({ icon, value, label, color }) => (
  <Tooltip title={`${label}: ${value.toLocaleString()}`}>
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 13, color: color || '#999', cursor: 'default' }}>
      {icon} {value.toLocaleString()}
    </span>
  </Tooltip>
);

/* 可复制文本 */
const CopyableText: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <Tooltip title="点击复制">
    <span
      style={{ fontSize: 11, color, cursor: 'pointer', userSelect: 'none' }}
      onClick={() => {
        navigator.clipboard.writeText(value).then(() => message.success(`已复制 ${label}: ${value}`));
      }}
    >
      {label}: {value}
    </span>
  </Tooltip>
);

const NovelList: React.FC = () => {
  const [data, setData] = useState<NovelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<PaginationInfo>({ currentPage: 1, pageSize: 10, total: 0 });

  const [keyword, setKeyword] = useState('');
  const [appId, setAppId] = useState('');
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [sortField, setSortField] = useState('publish_time');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [bjhOptions, setBjhOptions] = useState<{ value: string; label: string }[]>([]);

  const fetchData = useCallback(async (page = 1, pageSize = 10, overrideSort?: { field: string; order: string }) => {
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
      if (dateRange?.[0]) params.start_date = dateRange[0].format('YYYY-MM-DD');
      if (dateRange?.[1]) params.end_date = dateRange[1].format('YYYY-MM-DD');

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
  }, [keyword, appId, dateRange, sortField, sortOrder]);

  useEffect(() => {
    fetchData();
    // 拉取百家号列表作为下拉选项
    axios.get(`${LOCAL_API}/sync/bjh/cookies`).then(res => {
      if (res.data.code === 10000) {
        const list = (res.data.data ?? []).map((c: any) => ({ value: c.bjh_id, label: c.bjh_name || c.bjh_id }));
        setBjhOptions(list);
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = () => fetchData(1, pagination.pageSize);

  const handleReset = async () => {
    setKeyword('');
    setAppId('');
    setDateRange(null);
    setSortField('publish_time');
    setSortOrder('desc');
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

  const handleSortFieldChange = (value: string) => {
    setSortField(value);
    fetchData(1, pagination.pageSize, { field: value, order: sortOrder });
  };

  const toggleSortOrder = () => {
    const next = sortOrder === 'desc' ? 'asc' : 'desc';
    setSortOrder(next);
    fetchData(1, pagination.pageSize, { field: sortField, order: next });
  };

  return (
    <div>
      {/* 搜索栏 */}
      <Card
        style={{ marginBottom: 16, borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        bodyStyle={{ padding: '16px 24px' }}
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
          <Button type="primary" onClick={handleSearch}>查询</Button>
          <Button icon={<ReloadOutlined />} onClick={handleReset}>重置</Button>
        </div>
      </Card>

      {/* 列表区域 */}
      <Card
        style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
        bodyStyle={{ padding: 0 }}
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
                    <CopyableText label="ID" value={item.articleId} color="#1677ff" />
                    {item.nid && (
                      <CopyableText label="NID" value={item.nid} color="#722ed1" />
                    )}
                    {item.url && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        <LinkOutlined style={{ marginRight: 2 }} />查看原文
                      </a>
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
    </div>
  );
};

export default NovelList;
