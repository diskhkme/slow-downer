// ITU-R BS.1770-4 / EBU R128 통합 라우드니스(LUFS)와 샘플 피크.
// K-weighting 계수는 샘플레이트별로 계산한다 (libebur128과 같은 방식).

export interface Loudness {
  lufs: number; // 통합 라우드니스. 무음이면 -Infinity
  peakDb: number; // 샘플 피크 dBFS
}

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  // 1단: 머리 효과를 반영한 고역 셸프
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  // 2단: RLB 고역 통과
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  K = Math.tan((Math.PI * f1) / sampleRate);
  a0 = 1 + K / Q1 + K * K;
  const highpass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q1 + K * K) / a0,
  };
  return [shelf, highpass];
}

/** K-weighting을 거친 신호의 제곱을 step 길이 구간별로 합한다 */
function weightedEnergyPerStep(x: Float32Array, filters: [Biquad, Biquad], step: number): Float64Array {
  const out = new Float64Array(Math.floor(x.length / step));
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0; // 1단 상태
  let u1 = 0, u2 = 0, w1 = 0, w2 = 0; // 2단 상태
  const [s, h] = filters;
  for (let i = 0; i < out.length * step; i++) {
    const v = x[i];
    const y = s.b0 * v + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    const w = h.b0 * y + h.b1 * u1 + h.b2 * u2 - h.a1 * w1 - h.a2 * w2;
    u2 = u1; u1 = y; w2 = w1; w1 = w;
    out[Math.floor(i / step)] += w * w;
  }
  return out;
}

export function measureLoudness(channels: Float32Array[], sampleRate: number): Loudness {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]));

  // 400ms 블록을 100ms 간격으로 (75% 겹침)
  const step = Math.round(sampleRate * 0.1);
  const filters = kWeighting(sampleRate);
  // 모노는 양쪽 스피커로 재생되므로 듀얼 모노로 센다
  const weight = channels.length === 1 ? 2 : 1;
  const steps = channels.map((ch) => weightedEnergyPerStep(ch, filters, step));
  const blockCount = steps[0].length - 3;
  const blocks = new Float64Array(Math.max(0, blockCount));
  for (let b = 0; b < blockCount; b++) {
    let sum = 0;
    for (const s of steps) sum += s[b] + s[b + 1] + s[b + 2] + s[b + 3];
    blocks[b] = (weight * sum) / (4 * step); // 채널 평균제곱의 합
  }

  const toLufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);
  const gatedMean = (threshold: number) => {
    let sum = 0, n = 0;
    for (const z of blocks) if (toLufs(z) > threshold) { sum += z; n++; }
    return n ? sum / n : 0;
  };
  const absolute = gatedMean(-70);
  const lufs = absolute > 0 ? toLufs(gatedMean(toLufs(absolute) - 10)) : -Infinity;
  return { lufs, peakDb: 20 * Math.log10(peak) };
}
