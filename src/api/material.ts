import axios from 'axios';
import type {
  MaterialConfigStatus,
  MaterialDownloadJob,
  MaterialImage,
  MaterialTask,
  MaterialTaskCreateInput,
  MaterialTaskProgress,
} from '../types/material';

const LOCAL_API = import.meta.env.VITE_LOCAL_API_BASE_URL;

const unwrapData = (res: any) => {
  if (res?.data?.code !== undefined && res.data.code !== 10000) {
    throw new Error(res.data.message || '请求失败');
  }
  return res?.data?.data ?? res?.data;
};

const formatValidationDetail = (detail: any): string => {
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return '';

  return detail
    .map((item) => {
      if (typeof item === 'string') return item;
      const location = Array.isArray(item?.loc) ? item.loc.filter((part: any) => part !== 'body').join('.') : '';
      const text = item?.msg || item?.message || '';
      if (!location) return text;
      return text ? `${location}: ${text}` : location;
    })
    .filter(Boolean)
    .join('；');
};

const getErrorMessage = (error: any): string => {
  const responseData = error?.response?.data;
  const validationMessage = formatValidationDetail(responseData?.detail);
  return responseData?.message
    || validationMessage
    || responseData?.error
    || error?.message
    || '请求失败';
};

const requestData = async <T = any>(request: Promise<any>): Promise<T> => {
  try {
    return unwrapData(await request);
  } catch (error: any) {
    throw new Error(getErrorMessage(error));
  }
};

const taskStatusMap: Record<string, MaterialTask['status']> = {
  '1': 'pending',
  '2': 'running',
  '3': 'success',
  '4': 'failed',
  '5': 'partial_failed',
  '6': 'cancel_requested',
  '7': 'canceled',
  '8': 'deleted',
};

const imageStatusMap: Record<string, MaterialImage['status']> = {
  '1': 'pending',
  '2': 'running',
  '3': 'success',
  '4': 'failed',
  '5': 'canceled',
};

const normalizeTaskStatus = (value: any): MaterialTask['status'] => {
  const raw = String(value ?? 'pending');
  return taskStatusMap[raw] ?? raw as MaterialTask['status'];
};

const normalizeImageStatus = (value: any): MaterialImage['status'] => {
  const raw = String(value ?? 'pending');
  return imageStatusMap[raw] ?? raw as MaterialImage['status'];
};

const normalizeOptionalNumber = (value: any): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
};

const normalizeTask = (raw: any): MaterialTask => ({
  taskId: String(raw.taskId ?? raw.taskNo ?? raw.task_id ?? raw.id ?? ''),
  title: raw.title ?? raw.taskName ?? raw.task_name ?? '素材制作任务',
  status: normalizeTaskStatus(raw.statusText ?? raw.status),
  requestedCount: Number(raw.requestedCount ?? raw.requested_count ?? raw.count ?? 0),
  successCount: Number(raw.successCount ?? raw.success_count ?? 0),
  failedCount: Number(raw.failedCount ?? raw.failed_count ?? 0),
  progressPercent: normalizeOptionalNumber(raw.progressPercent ?? raw.progress_percent),
  nextPollAfterSeconds: normalizeOptionalNumber(raw.nextPollAfterSeconds ?? raw.next_poll_after_seconds) ?? undefined,
  outputDir: raw.outputDir ?? raw.output_dir ?? '',
  imageSize: raw.imageSize ?? raw.image_size,
  negativePrompt: raw.negativePrompt ?? raw.negative_prompt,
  promptExtend: Boolean(raw.promptExtend ?? raw.prompt_extend ?? false),
  createdAt: raw.createdAt ?? raw.created_at ?? '',
  startedAt: raw.startedAt ?? raw.started_at ?? null,
  finishedAt: raw.finishedAt ?? raw.finished_at ?? null,
  errorMsg: raw.errorMsg ?? raw.error_msg ?? null,
});

const normalizeTaskProgress = (raw: any): MaterialTaskProgress => ({
  taskId: String(raw.taskId ?? raw.taskNo ?? raw.task_id ?? ''),
  status: normalizeTaskStatus(raw.statusText ?? raw.status),
  requestedCount: Number(raw.requestedCount ?? raw.requested_count ?? raw.count ?? 0),
  successCount: Number(raw.successCount ?? raw.success_count ?? 0),
  failedCount: Number(raw.failedCount ?? raw.failed_count ?? 0),
  progressPercent: normalizeOptionalNumber(raw.progressPercent ?? raw.progress_percent),
  nextPollAfterSeconds: normalizeOptionalNumber(raw.nextPollAfterSeconds ?? raw.next_poll_after_seconds) ?? undefined,
});

