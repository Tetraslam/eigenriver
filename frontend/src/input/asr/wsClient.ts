export type AsrEvent =
  | { type: 'ready' }
  | { type: 'final', text: string }
  | { type: 'error', error: string };

export class AsrWsClient {
  private ws?: WebSocket;
  private url: string;
  private queue: (ArrayBuffer | string)[] = [];
  private open = false;

  constructor(url = (import.meta.env.VITE_ASR_BACKEND?.replace(/^http/,'ws') || 'ws://localhost:8000/asr/stream')) {
    this.url = url;
  }

  connect(onEvent: (e: AsrEvent) => void) {
    this.ws = new WebSocket(this.url);
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => {
      this.open = true;
      for (const m of this.queue) this.ws!.send(m);
      this.queue = [];
    };
    this.ws.onmessage = (evt) => {
      try {
        const obj = JSON.parse(typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer));
        onEvent(obj as AsrEvent);
      } catch {}
    };
    this.ws.onerror = () => onEvent({ type: 'error', error: 'ws error' });
    this.ws.onclose = () => { this.open = false; };
  }

  start(sampleRate = 16000, language = 'en') {
    this.send(JSON.stringify({ type: 'start', sample_rate: sampleRate, language }));
  }

  pushPcm(int16: Int16Array) {
    this.send(int16.buffer);
  }

  stop() {
    this.send(JSON.stringify({ type: 'stop' }));
  }

  private send(m: ArrayBuffer | string) {
    if (!this.ws || !this.open) { this.queue.push(m); return; }
    this.ws.send(m);
  }
}


