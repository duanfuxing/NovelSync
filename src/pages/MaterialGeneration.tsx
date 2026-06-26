import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Badge,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Empty,
  Form,
  Image,
  Input,
  InputNumber,
  Progress,
  Select,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CopyOutlined,
  DownloadOutlined,
  FilterOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { materialApi } from '../api/material';
import { useAppStore } from '../store';
import type {
  MaterialConfigStatus,
  MaterialDownloadJob,
  MaterialImage,
  MaterialTask,
  MaterialTaskStatus,
} from '../types/material';

const { Text, Title, Paragraph } = Typography;

const ACTIVE_STATUSES = new Set<MaterialTaskStatus>(['pending', 'running', 'cancel_requested']);

const statusMeta: Record<MaterialTaskStatus, { label: string; color: string; icon?: React.ReactNode }> = {
  pending: { label: '排队中', color: 'default', icon: <SyncOutlined /> },
  running: { label: '生成中', color: 'processing', icon: <SyncOutlined spin /> },
  success: { label: '成功', color: 'success', icon: <CheckCircleFilled /> },
  partial_failed: { label: '部分失败', color: 'warning', icon: <CloseCircleFilled /> },
  failed: { label: '失败', color: 'error', icon: <CloseCircleFilled /> },
  cancel_requested: { label: '取消中', color: 'warning', icon: <SyncOutlined spin /> },
  canceled: { label: '已取消', color: 'default' },
  deleted: { label: '已删除', color: 'default' },
  interrupted: { label: '已中断', color: 'warning' },
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '—';
  return value.replace('T', ' ').substring(0, 19);
};

const getProgressPercent = (task?: MaterialTask | null) => {
  if (typeof task?.progressPercent !== 'number' || !Number.isFinite(task.progressPercent)) return null;
  return Math.min(100, Math.max(0, Math.round(task.progressPercent)));
};

const getProgressText = (task?: MaterialTask | null) => {
  const progress = getProgressPercent(task);
  return progress === null ? '进度同步中' : `${progress}%`;
};

const getTaskProgressStatus = (task?: MaterialTask | null): 'normal' | 'active' | 'success' | 'exception' => {
  if (!task) return 'normal';
  if (task.status === 'failed' || task.status === 'partial_failed') return 'exception';
  if (task.status === 'success') return 'success';
  if (ACTIVE_STATUSES.has(task.status)) return 'active';
  return 'normal';
};

const getDownloadProgressPercent = (job?: MaterialDownloadJob | null) => {
  if (!job?.total) return 0;
  return Math.min(100, Math.round(((job.savedCount + job.failedCount) / job.total) * 100));
};

const getImageSource = (image: MaterialImage) => image.remoteUrl || undefined;

const getImageSizeText = (image: MaterialImage, task?: MaterialTask | null) => {
  if (image.width && image.height) return `${image.width} x ${image.height}`;
  return task?.imageSize || '—';
};

const getImageStatusLabel = (status: MaterialImage['status']) => {
  if (status === 'success') return '成功';
  if (status === 'failed') return '失败';
  if (status === 'canceled') return '已取消';
  return '生成中';
};

const getImageStatusTagColor = (status: MaterialImage['status']) => {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'canceled') return 'default';
  return 'processing';
};

const getImageCardClassName = (image: MaterialImage, checked: boolean) => [
  'material-image-card',
  checked ? 'material-image-card-selected' : '',
  image.status === 'failed' ? 'material-image-card-failed' : '',
  image.status !== 'success' ? 'material-image-card-pending' : '',
].filter(Boolean).join(' ');

const getPlaceholderText = (image: MaterialImage) => {
  if (image.status === 'failed') return '生成失败';
  if (image.status === 'canceled') return '已取消';
  if (image.status === 'pending') return '等待生成';
  return '图片生成中';
};

const TaskStatusTag: React.FC<{ status: MaterialTaskStatus }> = ({ status }) => {
  const meta = statusMeta[status] ?? statusMeta.pending;
  return (
    <Tag icon={meta.icon} color={meta.color} style={{ margin: 0, borderRadius: 4, fontSize: 12 }}>
      {meta.label}
    </Tag>
  );
};

