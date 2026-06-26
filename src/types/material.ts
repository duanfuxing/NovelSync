export type MaterialTaskStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'partial_failed'
  | 'failed'
  | 'cancel_requested'
  | 'canceled'
  | 'deleted'
  | 'interrupted';

export type MaterialImageStatus = 'pending' | 'running' | 'success' | 'failed' | 'canceled';
export type MaterialDownloadJobStatus = 'pending' | 'running' | 'success' | 'partial_failed' | 'failed';

export interface MaterialTask {
  taskId: string;
  title: string;
  status: MaterialTaskStatus;
  requestedCount: number;
  successCount: number;
  failedCount: number;
  progressPercent?: number | null;
  nextPollAfterSeconds?: number;
  outputDir: string;
  imageSize?: string;
  negativePrompt?: string;
  promptExtend?: boolean;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  errorMsg?: string | null;
}

export interface MaterialTaskProgress {
  taskId: string;
  status: MaterialTaskStatus;
  requestedCount: number;
  successCount: number;
  failedCount: number;
  progressPercent?: number | null;
  nextPollAfterSeconds?: number;
}

export interface MaterialImage {
  imageId: string;
  taskId: string;
  promptId?: string;
  imageIndex: number;
  localPath: string;
  remoteUrl?: string | null;
  remotePath?: string | null;
  status: MaterialImageStatus;
  prompt: string;
  createdAt: string;
  width?: number | null;
  height?: number | null;
  fileSize?: number | null;
  errorMsg?: string | null;
}

export interface MaterialTaskCreateInput {
  title?: string;
  count: number;
  promptTheme?: string;
  imageSize?: string;
  negativePrompt?: string;
  promptExtend?: boolean;
}

export interface MaterialDownloadJob {
  downloadJobId: string;
  taskId: string;
  status: MaterialDownloadJobStatus;
  total: number;
  savedCount: number;
  failedCount: number;
  outputDir?: string;
  message?: string;
}

export interface MaterialConfigStatus {
  loggedIn: boolean;
  outputDir: string | null;
  outputDirReady: boolean;
  outputDirError?: string;
  textServiceConfigured: boolean;
  imageServiceConfigured: boolean;
  cloudConfigured?: boolean;
  ready: boolean;
  cloudConfig?: {
    defaultImageSize?: string;
    imageSizes?: Array<{ value: string; label: string; width: number; height: number }>;
  };
  modelConfig?: {
    llm_provider?: string;
    text_model?: string;
    image_provider?: string;
    image_model?: string;
  };
}
