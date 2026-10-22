import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import type { Loop, Playlist, Track, TrackSettings } from './types';

interface LibraryFile {
  version: 1;
  tracks: Record<string, Track>;
}

interface PlaylistFileV1 {
  version: 1;
  trackIds: string[];
  activeTrackId: string | null;
  outputDeviceId: string;
}

interface PlaylistFile {
  version: 2;
  playlists: Playlist[];
  activePlaylistId: string;
  outputDeviceId: string; // '' = 시스템 기본 장치
}

interface State {
  loaded: boolean;
  tracks: Record<string, Track>;
  missing: Record<string, boolean>; // 저장된 경로에 파일이 없는 곡 (실행 중에만)
  playlists: Playlist[];
  activePlaylistId: string;
  outputDeviceId: string;

  init(): Promise<void>;
  // 아래 곡 단위 동작은 현재 플레이리스트에 적용된다
  /** 새 곡이면 추가, 이미 아는 곡(같은 해시)이면 경로만 갱신. 플레이리스트에 없으면 끝에 넣는다 */
  addTrack(track: Track): void;
  removeFromPlaylist(id: string): void;
  moveTrack(from: number, to: number): void;
  setActive(id: string | null): void;
  rename(id: string, name: string): void;
  updateSettings(id: string, patch: Partial<TrackSettings>): void;
  setLoops(id: string, update: (loops: Loop[]) => Loop[]): void;
  createPlaylist(name: string): void;
  renamePlaylist(id: string, name: string): void;
  deletePlaylist(id: string): void;
  selectPlaylist(id: string): void;
  setOutputDevice(id: string): void;
  flush(): Promise<void>;
}

const newPlaylist = (name: string): Playlist => ({ id: crypto.randomUUID(), name, trackIds: [], activeTrackId: null });

const FIRST_PLAYLIST = newPlaylist('기본');

export function currentPlaylist(s: Pick<State, 'playlists' | 'activePlaylistId'>): Playlist {
  return s.playlists.find((p) => p.id === s.activePlaylistId) ?? s.playlists[0];
}

/** 현재 플레이리스트만 바꾼다 */
function withCurrent(s: State, fn: (p: Playlist) => Playlist): Partial<State> {
  const cur = currentPlaylist(s);
  return { playlists: s.playlists.map((p) => (p.id === cur.id ? fn(p) : p)) };
}

function readPlaylistFile(json: string | null, tracks: Record<string, Track>): PlaylistFile {
  const parsed = json ? (JSON.parse(json) as PlaylistFile | PlaylistFileV1) : null;
  let file: PlaylistFile;
  if (!parsed) {
    file = { version: 2, playlists: [FIRST_PLAYLIST], activePlaylistId: FIRST_PLAYLIST.id, outputDeviceId: '' };
  } else if (parsed.version === 1) {
    // 플레이리스트가 하나뿐이던 형식 → "기본" 하나로
    const only = { ...newPlaylist('기본'), trackIds: parsed.trackIds, activeTrackId: parsed.activeTrackId };
    file = { version: 2, playlists: [only], activePlaylistId: only.id, outputDeviceId: parsed.outputDeviceId };
  } else {
    file = parsed;
  }
  // 라이브러리에 없는 곡 정리
  file.playlists = file.playlists.map((p) => {
    const trackIds = p.trackIds.filter((id) => tracks[id]);
    return { ...p, trackIds, activeTrackId: p.activeTrackId && trackIds.includes(p.activeTrackId) ? p.activeTrackId : null };
  });
  return file;
}