const normalizeImage = (raw: any): MaterialImage => ({
  imageId: String(raw.imageId ?? raw.imageNo ?? raw.image_id ?? raw.id ?? ''),
  taskId: String(raw.taskId ?? raw.taskNo ?? raw.task_id ?? ''),
  promptId: raw.promptId ?? raw.itemNo ?? raw.prompt_id,
  imageIndex: Number(raw.imageIndex ?? raw.image_index ?? raw.index ?? 0),
  localPath: raw.localPath ?? raw.local_path ?? raw.path ?? '',
  remoteUrl: raw.remoteUrl ?? raw.remote_url ?? raw.url ?? null,
  remotePath: raw.remotePath ?? raw.remote_path ?? raw.path ?? null,
  status: normalizeImageStatus(raw.statusText ?? raw.status),
  prompt: raw.prompt ?? raw.promptText ?? raw.prompt_text ?? '',
  createdAt: raw.createdAt ?? raw.created_at ?? '',
  width: raw.width ?? null,
  height: raw.height ?? null,
  fileSize: raw.fileSize ?? raw.file_size ?? null,
  errorMsg: raw.errorMsg ?? raw.error_msg ?? null,
});

const listFrom = (data: any) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.list)) return data.list;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.tasks)) return data.tasks;
  if (Array.isArray(data?.images)) return data.images;
  return [];
};

export interface MaterialTaskFilters {
  title?: string;
  startDate?: string;
  endDate?: string;
}

export const materialApi = {
  async getOutputDir(clientId: string): Promise<string | null> {
    const data = await requestData(axios.get(`${LOCAL_API}/settings/material-output-dir`, {
      params: { client_id: clientId },
    }));
    return data?.materialOutputDir ?? data?.material_output_dir ?? data?.path ?? null;
  },

  async getConfigStatus(): Promise<MaterialConfigStatus> {
    const data = await requestData(axios.get(`${LOCAL_API}/material/config-status`));
    return {
      loggedIn: Boolean(data?.loggedIn),
      outputDir: data?.outputDir ?? null,
      outputDirReady: Boolean(data?.outputDirReady),
      outputDirError: data?.outputDirError ?? '',
      textServiceConfigured: Boolean(data?.textServiceConfigured),
      imageServiceConfigured: Boolean(data?.imageServiceConfigured),
      cloudConfigured: Boolean(data?.cloudConfigured),
      ready: Boolean(data?.ready),
      cloudConfig: data?.cloudConfig,
      modelConfig: data?.modelConfig,
    };
  },

  async createTask(input: MaterialTaskCreateInput): Promise<MaterialTask> {
    const data = await requestData(axios.post(`${LOCAL_API}/material/tasks`, {
      title: input.title,
      count: input.count,
      promptTheme: input.promptTheme,
      imageSize: input.imageSize,
      negativePrompt: input.negativePrompt,
      promptExtend: input.promptExtend ?? false,
    }));
    return normalizeTask(data);
  },

  async getTasks(filters: MaterialTaskFilters = {}): Promise<MaterialTask[]> {
    const data = await requestData(axios.get(`${LOCAL_API}/material/tasks`, {
      params: {
        page: 1,
        page_size: 50,
        title: filters.title || undefined,
        startDate: filters.startDate || undefined,
        endDate: filters.endDate || undefined,
      },
    }));
    return listFrom(data).map(normalizeTask);
  },

  async getTask(taskId: string): Promise<MaterialTask> {
    const data = await requestData(axios.get(`${LOCAL_API}/material/tasks/${taskId}`));
    return normalizeTask(data);
  },

  async getTaskProgress(taskIds: string[]): Promise<MaterialTaskProgress[]> {
    const data = await requestData(axios.get(`${LOCAL_API}/material/tasks/progress`, {
      params: {
        taskNos: taskIds.join(','),
      },
    }));
    return listFrom(data?.rows ?? data).map(normalizeTaskProgress);
  },

  async getTaskImages(taskId: string): Promise<MaterialImage[]> {
    const data = await requestData(axios.get(`${LOCAL_API}/material/tasks/${taskId}/images`));
    return listFrom(data).map(normalizeImage);
  },

  async cancelTask(taskId: string): Promise<void> {
    await requestData(axios.post(`${LOCAL_API}/material/tasks/${taskId}/cancel`));
  },

  async retryFailed(taskId: string): Promise<void> {
    await requestData(axios.post(`${LOCAL_API}/material/tasks/${taskId}/retry-failed`));
  },

  async retryImage(image: Pick<MaterialImage, 'imageId' | 'taskId' | 'promptId'>): Promise<void> {
    await requestData(axios.post(`${LOCAL_API}/material/images/${image.imageId}/retry`, {
      taskId: image.taskId,
      promptId: image.promptId,
    }));
  },

  async revealOutputDir(): Promise<void> {
    await requestData(axios.get(`${LOCAL_API}/material/output-dir/reveal`));
  },

  async downloadImages(taskId: string, imageIds: string[]): Promise<MaterialDownloadJob> {
    return requestData(axios.post(`${LOCAL_API}/material/tasks/${taskId}/images/download`, {
      imageIds,
    }));
  },

  async getDownloadJob(downloadJobId: string): Promise<MaterialDownloadJob> {
    return requestData(axios.get(`${LOCAL_API}/material/download-jobs/${downloadJobId}`));
  },
};
