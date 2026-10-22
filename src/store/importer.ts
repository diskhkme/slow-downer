import { invoke } from '@tauri-apps/api/core';
import { parseBuffer } from 'music-metadata';
import { measureLoudness } from '../audio/loudness';
import { DEFAULT_SETTINGS, type Track } from './types';

export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'];

export function isAudioPath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.includes(ext);
}

function baseName(path: string): string {
  const file = path.split(/[\\/]/).pop() ?? path;
  return file.replace(/\.[^.]+$/, '');
}

export function readTrackFile(path: string): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>('read_file', { path });
}

/** 파일 내용 해시(SHA-256 앞 64비트). 파일을 옮겨도 같은 곡으로 알아본다 */
async function contentId(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 파일을 읽어 Track을 만든다. 이미 아는 곡이면 저장된 Track에 경로만 바꿔 돌려준다.
 * 새 곡은 ID3 제목을 읽고, 디코딩해 라우드니스를 잰다.
 */
export async function importFile(
  path: string,
  decode: (data: ArrayBuffer) => Promise<AudioBuffer>,
  known: (id: string) => Track | undefined,
): Promise<Track> {
  const bytes = await readTrackFile(path);
  const id = await contentId(bytes);
  const existing = known(id);
  if (existing) return { ...existing, path };

  const meta = await parseBuffer(new Uint8Array(bytes), { path, size: bytes.byteLength }, {
    duration: false,
    skipCovers: true,
  }).catch(() => null);
  const title = meta?.common.title?.trim();

  // decodeAudioData는 넘긴 버퍼를 분리(detach)하므로 해시/태그를 먼저 읽는다
  const decoded = await decode(bytes);
  const channels: Float32Array[] = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c));
  const { lufs, peakDb } = measureLoudness(channels, decoded.sampleRate);

  return {
    id,
    path,
    displayName: title || baseName(path),
    durationSec: decoded.duration,
    // JSON은 -Infinity를 저장하지 못한다 (무음 파일)
    loudnessLufs: Number.isFinite(lufs) ? lufs : -70,
    peakDb: Number.isFinite(peakDb) ? peakDb : -100,
    settings: { ...DEFAULT_SETTINGS },
    loops: [],
  };
}