export const useLibrary = create<State>()((set, get) => ({
  loaded: false,
  tracks: {},
  missing: {},
  playlists: [FIRST_PLAYLIST],
  activePlaylistId: FIRST_PLAYLIST.id,
  outputDeviceId: '',

  async init() {
    const [lib, pl] = await Promise.all([
      invoke<string | null>('load_state', { name: 'library' }),
      invoke<string | null>('load_state', { name: 'playlist' }),
    ]);
    const tracks = lib ? (JSON.parse(lib) as LibraryFile).tracks : {};
    const file = readPlaylistFile(pl, tracks);
    const ids = new Set(file.playlists.flatMap((p) => p.trackIds));
    const missing: Record<string, boolean> = {};
    await Promise.all(
      [...ids].map(async (id) => {
        if (!(await invoke<boolean>('file_exists', { path: tracks[id].path }))) missing[id] = true;
      }),
    );
    set({
      loaded: true,
      tracks,
      missing,
      playlists: file.playlists,
      activePlaylistId: file.playlists.some((p) => p.id === file.activePlaylistId)
        ? file.activePlaylistId
        : file.playlists[0].id,
      outputDeviceId: file.outputDeviceId,
    });
  },

  addTrack(track) {
    set((s) => {
      const known = s.tracks[track.id];
      const merged = known ? { ...known, path: track.path } : track;
      const { [track.id]: _, ...missing } = s.missing;
      return {
        tracks: { ...s.tracks, [track.id]: merged },
        missing,
        ...withCurrent(s, (p) => (p.trackIds.includes(track.id) ? p : { ...p, trackIds: [...p.trackIds, track.id] })),
      };
    });
  },

  removeFromPlaylist(id) {
    // 곡 데이터는 남겨 둔다. 다시 추가하면 설정과 루프가 이어진다
    set((s) =>
      withCurrent(s, (p) => ({
        ...p,
        trackIds: p.trackIds.filter((t) => t !== id),
        activeTrackId: p.activeTrackId === id ? null : p.activeTrackId,
      })),
    );
  },

  moveTrack(from, to) {
    set((s) =>
      withCurrent(s, (p) => {
        const ids = [...p.trackIds];
        const [moved] = ids.splice(from, 1);
        ids.splice(to, 0, moved);
        return { ...p, trackIds: ids };
      }),
    );
  },

  setActive(id) {
    set((s) => withCurrent(s, (p) => ({ ...p, activeTrackId: id })));
  },

  rename(id, name) {
    set((s) => ({ tracks: { ...s.tracks, [id]: { ...s.tracks[id], displayName: name } } }));
  },

  updateSettings(id, patch) {
    set((s) => {
      const t = s.tracks[id];
      if (!t) return {};
      return { tracks: { ...s.tracks, [id]: { ...t, settings: { ...t.settings, ...patch } } } };
    });
  },

  setLoops(id, update) {
    set((s) => {
      const t = s.tracks[id];
      if (!t) return {};
      return { tracks: { ...s.tracks, [id]: { ...t, loops: update(t.loops) } } };
    });
  },

  createPlaylist(name) {
    const p = newPlaylist(name);
    set((s) => ({ playlists: [...s.playlists, p], activePlaylistId: p.id }));
  },

  renamePlaylist(id, name) {
    set((s) => ({ playlists: s.playlists.map((p) => (p.id === id ? { ...p, name } : p)) }));
  },

  deletePlaylist(id) {
    set((s) => {
      if (s.playlists.length <= 1) return {}; // 마지막 하나는 지우지 않는다
      const playlists = s.playlists.filter((p) => p.id !== id);
      return { playlists, activePlaylistId: s.activePlaylistId === id ? playlists[0].id : s.activePlaylistId };
    });
  },

  selectPlaylist(id) {
    set({ activePlaylistId: id });
  },

  setOutputDevice(id) {
    set({ outputDeviceId: id });
  },

  async flush() {
    await saveNow(get());
  },
}));

// ---------- 저장: 바뀐 파일만, 마지막 변경 후 잠깐 기다렸다가 ----------

const SAVE_DELAY_MS = 500;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savedTracks: State['tracks'] | null = null;
let savedPlaylist: string | null = null;

function playlistJson(s: State): string {
  const file: PlaylistFile = {
    version: 2,
    playlists: s.playlists,
    activePlaylistId: s.activePlaylistId,
    outputDeviceId: s.outputDeviceId,
  };
  return JSON.stringify(file, null, 2);
}

async function saveNow(s: State): Promise<void> {
  clearTimeout(saveTimer);
  if (!s.loaded) return;
  const writes: Promise<void>[] = [];
  if (s.tracks !== savedTracks) {
    const file: LibraryFile = { version: 1, tracks: s.tracks };
    writes.push(invoke('save_state', { name: 'library', contents: JSON.stringify(file, null, 2) }));
    savedTracks = s.tracks;
  }
  const pl = playlistJson(s);
  if (pl !== savedPlaylist) {
    writes.push(invoke('save_state', { name: 'playlist', contents: pl }));
    savedPlaylist = pl;
  }
  await Promise.all(writes);
}

useLibrary.subscribe((s, prev) => {
  if (!s.loaded) return;
  if (!prev.loaded) {
    // 막 불러온 곡 데이터는 저장된 것으로 기록. 플레이리스트는 비워 두어 다음 변경 때
    // 새 형식(v2)으로 쓰이게 한다 (v1에서 변환했을 수 있으므로)
    savedTracks = s.tracks;
    savedPlaylist = null;
    return;
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveNow(useLibrary.getState()).catch((e) => console.error('저장 실패', e));
  }, SAVE_DELAY_MS);
});
