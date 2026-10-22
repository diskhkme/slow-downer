// signalsmith-stretch 1.3.2에는 타입 정의가 없다. 우리가 쓰는 부분만 선언한다.
declare module 'signalsmith-stretch' {
  export interface StretchSegment {
    active?: boolean;
    input?: number; // 입력 버퍼 내 위치(초)
    output?: number; // 이 변경이 적용될 AudioContext 시각(초)
    rate?: number;
    semitones?: number;
    loopStart?: number;
    loopEnd?: number;
  }

  export interface StretchNode extends AudioWorkletNode {
    schedule(segment: StretchSegment): Promise<StretchSegment>;
    addBuffers(channels: Float32Array[]): Promise<number>;
    dropBuffers(): Promise<{ start: number; end: number }>;
    /** 입력 + 출력 레이턴시(초) */
    latency(): Promise<number>;
  }

  export default function SignalsmithStretch(
    context: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ): Promise<StretchNode>;
}
