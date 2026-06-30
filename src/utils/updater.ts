import { getVersion as tauriGetVersion } from '@tauri-apps/api/app';
import {
  checkUpdate as tauriCheckUpdate,
  installUpdate as tauriInstallUpdate,
  type UpdateManifest,
  type UpdateResult,
} from '@tauri-apps/api/updater';

export type VersionInfo = {
  isTauri: boolean;
  version: string;
};

export type UpdateCheckResult =
  | { status: 'unsupported'; message: string }
  | { status: 'up-to-date'; message: string }
  | { status: 'available'; message: string; manifest?: UpdateManifest }
  | { status: 'error'; message: string };

export type UpdateInstallResult =
  | { status: 'installed'; message: string }
  | { status: 'unsupported'; message: string }
  | { status: 'error'; message: string };

export type StartupUpdateDialog = {
  kind: 'confirm' | 'info' | 'warning';
  title: string;
  content: string;
  installable: boolean;
};

export type StartupAutoUpdateDialog = {
  kind: 'checking' | 'up-to-date' | 'installing' | 'installed' | 'error';
  title: string;
  content: string;
  closable: boolean;
};

export type StartupUpdateFlowOptions = {
  checkForUpdate?: () => Promise<UpdateCheckResult>;
  installAvailableUpdate?: () => Promise<UpdateInstallResult>;
  showDialog: (dialog: StartupAutoUpdateDialog) => void;
  closeDialog: () => void;
  sleep?: (ms: number) => Promise<void>;
  autoCloseMs?: number;
};

export type UpdaterDependencies = {
  isTauriRuntime: () => boolean;
  getVersion: () => Promise<string>;
  checkUpdate: () => Promise<UpdateResult>;
  installUpdate: () => Promise<void>;
};

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return '未知错误';
}

export function isTauriRuntime(target: any = globalThis.window): boolean {
  return Boolean(target?.__TAURI_IPC__);
}

export const defaultUpdaterDependencies: UpdaterDependencies = {
  isTauriRuntime,
  getVersion: tauriGetVersion,
  checkUpdate: tauriCheckUpdate,
  installUpdate: tauriInstallUpdate,
};

export async function getCurrentVersion(
  deps: UpdaterDependencies = defaultUpdaterDependencies,
): Promise<VersionInfo> {
  if (!deps.isTauriRuntime()) {
    return {
      isTauri: false,
      version: '开发环境',
    };
  }

  try {
    return {
      isTauri: true,
      version: await deps.getVersion(),
    };
  } catch {
    return {
      isTauri: true,
      version: '未知',
    };
  }
}

export async function checkForUpdate({
  deps = defaultUpdaterDependencies,
}: {
  deps?: UpdaterDependencies;
} = {}): Promise<UpdateCheckResult> {
  if (!deps.isTauriRuntime()) {
    return {
      status: 'unsupported',
      message: '当前环境不支持自动更新',
    };
  }

  try {
    const update = await deps.checkUpdate();

    if (!update.shouldUpdate) {
      return {
        status: 'up-to-date',
        message: '当前已是最新版本',
      };
    }

    return {
      status: 'available',
      message: `发现新版本 ${update.manifest?.version || ''}`.trim(),
      manifest: update.manifest,
    };
  } catch (error) {
    return {
      status: 'error',
      message: `检查更新失败：${errorMessage(error)}`,
    };
  }
}

export function getStartupUpdateDialog(result: UpdateCheckResult): StartupUpdateDialog {
  if (result.status === 'available') {
    return {
      kind: 'confirm',
      title: `发现新版本 ${result.manifest?.version || ''}`.trim(),
      content: result.manifest?.body || '检测到可用更新，建议立即安装。',
      installable: true,
    };
  }

  if (result.status === 'error') {
    return {
      kind: 'warning',
      title: '检查更新失败',
      content: result.message,
      installable: false,
    };
  }

  return {
    kind: 'info',
    title: result.message,
    content: result.message,
    installable: false,
  };
}

export async function installAvailableUpdate(
  deps: UpdaterDependencies = defaultUpdaterDependencies,
): Promise<UpdateInstallResult> {
  if (!deps.isTauriRuntime()) {
    return {
      status: 'unsupported',
      message: '当前环境不支持自动更新',
    };
  }

  try {
    await deps.installUpdate();
    return {
      status: 'installed',
      message: '更新已安装',
    };
  } catch (error) {
    return {
      status: 'error',
      message: `安装更新失败：${errorMessage(error)}`,
    };
  }
}

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function manualUpdateGuidance(message: string): string {
  return `${message}\n请前往“设置 > 软件更新”手动检查更新。`;
}

export async function runStartupUpdateFlow({
  checkForUpdate: runCheckForUpdate = () => checkForUpdate(),
  installAvailableUpdate: runInstallAvailableUpdate = () => installAvailableUpdate(),
  showDialog,
  closeDialog,
  sleep = sleepFor,
  autoCloseMs = 1800,
}: StartupUpdateFlowOptions): Promise<void> {
  showDialog({
    kind: 'checking',
    title: '软件更新检查',
    content: '正在检查更新...',
    closable: false,
  });

  const result = await runCheckForUpdate();

  if (result.status === 'unsupported') {
    closeDialog();
    return;
  }

  if (result.status === 'up-to-date') {
    showDialog({
      kind: 'up-to-date',
      title: '软件更新检查',
      content: '当前已是最新版，无需更新。',
      closable: false,
    });
    await sleep(autoCloseMs);
    closeDialog();
    return;
  }

  if (result.status === 'error') {
    showDialog({
      kind: 'error',
      title: '软件更新检查失败',
      content: manualUpdateGuidance(result.message),
      closable: true,
    });
    return;
  }

  showDialog({
    kind: 'installing',
    title: '软件更新检查',
    content: `发现新版本 ${result.manifest?.version || ''}，正在下载并安装...`.trim(),
    closable: false,
  });

  const installResult = await runInstallAvailableUpdate();

  if (installResult.status === 'installed') {
    showDialog({
      kind: 'installed',
      title: '软件更新检查',
      content: '更新已安装，应用将自动重启。',
      closable: false,
    });
    return;
  }

  showDialog({
    kind: 'error',
    title: '软件更新安装失败',
    content: manualUpdateGuidance(installResult.message),
    closable: true,
  });
}
