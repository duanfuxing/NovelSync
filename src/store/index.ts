import { create } from 'zustand';
import axios from 'axios';

const LOCAL_API = import.meta.env.VITE_LOCAL_API_BASE_URL;

interface UserProfile {
  nickName: string;
  avatar: string;
  phone: string;
  vipLevel: number;
  inkNumber?: number;
}

interface AppState {
  token: string | null;
  uid: string | null;
  clientId: string;
  userProfile: UserProfile | null;
  sessionLoading: boolean;
  watchPath: string | null;         // 本地监控目录
  watchPathChecked: boolean;        // 是否已完成检查（防止弹窗闪烁）
  novelSyncEnabled: boolean;        // 小说自动同步开关
  novelSyncReady: boolean;          // 小说同步是否满足运行条件
  novelSyncReason: string;          // 小说同步当前不可用原因

  setAuth: (token: string, uid: string, profile: UserProfile) => void;
  logout: () => void;
  restoreSession: () => Promise<boolean>;
  checkWatchPath: () => Promise<void>;
  setWatchPath: (path: string) => void;
  setNovelSyncState: (state: { enabled: boolean; ready: boolean; reason?: string; watchPath?: string | null }) => void;
}

// 借用写死的 Mock MAC, 实际这里会被替换成 Tauri 获取的主板码
const generateClientId = () => "MOCK-MAC-1234-5678";

export const useAppStore = create<AppState>((set, get) => ({
  token: localStorage.getItem('token'),
  uid: localStorage.getItem('uid'),
  clientId: generateClientId(),
  userProfile: null,
  sessionLoading: true,
  watchPath: null,
  watchPathChecked: false,
  novelSyncEnabled: false,
  novelSyncReady: false,
  novelSyncReason: '小说自动同步未启用',

  setAuth: (token, uid, profile) => {
    localStorage.setItem('token', token);
    localStorage.setItem('uid', uid);
    set({ token, uid, userProfile: profile });
    // 登录成功后立即检查监控目录
    get().checkWatchPath();
  },

  logout: async () => {
    const { clientId } = get();
    try {
      await axios.post(`${LOCAL_API}/auth/logout?client_id=${clientId}`);
    } catch (e) {
      console.error('[Store] Logout request failed', e);
    }
    localStorage.removeItem('token');
    localStorage.removeItem('uid');
    set({ token: null, uid: null, userProfile: null, watchPath: null, watchPathChecked: false, novelSyncEnabled: false, novelSyncReady: false, novelSyncReason: '小说自动同步未启用' });
  },

  restoreSession: async () => {
    const { clientId, token } = get();
    if (!token) {
      set({ sessionLoading: false });
      return false;
    }
    try {
      const res = await axios.get(`${LOCAL_API}/auth/session`, {
        params: { client_id: clientId },
      });
      if (res.data.code === 10000) {
        const d = res.data.data;
        localStorage.setItem('token', d.token);
        localStorage.setItem('uid', d.uid);
        set({
          token: d.token,
          uid: d.uid,
          userProfile: {
            nickName: d.nickName,
            avatar: d.avatar,
            phone: d.phone,
            vipLevel: d.vipLevel,
          },
          sessionLoading: false,
        });
        // 会话恢复后顺手检查监控目录
        get().checkWatchPath();
        return true;
      }
    } catch (e) {
      console.error('[Store] Session restore failed', e);
    }
    // Token 无效，清除本地状态
    localStorage.removeItem('token');
    localStorage.removeItem('uid');
    set({ token: null, uid: null, userProfile: null, sessionLoading: false, watchPathChecked: true, novelSyncEnabled: false, novelSyncReady: false, novelSyncReason: '小说自动同步未启用' });
    return false;
  },

  /** 检查小说同步开关和本地监控目录 */
  checkWatchPath: async () => {
    const { clientId } = get();
    try {
      const res = await axios.get(`${LOCAL_API}/settings/novel-sync`, {
        params: { client_id: clientId },
      });
      if (res.data.code === 10000) {
        const path = res.data.data?.watchPath ?? null;
        const enabled = Boolean(res.data.data?.enabled);
        const ready = Boolean(res.data.data?.ready);
        const reason = res.data.data?.reason ?? (enabled ? '小说同步未就绪' : '小说自动同步未启用');
        set({ watchPath: path, novelSyncEnabled: enabled, novelSyncReady: ready, novelSyncReason: reason, watchPathChecked: true });
        return;
      }
    } catch (e) {
      console.error('[Store] check novel-sync failed', e);
    }
    set({ watchPath: null, novelSyncEnabled: false, novelSyncReady: false, novelSyncReason: '小说同步状态读取失败', watchPathChecked: true });
  },

  /** 登录成功后或设置页保存后调用，更新全局状态 */
  setWatchPath: (path: string) => {
    set({ watchPath: path });
  },

  /** 设置页读取/保存后同步小说同步完整状态 */
  setNovelSyncState: (state) => {
    set({
      novelSyncEnabled: state.enabled,
      novelSyncReady: state.ready,
      novelSyncReason: state.reason ?? '后端未返回小说同步状态',
      watchPath: state.watchPath ?? get().watchPath,
      watchPathChecked: true,
    });
  },
}));
