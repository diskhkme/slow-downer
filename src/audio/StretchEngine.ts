import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch';
// 같은 파일을 수정 없이 Worklet 모듈로 등록한다. 패키지 기본 경로(함수를 문자열로 만들어 Blob으로
// 등록)는 프로덕션 빌드의 변수명 축약으로 깨진다.
import stretchWorkletUrl from 'signalsmith-stretch?url';
import type { AudioEngine } from './AudioEngine';

// setSinkId는 Chromium(WebView2)에 있지만 TS DOM 타입에는 아직 없다
type SinkAudioContext = AudioContext & { setSinkId(id: string): Promise<void> };

const PARAM_SMOOTHING_SEC = 0.02;

/**
 * signalsmith-stretch AudioWorklet 노드 기반 엔진.
 *
 * 위치는 노드의 inputTime(메시지로 늦게 오고 레이턴시만큼 앞서 있음) 대신
 * "컨텍스트 시각 anchorOut에 입력 위치 anchorIn이 들린다"는 기준점으로 직접 계산한다.
 * 모든 변경은 출력 레이턴시만큼 뒤에 예약해야 노드가 레이턴시를 정확히 보정한다.
 */
export class StretchEngine implements AudioEngine {
  private readonly ctx: SinkAudioContext;
  private readonly ready: Promise<{ node: StretchNode; outputLatency: number }>;
  private buffer: AudioBuffer | null = null;
  private tempo = 1;
  private semitones = 0;
  private isPlaying = false;
  private anchorIn = 0;
  private anchorOut = 0;
  private outputLatency = 0;
  private loop: { a: number; b: number } | null = null;
  private readonly gain: GainNode;
  private readonly eq: [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];

  constructor() {
    // sampleRate는 강제하지 않는다 (장치 기본값을 따라야 BIAS FX와 공존)
    const ctx = new AudioContext({ latencyHint: 'playback' }) as SinkAudioContext;
    this.ctx = ctx;
    // Worklet → Gain → EQ(저/중/고) → 출력
    const gain = new GainNode(ctx);
    this.gain = gain;
    this.eq = [
      new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 250 }),
      new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1000, Q: 0.7 }),
      new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 4000 }),
    ];
    gain.connect(this.eq[0]).connect(this.eq[1]).connect(this.eq[2]).connect(ctx.destination);
    this.ready = (async () => {
      await ctx.audioWorklet.addModule(stretchWorkletUrl);
      // 입력은 연결하지 않지만 1개로 둔다. 0개면 노드가 정지 상태에서 입력 배열을 읽다 예외가 난다
      const node = await SignalsmithStretch(ctx, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      node.connect(gain);
      // 기본 프리셋은 입력/출력 레이턴시가 같다 (ARCHITECTURE.md 핵심 결정 2)
      const outputLatency = (await node.latency()) / 2;
      this.outputLatency = outputLatency;
      return { node, outputLatency };
    })();
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get playing(): boolean {
    return this.isPlaying;
  }

  get position(): number {
    if (!this.isPlaying) return this.anchorIn;
    return this.positionAt(this.ctx.currentTime);
  }

  decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data);
  }

  async load(buffer: AudioBuffer): Promise<void> {
    const { node } = await this.ready;
    this.pause();
    this.setLoop(null, null);
    await node.dropBuffers();
    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    await node.addBuffers(channels);
    this.buffer = buffer;
    this.anchorIn = 0;
  }

  async play(): Promise<void> {
    if (!this.buffer || this.isPlaying) return;
    const { node } = await this.ready;
    await this.ctx.resume();
    if (this.anchorIn >= this.duration) this.anchorIn = 0;
    this.anchorOut = this.changeTime();
    node.schedule({
      active: true,
      input: this.anchorIn,
      output: this.anchorOut,
      rate: this.tempo,
      semitones: this.semitones,
    });
    this.isPlaying = true;
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.anchorIn = this.position;
    this.isPlaying = false;
    void this.ready.then(({ node }) => node.schedule({ active: false, output: this.ctx.currentTime }));
  }

  seek(sec: number): void {
    let target = Math.max(0, Math.min(this.duration, sec));
    // 루프 뒤로 가면 노드가 즉시 루프 안으로 접어 넣으므로 루프 시작으로 보낸다.
    // 루프 앞은 그대로 둔다 (도입부부터 듣고 루프로 들어가기).
    if (this.loop && target >= this.loop.b) target = this.loop.a;
    if (!this.isPlaying) {
      this.anchorIn = target;
      return;
    }
    this.anchorIn = target;
    this.anchorOut = this.changeTime();
    void this.ready.then(({ node }) => node.schedule({ input: target, output: this.anchorOut }));
  }

  setTempo(ratio: number): void {
    if (this.isPlaying) {
      const t = this.changeTime();
      this.anchorIn = this.positionAt(t);
      this.anchorOut = t;
      void this.ready.then(({ node }) => node.schedule({ rate: ratio, output: t }));
    }
    this.tempo = ratio;
  }

  setPitch(semitones: number): void {
    this.semitones = semitones;
    if (this.isPlaying) {
      const t = this.changeTime();
      void this.ready.then(({ node }) => node.schedule({ semitones, output: t }));
    }
  }

  setLoop(a: number | null, b: number | null): void {
    const next = a !== null && b !== null && b > a ? { a, b } : null;
    if (this.isPlaying) {
      // 이전 루프 규칙으로 기준점을 옮긴 뒤 바꾼다
      const t = this.changeTime();
      this.anchorIn = this.positionAt(t);
      this.anchorOut = t;
      this.loop = next;
      // 노드는 loopStart == loopEnd 이면 루프를 끈다
      void this.ready.then(({ node }) =>
        node.schedule({ loopStart: next?.a ?? 0, loopEnd: next?.b ?? 0, output: t }),
      );
    } else {
      this.loop = next;
      void this.ready.then(({ node }) => node.schedule({ loopStart: next?.a ?? 0, loopEnd: next?.b ?? 0 }));
    }
    const pos = this.position;
    if (next && (pos < next.a || pos >= next.b)) this.seek(next.a);
  }

  setGain(db: number): void {
    // 재생 중 바꿔도 클릭이 나지 않도록 짧게 따라가게 한다
    this.gain.gain.setTargetAtTime(10 ** (db / 20), this.ctx.currentTime, PARAM_SMOOTHING_SEC);
  }

  setEq(low: number, mid: number, high: number): void {
    [low, mid, high].forEach((db, i) =>
      this.eq[i].gain.setTargetAtTime(db, this.ctx.currentTime, PARAM_SMOOTHING_SEC),
    );
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    await this.ctx.setSinkId(deviceId);
  }

  /** 지금 예약하면 실제로 들리기 시작하는 컨텍스트 시각 */
  private changeTime(): number {
    return this.ctx.currentTime + this.outputLatency;
  }

  /** 노드와 같은 규칙: 루프 끝에 닿으면 루프 길이만큼 되돌린다 */
  private positionAt(t: number): number {
    let p = this.anchorIn + Math.max(0, t - this.anchorOut) * this.tempo;
    const loop = this.loop;
    if (loop && p >= loop.b) p = loop.a + ((p - loop.a) % (loop.b - loop.a));
    return Math.min(this.duration, p);
  }
}
