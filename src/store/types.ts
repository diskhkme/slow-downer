// 저장 데이터 모델 (ARCHITECTURE.md "데이터 모델")

export interface Loop {
  id: string;
  name: string;
  a: number;
  b: number;
}

export interface TrackSettings {
  tempo: number; // 0.25 .. 1.5
  pitch: number; // 반음
  gainOffsetDb: number; // 자동 게인 위에 얹는 사용자 볼륨
  eq: { low: number; mid: number; high: number }; // dB
  lastPositionSec: number;
  activeLoopId: string | null;
  loopEnabled: boolean;
}

export interface Track {
  id: string; // 파일 내용 해시
  path: string; // 마지막으로 알려진 경로
  displayName: string;
  durationSec: number;
  loudnessLufs: number;
  peakDb: number;
  settings: TrackSettings;
  loops: Loop[];
}

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  activeTrackId: string | null; // 이 플레이리스트에서 마지막으로 고른 곡
}

export const DEFAULT_SETTINGS: TrackSettings = {
  tempo: 1,
  pitch: 0,
  gainOffsetDb: 0,
  eq: { low: 0, mid: 0, high: 0 },
  lastPositionSec: 0,
  activeLoopId: null,
  loopEnabled: false,
};

/** 자동 게인 목표. 큰 곡은 줄이고 작은 곡은 키우되 피크가 0 dBFS를 넘지 않게 한다 */
export const TARGET_LUFS = -14;
const MAX_AUTO_BOOST_DB = 12; // 거의 무음인 파일을 과하게 키우지 않도록

export function autoGainDb(track: Pick<Track, 'loudnessLufs' | 'peakDb'>): number {
  return Math.min(TARGET_LUFS - track.loudnessLufs, -track.peakDb, MAX_AUTO_BOOST_DB);
}
