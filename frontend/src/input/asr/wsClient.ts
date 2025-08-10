export type AsrEvent =
  | { type: 'ready' }
  | { type: 'final', text: string }
  | { type: 'error', error: string };

export class AsrWsClient {
  private ws?: WebSocket;
  private url: string;
  private queue: (ArrayBuffer | string)[] = [];
  private open = false;
  private onFinalCallback?: (text: string) => void;

  constructor(url = (import.meta.env.VITE_ASR_BACKEND?.replace(/^http/,'ws') || 'ws://localhost:8000/asr/stream')) {
    this.url = url;
  }

  async connect(onEvent?: (e: AsrEvent) => void) {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => {
        this.open = true;
        console.log('[AsrWsClient] WebSocket opened to', this.url);
        for (const m of this.queue) this.ws!.send(m);
        this.queue = [];
        resolve();
      };
      this.ws.onmessage = (evt) => {
        try {
          const obj = JSON.parse(typeof evt.data === 'string' ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer));
          const event = obj as AsrEvent;
          if (onEvent) onEvent(event);
          if (event.type === 'final' && this.onFinalCallback) {
            this.onFinalCallback(event.text);
          }
        } catch {}
      };
      this.ws.onerror = (err) => {
        console.error('[AsrWsClient] WebSocket error:', err);
        if (onEvent) onEvent({ type: 'error', error: 'ws error' });
        reject(err);
      };
      this.ws.onclose = () => { 
        this.open = false; 
        console.log('[AsrWsClient] WebSocket closed');
      };
    });
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

  onFinal(callback: (text: string) => void) {
    this.onFinalCallback = callback;
  }

  isConnected() {
    return this.open;
  }

  sendFrame(frame: Float32Array | Int16Array) {
    if (frame instanceof Int16Array) {
      this.pushPcm(frame);
    } else {
      // Convert Float32Array to Int16Array for sending
      const int16 = new Int16Array(frame.length);
      for (let i = 0; i < frame.length; i++) {
        const s = Math.max(-1, Math.min(1, frame[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      this.pushPcm(int16);
    }
  }
}


