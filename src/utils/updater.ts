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
