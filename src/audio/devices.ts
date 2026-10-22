export interface OutputDevice {
  id: string; // '' = 시스템 기본 장치
  label: string;
}

/**
 * 출력 장치 목록. Chromium은 미디어 권한이 없으면 장치 이름을 숨기므로,
 * 이름이 비어 있으면 마이크 권한을 한 번 요청한 뒤 다시 조회한다 (녹음은 하지 않는다).
 */
export async function listOutputDevices(): Promise<OutputDevice[]> {
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.some((d) => d.kind === 'audiooutput' && !d.label)) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      // 권한 거부: 기본 장치만 쓴다
    }
  }
  const outputs = devices
    .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label)
    .map((d) => ({ id: d.deviceId, label: d.label }));
  return [{ id: '', label: '시스템 기본 장치' }, ...outputs];
}