const MaterialGeneration: React.FC = () => {
  const { clientId } = useAppStore();
  const navigate = useNavigate();
  const { message, modal } = AntdApp.useApp();
  const [form] = Form.useForm();
  const [tasks, setTasks] = useState<MaterialTask[]>([]);
  const [images, setImages] = useState<MaterialImage[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [tasksLoading, setTasksLoading] = useState(false);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outputDir, setOutputDir] = useState<string | null>(null);
  const [outputDirChecked, setOutputDirChecked] = useState(false);
  const [configStatus, setConfigStatus] = useState<MaterialConfigStatus | null>(null);
  const [selectedImageIds, setSelectedImageIds] = useState<string[]>([]);
  const [taskTitleFilter, setTaskTitleFilter] = useState('');
  const [taskDateRange, setTaskDateRange] = useState<[string, string] | null>(null);
  const [taskFiltersCollapsed, setTaskFiltersCollapsed] = useState(true);
  const [downloadSubmitting, setDownloadSubmitting] = useState(false);
  const [activeDownloadJobId, setActiveDownloadJobId] = useState('');
  const [activeDownloadJob, setActiveDownloadJob] = useState<MaterialDownloadJob | null>(null);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.taskId === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );
  const activeTaskIds = useMemo(
    () => tasks
      .filter((task) => task.taskId && ACTIVE_STATUSES.has(task.status))
      .map((task) => task.taskId)
      .slice(0, 100),
    [tasks],
  );
  const activeTaskKey = activeTaskIds.join(',');

  const selectedImages = useMemo(
    () => images.filter((image) => selectedImageIds.includes(image.imageId)),
    [images, selectedImageIds],
  );
  const downloadableSelectedImages = useMemo(
    () => selectedImages.filter((image) => Boolean(getImageSource(image))),
    [selectedImages],
  );
  const downloadableImages = useMemo(
    () => images.filter((image) => Boolean(getImageSource(image))),
    [images],
  );
  const allDownloadableSelected = downloadableImages.length > 0
    && downloadableImages.every((image) => selectedImageIds.includes(image.imageId));
  const taskFiltersActive = Boolean(taskTitleFilter.trim() || taskDateRange);
  const downloadInProgress = downloadSubmitting || Boolean(activeDownloadJobId);
  const downloadProgressPercent = getDownloadProgressPercent(activeDownloadJob);

  const loadMaterialConfig = useCallback(async () => {
    try {
      const status = await materialApi.getConfigStatus();
      setConfigStatus(status);
      setOutputDir(status.outputDir);
      form.setFieldsValue({ imageSize: status.cloudConfig?.defaultImageSize || '1140x640' });
    } catch {
      try {
        const dir = await materialApi.getOutputDir(clientId);
        setOutputDir(dir);
      } catch {
        setOutputDir(null);
      }
    } finally {
      setOutputDirChecked(true);
    }
  }, [clientId, form]);

  const loadTasks = useCallback(async (
    preferredTaskId?: string,
    overrideFilters?: { title?: string; startDate?: string; endDate?: string },
  ) => {
    setTasksLoading(true);
    try {
      const filters = overrideFilters ?? {
        title: taskTitleFilter.trim(),
        startDate: taskDateRange?.[0],
        endDate: taskDateRange?.[1],
      };
      const nextTasks = await materialApi.getTasks({
        title: filters.title,
        startDate: filters.startDate,
        endDate: filters.endDate,
      });
      setTasks(nextTasks);
      const nextSelected =
        preferredTaskId ||
        (selectedTaskId && nextTasks.some((task) => task.taskId === selectedTaskId) ? selectedTaskId : '') ||
        nextTasks[0]?.taskId ||
        '';
      setSelectedTaskId(nextSelected);
    } catch (error: any) {
      message.error(error?.message || '任务列表加载失败');
    } finally {
      setTasksLoading(false);
    }
  }, [selectedTaskId, taskDateRange, taskTitleFilter]);

  const loadImages = useCallback(async (taskId: string) => {
    if (!taskId) {
      setImages([]);
      return;
    }
    setImagesLoading(true);
    try {
      const nextImages = await materialApi.getTaskImages(taskId);
      setImages(nextImages);
      const nextImageIds = new Set(nextImages.map((image) => image.imageId));
      setSelectedImageIds((current) => current.filter((imageId) => nextImageIds.has(imageId)));
    } catch (error: any) {
      message.error(error?.message || '图片列表加载失败');
    } finally {
      setImagesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMaterialConfig();
    loadTasks();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadImages(selectedTaskId);
  }, [selectedTaskId, loadImages]);

  useEffect(() => {
    if (!activeTaskKey) return undefined;

    const poll = async () => {
      try {
        const progressRows = await materialApi.getTaskProgress(activeTaskIds);
        if (progressRows.length > 0) {
          const progressMap = new Map(progressRows.map((row) => [row.taskId, row]));
          setTasks((current) => current.map((task) => {
            const progress = progressMap.get(task.taskId);
            if (!progress) return task;
            return {
              ...task,
              status: progress.status,
              requestedCount: progress.requestedCount,
              successCount: progress.successCount,
              failedCount: progress.failedCount,
              progressPercent: progress.progressPercent,
              nextPollAfterSeconds: progress.nextPollAfterSeconds,
            };
          }));
        }
        if (selectedTaskId && activeTaskIds.includes(selectedTaskId)) {
          loadImages(selectedTaskId);
        }
      } catch (error) {
        console.warn('[MaterialGeneration] task progress polling failed', error);
      }
    };

    const timer = window.setInterval(poll, 10000);
    return () => window.clearInterval(timer);
  }, [activeTaskIds, activeTaskKey, loadImages, selectedTaskId]);

  useEffect(() => {
    if (!activeDownloadJobId) return undefined;

    let stopped = false;
    let timer: number | undefined;
    const finishJob = (job: MaterialDownloadJob) => {
      setActiveDownloadJobId('');
      setActiveDownloadJob(null);
      if (job.status === 'success') {
        modal.success({
          title: '批量下载完成',
          content: job.message || `图片已保存到输出目录中，共 ${job.savedCount} 张`,
        });
        return;
      }
      if (job.status === 'partial_failed') {
        modal.warning({
          title: '批量下载部分失败',
          content: job.message || `部分图片保存失败，成功 ${job.savedCount} 张，失败 ${job.failedCount} 张`,
        });
        return;
      }
      modal.error({
        title: '批量下载失败',
        content: job.message || '批量下载失败',
      });
    };
    const poll = async () => {
      try {
        const job = await materialApi.getDownloadJob(activeDownloadJobId);
        if (stopped) return;
        setActiveDownloadJob(job);
        if (job.status === 'success' || job.status === 'partial_failed' || job.status === 'failed') {
          finishJob(job);
          return;
        }
        timer = window.setTimeout(poll, 3000);
      } catch (error: any) {
        if (stopped) return;
        setActiveDownloadJobId('');
        setActiveDownloadJob(null);
        message.error(error?.message || '批量下载状态查询失败');
      }
    };

    timer = window.setTimeout(poll, 3000);
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeDownloadJobId, message, modal]);

  const handleCreateTask = async (values: {
    title?: string;
    count: number;
    imageSize?: string;
  }) => {
    const title = values.title?.trim();
    setSubmitting(true);
    try {
      const task = await materialApi.createTask({
        title: title || undefined,
        count: values.count,
        imageSize: values.imageSize,
      });
      message.success('制作任务已提交');
      form.setFieldsValue({ title: undefined });
      await loadTasks(task.taskId);
      await loadImages(task.taskId);
    } catch (error: any) {
      message.error(error?.message || '制作任务提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyPrompt = async (prompt: string) => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    message.success('提示词已复制');
  };

  const handleRetryImage = async (image: MaterialImage) => {
    try {
      await materialApi.retryImage(image);
      message.success('图片已提交重新生成');
      await loadTasks(image.taskId);
      await loadImages(image.taskId);
    } catch (error: any) {
      message.error(error?.message || '图片重新生成失败');
    }
  };

  const handleDownloadImage = (image: MaterialImage) => {
    const source = getImageSource(image);
    if (!source) return;
    const link = document.createElement('a');
    link.href = source;
    link.download = `${image.imageId || `image_${image.imageIndex || 1}`}.jpeg`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleToggleImageSelected = (imageId: string, checked: boolean) => {
    setSelectedImageIds((current) => {
      if (checked) return current.includes(imageId) ? current : [...current, imageId];
      return current.filter((id) => id !== imageId);
    });
  };

  const handleToggleAllDownloadableImages = () => {
    if (allDownloadableSelected) {
      const downloadableIds = new Set(downloadableImages.map((image) => image.imageId));
      setSelectedImageIds((current) => current.filter((imageId) => !downloadableIds.has(imageId)));
      return;
    }
    setSelectedImageIds((current) => {
      const next = new Set(current);
      downloadableImages.forEach((image) => next.add(image.imageId));
      return Array.from(next);
    });
  };

  const handleBulkDownload = async () => {
    if (downloadableSelectedImages.length === 0) {
      message.warning('请先选择可下载的图片');
      return;
    }
    if (activeDownloadJobId) {
      message.warning('已有批量下载任务正在执行');
      return;
    }
    setDownloadSubmitting(true);
    try {
      const job = await materialApi.downloadImages(
        selectedTaskId,
        downloadableSelectedImages.map((image) => image.imageId),
      );
      setActiveDownloadJob(job);
      setActiveDownloadJobId(job.downloadJobId);
      message.success('已开始后台下载，完成后会通知');
    } catch (error: any) {
      message.error(error?.message || '批量下载失败');
    } finally {
      setDownloadSubmitting(false);
    }
  };

  const handleCancelTask = async (task: MaterialTask) => {
    try {
      await materialApi.cancelTask(task.taskId);
      message.success('已提交取消请求');
      loadTasks(task.taskId);
    } catch (error: any) {
      message.error(error?.message || '取消任务失败');
    }
  };

  const handleRetryTask = async (task: MaterialTask) => {
    try {
      await materialApi.retryFailed(task.taskId);
      message.success('已提交重试请求');
      loadTasks(task.taskId);
    } catch (error: any) {
      message.error(error?.message || '重试失败项失败');
    }
  };

  const handleManualRefresh = async () => {
    if (!selectedTaskId) return;
    await loadTasks(selectedTaskId);
    await loadImages(selectedTaskId);
  };

  const handleRevealOutputDir = async () => {
    try {
      await materialApi.revealOutputDir();
    } catch (error: any) {
      message.error(error?.message || '打开目录失败');
    }
  };

  const handleApplyTaskFilters = async () => {
    await loadTasks();
  };

  const handleClearTaskFilters = async () => {
    setTaskTitleFilter('');
    setTaskDateRange(null);
    await loadTasks(undefined, {});
  };

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'grid', gridTemplateColumns: '320px minmax(520px, 1fr) 340px', gap: 16, overflow: 'hidden' }}>
      <Card
        title={<Title level={5} style={{ margin: 0 }}>提交制作</Title>}
        style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', minHeight: 0, overflow: 'hidden' }}
        styles={{ body: { height: 'calc(100% - 57px)', padding: 18, overflow: 'auto' } }}
      >
        {outputDirChecked && !outputDir && (
          <Alert
            type="warning"
            showIcon
            message="素材输出目录未设置"
            description="后端未返回素材输出目录时，提交任务可能会被拒绝。"
            action={
              <Button size="small" type="primary" icon={<FolderOpenOutlined />} onClick={() => navigate('/settings')}>
                设置输出目录
              </Button>
            }
            style={{ marginBottom: 16, borderRadius: 8 }}
          />
        )}
        {configStatus && outputDir && !configStatus.ready && (
          <Alert
            type="warning"
            showIcon
            message="素材制作配置未就绪"
            description={
              <div style={{ fontSize: 12 }}>
                {!configStatus.outputDirReady && <div>{configStatus.outputDirError || '素材输出目录不可用'}</div>}
                {!configStatus.textServiceConfigured && <div>提示词服务未配置</div>}
                {!configStatus.imageServiceConfigured && <div>生图服务未配置</div>}
              </div>
            }
            action={
              !configStatus.outputDirReady ? (
                <Button size="small" type="primary" icon={<FolderOpenOutlined />} onClick={() => navigate('/settings')}>
                  设置输出目录
                </Button>
              ) : undefined
            }
            style={{ marginBottom: 16, borderRadius: 8 }}
          />
        )}
        {outputDir && (
          <div style={{ padding: '10px 12px', border: '1px solid #f0f0f0', borderRadius: 8, marginBottom: 16, background: '#fafafa' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>输出目录</Text>
              <Button type="link" size="small" icon={<FolderOpenOutlined />} style={{ height: 20, padding: 0 }} onClick={handleRevealOutputDir}>
                打开目录
              </Button>
            </div>
            <Tooltip title={outputDir}>
              <Text style={{ fontSize: 12, display: 'block' }} ellipsis>{outputDir}</Text>
            </Tooltip>
          </div>
        )}

        <Form
          form={form}
          layout="vertical"
          initialValues={{ count: 10, imageSize: '1140x640' }}
          onFinish={handleCreateTask}
          requiredMark={false}
        >
          <Form.Item name="title" label="任务名称">
            <Input placeholder="未填写时使用系统默认名称" maxLength={40} allowClear />
          </Form.Item>

          <Form.Item
            name="count"
            label="制作数量"
            rules={[
              { required: true, message: '请输入制作数量' },
              { type: 'number', max: 100, message: '妙笔单次最多制作 100 张图片' },
            ]}
          >
            <InputNumber min={1} max={100} precision={0} style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="imageSize"
            label="图片尺寸"
            rules={[{ required: true, message: '请选择图片尺寸' }]}
          >
            <Select
              options={(configStatus?.cloudConfig?.imageSizes?.length
                ? configStatus.cloudConfig.imageSizes
                : [
                  { value: '1140x640', label: '1140x640（大图）', width: 1140, height: 640 },
                  { value: '370x245', label: '370x245（小图）', width: 370, height: 245 },
                ]).map((item) => ({ value: item.value, label: item.label || item.value }))}
            />
          </Form.Item>

          <Button
            type="primary"
            htmlType="submit"
            icon={<PlayCircleOutlined />}
            loading={submitting}
            block
            size="large"
            style={{ borderRadius: 8, height: 44 }}
          >
            开始制作
          </Button>
        </Form>
      </Card>

      <Card
        style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
        styles={{ body: { flex: 1, minHeight: 0, padding: 0, overflow: 'auto' } }}
        title={
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Title level={5} style={{ margin: 0, lineHeight: 1.3 }}>图片展示</Title>
                {selectedImageIds.length > 0 && (
                  <Tag color="geekblue" style={{ margin: 0, borderRadius: 4 }}>
                    已选 {selectedImageIds.length}
                  </Tag>
                )}
                {activeDownloadJob && (
                  <div className="material-download-progress">
                    <Text type="secondary" className="material-download-progress-text">
                      批量下载 {activeDownloadJob.savedCount + activeDownloadJob.failedCount}/{activeDownloadJob.total}
                    </Text>
                    <Progress
                      percent={downloadProgressPercent}
                      size="small"
                      showInfo={false}
                      status={activeDownloadJob.failedCount > 0 ? 'exception' : 'active'}
                      className="material-download-progress-bar"
                    />
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button icon={<ReloadOutlined />} disabled={!selectedTaskId} onClick={handleManualRefresh}>
                刷新
              </Button>
              <Button
                disabled={downloadableImages.length === 0}
                onClick={handleToggleAllDownloadableImages}
              >
                {allDownloadableSelected ? '取消全选' : '全选'}
              </Button>
              <Button
                icon={<DownloadOutlined />}
                loading={downloadInProgress}
                disabled={downloadableSelectedImages.length === 0}
                onClick={handleBulkDownload}
              >
                {downloadInProgress ? '下载中' : '批量下载'}
              </Button>
            </div>
          </div>
        }
      >
        {imagesLoading ? (
          <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
        ) : !selectedTask ? (
          <Empty style={{ padding: 80 }} description="暂无任务" />
        ) : (
          <div className="material-images-content">
            {images.length === 0 ? (
              <Empty style={{ padding: 64 }} description="该任务暂无图片" />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
            {images.map((image, index) => {
              const imageText = image.errorMsg || image.prompt || '—';
              const imageSizeText = getImageSizeText(image, selectedTask);
              const positionText = `#${index + 1}`;
              const checked = selectedImageIds.includes(image.imageId);
              const isGenerating = image.status === 'pending' || image.status === 'running';
              const isFailed = image.status === 'failed';
              return (
              <Card
                key={image.imageId}
                hoverable
                onClick={() => handleToggleImageSelected(image.imageId, !checked)}
                className={getImageCardClassName(image, checked)}
                styles={{ body: { padding: 0 } }}
                cover={
                  image.status === 'success' && getImageSource(image) ? (
	                    <Image
	                      src={getImageSource(image)}
	                      height="100%"
	                      preview={{ mask: '预览图片' }}
	                      onClick={(event) => event.stopPropagation()}
	                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      fallback="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDMyMCAyMDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjMyMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNmNWY1ZjUiLz48dGV4dCB4PSIxNjAiIHk9IjEwNCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzk5IiBmb250LXNpemU9IjE0Ij7ml6Dms5XliqDovb3lm77niYc8L3RleHQ+PC9zdmc+"
                    />
                  ) : (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      className={[
                        'material-image-placeholder',
                        isGenerating ? 'material-image-placeholder-generating' : '',
                        isFailed ? 'material-image-placeholder-failed' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {isGenerating ? (
                        <div className="material-image-generating-mask">
                          <div className="material-image-generating-icon">
                            <SyncOutlined spin />
                          </div>
                          <Text className="material-image-generating-title">
                            {getPlaceholderText(image)}
                          </Text>
                          <Text className="material-image-generating-subtitle">
                            {imageSizeText} · {positionText}
                          </Text>
                        </div>
                      ) : isFailed ? (
                        <div className="material-image-failed-mask">
                          <div className="material-image-failed-icon">
                            <CloseCircleFilled />
                          </div>
                          <Text className="material-image-failed-title">
                            生成失败
                          </Text>
                          <Text className="material-image-failed-subtitle">
                            {imageSizeText} · {positionText}
                          </Text>
                        </div>
                      ) : (
                        <>
                          <div className="material-image-placeholder-icon">
                            <FileImageOutlined />
                          </div>
                          <Text className="material-image-placeholder-title">
                            {getPlaceholderText(image)}
                          </Text>
                          <Text className="material-image-placeholder-subtitle">
                            {imageSizeText} · {positionText}
                          </Text>
                        </>
                      )}
                    </div>
                  )
                }
              >
                <div className="material-image-card-body">
                  <div className="material-image-card-meta">
                    <div className="material-image-card-status">
                      <Checkbox
                        checked={checked}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => handleToggleImageSelected(image.imageId, event.target.checked)}
                      />
                      <Tag color={getImageStatusTagColor(image.status)} style={{ margin: 0, borderRadius: 4, fontSize: 12 }}>
                        {getImageStatusLabel(image.status)}
                      </Tag>
                    </div>
                    <Text type="secondary" className="material-image-card-size">
                      {imageSizeText} · {positionText}
                    </Text>
                  </div>
                  <Text type="secondary" className="material-image-card-time">
                    {formatDateTime(image.createdAt)}
                  </Text>
                  <Tooltip title={imageText}>
                    <Paragraph
                      ellipsis={{
                        rows: isGenerating ? 1 : isFailed ? 2 : 3,
                        expandable: !isGenerating && !isFailed,
                        symbol: '展开',
                      }}
                      className={`material-image-card-text ${isFailed ? 'material-image-card-text-error' : ''}`}
                    >
                      {isGenerating && imageText === '—'
                        ? '等待妙笔返回图片'
                        : isFailed && imageText !== '—'
                          ? `失败原因：${imageText}`
                          : imageText}
                    </Paragraph>
                  </Tooltip>
                </div>
                <div className="material-image-card-actions">
                  <Tooltip title="下载图片">
                    <Button size="small" icon={<DownloadOutlined />} disabled={!getImageSource(image)} style={{ width: '100%' }} onClick={(event) => { event.stopPropagation(); handleDownloadImage(image); }} />
                  </Tooltip>
                  <Tooltip title="重新生成">
                    <Button size="small" icon={<ReloadOutlined />} style={{ width: '100%' }} onClick={(event) => { event.stopPropagation(); handleRetryImage(image); }} />
                  </Tooltip>
                  <Tooltip title="复制提示词">
                    <Button size="small" icon={<CopyOutlined />} disabled={!image.prompt} style={{ width: '100%' }} onClick={(event) => { event.stopPropagation(); handleCopyPrompt(image.prompt); }} />
                  </Tooltip>
                </div>
              </Card>
              );
            })}
              </div>
            )}
          </div>
        )}
      </Card>

      <Card
        style={{ borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', minHeight: 0, overflow: 'hidden' }}
        styles={{ body: { height: 'calc(100% - 57px)', padding: 0, overflow: 'auto' } }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Title level={5} style={{ margin: 0 }}>任务列表</Title>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tooltip title={taskFiltersCollapsed ? '展开筛选' : '收起筛选'}>
                <Button
                  size="small"
                  type={taskFiltersActive ? 'primary' : 'default'}
                  icon={<FilterOutlined />}
                  onClick={() => setTaskFiltersCollapsed((collapsed) => !collapsed)}
                />
              </Tooltip>
              <Badge count={tasks.length} style={{ backgroundColor: '#1677ff' }} />
            </div>
          </div>
        }
      >
        {!taskFiltersCollapsed && (
          <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0', display: 'grid', gap: 8 }}>
            <Input
              allowClear
              placeholder="按任务标题筛选"
              value={taskTitleFilter}
              onChange={(event) => setTaskTitleFilter(event.target.value)}
              onPressEnter={handleApplyTaskFilters}
            />
            <DatePicker.RangePicker
              value={taskDateRange ? [dayjs(taskDateRange[0]), dayjs(taskDateRange[1])] : null}
              placeholder={['开始日期', '结束日期']}
              style={{ width: '100%' }}
              onChange={(_, dateStrings) => setTaskDateRange(dateStrings[0] && dateStrings[1] ? [dateStrings[0], dateStrings[1]] : null)}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Button type="primary" onClick={handleApplyTaskFilters}>查询</Button>
              <Button onClick={handleClearTaskFilters}>清空</Button>
            </div>
          </div>
        )}
        {tasksLoading && tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 80 }}><Spin /></div>
        ) : tasks.length === 0 ? (
          <Empty style={{ padding: 60 }} description="暂无制作任务" />
        ) : (
          <div>
            {tasks.map((task, index) => {
              const selected = task.taskId === selectedTaskId;
              const progress = getProgressPercent(task);
              const progressText = getProgressText(task);
              return (
                <div
                  key={task.taskId}
                  onClick={() => setSelectedTaskId(task.taskId)}
                  style={{
                    padding: '14px 16px',
                    borderBottom: index < tasks.length - 1 ? '1px solid #f0f0f0' : 'none',
                    borderLeft: selected ? '3px solid #1677ff' : '3px solid transparent',
                    background: selected ? '#f0f7ff' : '#fff',
                    cursor: 'pointer',
                    transition: 'background 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <Tooltip title={task.title}>
                        <Text strong style={{ display: 'block', fontSize: 14, maxWidth: 190 }} ellipsis>{task.title}</Text>
                      </Tooltip>
                      <Tooltip title={task.taskId}>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11, maxWidth: 190 }} ellipsis>
                          ID：{task.taskId}
                        </Text>
                      </Tooltip>
                    </div>
                    <div style={{ display: 'grid', justifyItems: 'end', gap: 4 }}>
                      <TaskStatusTag status={task.status} />
                      <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                        {progressText}
                      </Text>
                    </div>
                  </div>
                  <Progress
                    percent={progress ?? 0}
                    size="small"
                    showInfo={false}
                    status={getTaskProgressStatus(task)}
                    strokeColor={progress === null ? '#d9d9d9' : undefined}
                    style={{ marginBottom: 6 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{formatDateTime(task.createdAt)}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {task.successCount}/{task.requestedCount}
                      {task.failedCount > 0 ? `，失败 ${task.failedCount}` : ''}
                    </Text>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {ACTIVE_STATUSES.has(task.status) && (
                      <Button size="small" danger onClick={(event) => { event.stopPropagation(); handleCancelTask(task); }}>
                        取消
                      </Button>
                    )}
                    {task.failedCount > 0 && !ACTIVE_STATUSES.has(task.status) && (
                      <Button size="small" onClick={(event) => { event.stopPropagation(); handleRetryTask(task); }}>
                        重试失败项
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default MaterialGeneration;
