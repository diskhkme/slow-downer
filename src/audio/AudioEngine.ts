// 프론트엔드는 이 인터페이스 뒤에서만 재생을 다룬다 (ARCHITECTURE.md "오디오 엔진 인터페이스").
export interface AudioEngine {
  decode(data: ArrayBuffer): Promise<AudioBuffer>;
  load(buffer: AudioBuffer): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  seek(sec: number): void;
  setTempo(ratio: number): void; // 0.25 .. 1.5
  setPitch(semitones: number): void; // -12 .. 12
  setLoop(a: number | null, b: number | null): void; // null = 루프 끔
  setGain(db: number): void; // 라우드니스 보정 + 사용자 오프셋 합산
  setEq(low: number, mid: number, high: number): void; // dB
  setOutputDevice(deviceId: string): Promise<void>; // '' = 시스템 기본 장치
  readonly position: number; // 초, 원본 타임라인 기준
  readonly duration: number;
  readonly playing: boolean;
}
