import { useEffect, useRef, useState } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { StretchEngine } from './audio/StretchEngine';
import { listOutputDevices, type OutputDevice } from './audio/devices';
import { currentPlaylist, useLibrary } from './store/library';
import { AUDIO_EXTENSIONS, importFile, isAudioPath, readTrackFile } from './store/importer';
import { autoGainDb, type Loop, type TrackSettings as Settings } from './store/types';
import { Playlist } from './components/Playlist';
import { Transport } from './components/Transport';
import { Waveform, type LoopRange } from './components/Waveform';
import { LoopList } from './components/LoopList';
import { SpeedPitchPanel, VolumePanel } from './components/TrackSettings';
import './App.css';

const engine = new StretchEngine();

const NUDGE_SEC = 0.01;
const MIN_LOOP_SEC = 0.05;
const POSITION_SAVE_INTERVAL_MS = 10_000;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function App() {
  const lib = useLibrary();
  const playlist = currentPlaylist(lib);
  const track = playlist.activeTrackId ? lib.tracks[playlist.activeTrackId] : null;
  const settings = track?.settings ?? null;

  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null); // 엔진에 올라간 곡
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null); // 플레이리스트 패널에 따로 표시
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [followKey, setFollowKey] = useState(0); // 사용자 탐색/재생 시작 → 파형이 커서를 다시 따라감
  const [devices, setDevices] = useState<OutputDevice[]>([]);

  const ready = !!track && loadedId === track.id && !loading;
  const loops = track?.loops ?? [];
  const activeLoop = loops.find((l) => l.id === settings?.activeLoopId) ?? null;
  const loopEnabled = !!settings?.loopEnabled && !!activeLoop;

  const update = (patch: Partial<Settings>) => {
    if (track) lib.updateSettings(track.id, patch);
  };

  const rememberPosition = () => {
    if (loadedId) useLibrary.getState().updateSettings(loadedId, { lastPositionSec: engine.position });
  };

  // ---------- 시작: 저장 상태 복원, 출력 장치, 창 닫기 ----------

  useEffect(() => {
    void useLibrary
      .getState()
      .init()
      .then(async () => {
        const id = useLibrary.getState().outputDeviceId;
        if (id) await engine.setOutputDevice(id).catch(() => useLibrary.getState().setOutputDevice(''));
      })
      .catch((e) => setError(`저장된 상태를 불러오지 못했습니다: ${errorText(e)}`));

    const refresh = () => void listOutputDevices().then(setDevices);
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, []);

  useEffect(() => {
    // 창을 닫기 전에 재생 위치를 기록하고 바로 저장한다
    const unlisten = getCurrentWindow().onCloseRequested(async () => {
      const state = useLibrary.getState();
      const { activeTrackId } = currentPlaylist(state);
      const { updateSettings, flush } = state;
      if (activeTrackId && engine.duration) updateSettings(activeTrackId, { lastPositionSec: engine.position });
      await flush();
    });
    return () => void unlisten.then((f) => f());
  }, []);

  // ---------- 곡 가져오기 (+ 추가 버튼, 탐색기에서 끌어다 놓기) ----------

  const importPaths = async (paths: string[]) => {
    const audio = paths.filter(isAudioPath);
    let firstId: string | null = null;
    const failed: string[] = [];
    setImportError(null);
    for (let i = 0; i < audio.length; i++) {
      setBusy(`분석 중 ${i + 1}/${audio.length}…`);
      try {
        const t = await importFile(audio[i], (d) => engine.decode(d), (id) => useLibrary.getState().tracks[id]);
        useLibrary.getState().addTrack(t);
        firstId ??= t.id;
      } catch (e) {
        console.error(`가져오기 실패: ${audio[i]}`, e);
        failed.push(audio[i].split(/[\\/]/).pop() ?? audio[i]);
      }
    }
    setBusy(null);
    if (failed.length) setImportError(`가져오지 못한 파일 (손상되었거나 지원하지 않는 형식): ${failed.join(", ")}`);
    if (firstId && !currentPlaylist(useLibrary.getState()).activeTrackId) selectTrack(firstId);
  };

  const addFiles = async () => {
    const picked = await open({ multiple: true, filters: [{ name: '오디오', extensions: AUDIO_EXTENSIONS }] });
    if (picked) await importPaths(Array.isArray(picked) ? picked : [picked]);
  };

  // 리스너는 한 번만 등록하고(등록/해제가 IPC 왕복이다) 최신 함수는 ref로 부른다
  const importRef = useRef(importPaths);
  importRef.current = importPaths;
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === 'drop') void importRef.current(e.payload.paths);
    });
    return () => void unlisten.then((f) => f());
  }, []);

  // ---------- 곡 전환과 로딩 ----------

  const selectTrack = (id: string) => {
    if (id === playlist.activeTrackId) return;
    rememberPosition();
    engine.pause();
    setPlaying(false);
    lib.setActive(id);
  };

  /** 플레이리스트 전환/생성/삭제 전에 지금 곡의 위치를 기록하고 멈춘다 */
  const leavePlaylist = (action: () => void) => {
    rememberPosition();
    engine.pause();
    setPlaying(false);
    action();
  };

  const removeTrack = (id: string) => {
    if (id === playlist.activeTrackId) {
      rememberPosition();
      engine.pause();
      setPlaying(false);
    }
    lib.removeFromPlaylist(id);
  };

  const activeId = lib.loaded ? playlist.activeTrackId : null;
  const activeMissing = activeId ? !!lib.missing[activeId] : false;
  useEffect(() => {
    setBuffer(null);
    setLoadedId(null);
    if (!activeId) return;
    if (activeMissing) {
      setError('파일을 찾을 수 없습니다. 옮긴 위치에서 다시 추가하면 설정과 루프가 이어집니다.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const t = useLibrary.getState().tracks[activeId];
      const decoded = await engine.decode(await readTrackFile(t.path));
      if (cancelled) return;
      await engine.load(decoded);
      engine.seek(t.settings.lastPositionSec);
      setPosition(engine.position);
      setBuffer(decoded);
      setLoadedId(activeId);
    })()
      .catch((e) => !cancelled && setError(`파일을 열 수 없습니다: ${errorText(e)}`))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeId, activeMissing]);

  // ---------- 곡 설정 → 엔진 (곡 전환과 사용자 조작 모두 이 경로) ----------

  const gainDb = track ? autoGainDb(track) + track.settings.gainOffsetDb : 0;
  useEffect(() => void (settings && engine.setTempo(settings.tempo)), [settings?.tempo, loadedId]);
  useEffect(() => void (settings && engine.setPitch(settings.pitch)), [settings?.pitch, loadedId]);
  useEffect(() => engine.setGain(gainDb), [gainDb]);
  const eq = settings?.eq;
  useEffect(() => void (eq && engine.setEq(eq.low, eq.mid, eq.high)), [eq?.low, eq?.mid, eq?.high]);

  const loopA = loopEnabled ? activeLoop?.a : undefined;
  const loopB = loopEnabled ? activeLoop?.b : undefined;
  useEffect(() => {
    if (!loadedId) return;
    engine.setLoop(loopA ?? null, loopB ?? null);
    setPosition(engine.position);
  }, [loopA, loopB, loadedId]);

  // ---------- 재생 ----------

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const pos = engine.position;
      setPosition(pos);
      if (pos >= engine.duration) {
        engine.pause();
        setPlaying(false);
        rememberPosition();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // 비정상 종료에 대비해 재생 중에도 가끔 위치를 기록한다
    const timer = setInterval(rememberPosition, POSITION_SAVE_INTERVAL_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [playing]);

  const pause = () => {
    engine.pause();
    setPlaying(false);
    rememberPosition();
  };

  const togglePlay = async () => {
    if (!ready) return;
    if (engine.playing) {
      pause();
    } else {
      await engine.play();
      setPlaying(engine.playing);
      setFollowKey((k) => k + 1);
    }
  };

  const seek = (sec: number) => {
    engine.seek(sec);
    setPosition(engine.position);
    setFollowKey((k) => k + 1);
  };

  /** Space: 루프가 켜져 있으면 "정지하고 루프 시작으로 / 재생", 아니면 재생/일시정지 */
  const spaceAction = () => {
    if (loopEnabled && activeLoop && engine.playing) {
      pause();
      seek(activeLoop.a);
      rememberPosition();
    } else {
      void togglePlay();
    }
  };

  // ---------- 루프 ----------

  const setLoops = (fn: (ls: Loop[]) => Loop[]) => track && lib.setLoops(track.id, fn);

  const updateLoop = (id: string, range: LoopRange) => setLoops((ls) => ls.map((l) => (l.id === id ? { ...l, ...range } : l)));

  const nudgeLoop = (side: 'a' | 'b', delta: number) => {
    if (!activeLoop || !buffer) return;
    const range = { a: activeLoop.a, b: activeLoop.b };
    if (side === 'a') range.a = Math.max(0, Math.min(range.b - MIN_LOOP_SEC, range.a + delta));
    else range.b = Math.min(buffer.duration, Math.max(range.a + MIN_LOOP_SEC, range.b + delta));
    updateLoop(activeLoop.id, range);
  };

  const createLoop = (range: LoopRange) => {
    const loop: Loop = { id: crypto.randomUUID(), name: `루프 ${loops.length + 1}`, ...range };
    setLoops((ls) => [...ls, loop]);
    update({ activeLoopId: loop.id, loopEnabled: true });
  };

  const selectLoop = (id: string) => {
    update({ activeLoopId: id, loopEnabled: true });
    const loop = loops.find((l) => l.id === id);
    if (loop) seek(loop.a);
  };

  const deleteLoop = (id: string) => {
    setLoops((ls) => ls.filter((l) => l.id !== id));
    if (id === settings?.activeLoopId) update({ activeLoopId: null, loopEnabled: false });
  };

  const toggleLoop = () => {
    if (activeLoop) update({ loopEnabled: !settings?.loopEnabled });
  };

  // ---------- 단축키 ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range') return;
      if (t.tagName === 'SELECT') return;
      // 포커스된 버튼이 Space/Enter로 한 번 더 눌리지 않도록
      if (t.tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) t.blur();
      // 한글 입력 상태에서도 동작하도록 e.code로 판단
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          spaceAction();
          break;
        case 'Enter':
        case 'NumpadEnter':
          e.preventDefault();
          void togglePlay();
          break;
        case 'KeyL':
          toggleLoop();
          break;
        case 'BracketLeft':
        case 'BracketRight':
          e.preventDefault();
          nudgeLoop(e.shiftKey ? 'b' : 'a', e.code === 'BracketLeft' ? -NUDGE_SEC : NUDGE_SEC);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const changeDevice = async (id: string) => {
    try {
      await engine.setOutputDevice(id);
      lib.setOutputDevice(id);
    } catch (e) {
      setError(`출력 장치를 바꿀 수 없습니다: ${errorText(e)}`);
    }
  };

  const playlistTracks = playlist.trackIds.map((id) => lib.tracks[id]);

  return (
    <div className="layout">
      <Playlist
        tracks={playlistTracks}
        activeId={playlist.activeTrackId}
        missing={lib.missing}
        busy={busy}
        importError={importError}
        onDismissImportError={() => setImportError(null)}
        onAdd={() => void addFiles()}
        onSelect={selectTrack}
        onRename={lib.rename}
        onRemove={removeTrack}
        onMove={lib.moveTrack}
        playlists={lib.playlists}
        currentPlaylistId={playlist.id}
        onSelectPlaylist={(id) => id !== playlist.id && leavePlaylist(() => lib.selectPlaylist(id))}
        onCreatePlaylist={(name) => leavePlaylist(() => lib.createPlaylist(name))}
        onRenamePlaylist={lib.renamePlaylist}
        onDeletePlaylist={(id) => leavePlaylist(() => lib.deletePlaylist(id))}
      />

      <main className="main">
        <div className="title">{track ? track.displayName : '곡을 선택하세요'}</div>

        {buffer && ready ? (
          <>
            <Waveform
              buffer={buffer}
              position={position}
              playing={playing}
              followKey={followKey}
              loops={loops}
              activeLoopId={settings?.activeLoopId ?? null}
              loopEnabled={loopEnabled}
              onSeek={seek}
              onLoopCreate={createLoop}
              onLoopChange={updateLoop}
              onLoopSelect={selectLoop}
            />
            <Transport
              disabled={false}
              playing={playing}
              position={position}
              duration={buffer.duration}
              onTogglePlay={() => void togglePlay()}
              onRewind={() => seek(0)}
            />
          </>
        ) : (
          <div className="waveform placeholder">{loading ? '불러오는 중…' : ''}</div>
        )}

        {track && settings && (
          <div className="settings-grid">
            <SpeedPitchPanel settings={settings} onChange={update} />
            <VolumePanel settings={settings} autoGainDb={autoGainDb(track)} onChange={update} />
          </div>
        )}

        <div className="row">
          <label>출력</label>
          <select value={lib.outputDeviceId} onChange={(e) => void changeDevice(e.target.value)}>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div className="error" onClick={() => setError(null)} title="클릭해 닫기">
            {error}
          </div>
        )}
      </main>

      <aside className="loops-column">
        {buffer && ready && (
          <LoopList
            loops={loops}
            activeId={settings?.activeLoopId ?? null}
            enabled={loopEnabled}
            onSelect={selectLoop}
            onRename={(id, name) => setLoops((ls) => ls.map((l) => (l.id === id ? { ...l, name } : l)))}
            onDelete={deleteLoop}
            onToggle={toggleLoop}
          />
        )}
      </aside>
    </div>
  );
}
