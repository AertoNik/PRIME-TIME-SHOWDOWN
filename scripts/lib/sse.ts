// A minimal EventSource for Node (the PocketBase SDK's realtime needs one): fetch with a streamed body, the
// text/event-stream format (event / data / id lines, a blank line ends a message). Checks only — never shipped.

type Listener = (e: { data: string; lastEventId: string; type: string }) => void;

export class NodeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readyState = 0;
  onerror: ((e: unknown) => void) | null = null;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: Listener | null = null;
  private ctl = new AbortController();
  private listeners = new Map<string, Set<Listener>>();
  /** Checks: drop (and keep dropping) every message whose data matches — a network that loses packets. */
  static drop: ((data: string) => boolean) | null = null;
  /** Checks: hold each message this many ms before delivering it (a slow network). */
  static delayMs = 0;

  constructor(readonly url: string) {
    void this.run();
  }

  addEventListener(type: string, fn: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener): void {
    this.listeners.get(type)?.delete(fn);
  }
  close(): void {
    this.readyState = 2;
    this.ctl.abort();
  }

  private dispatch(type: string, data: string, id: string): void {
    if (NodeEventSource.drop && NodeEventSource.drop(data)) return;
    const ev = { data, lastEventId: id, type };
    const go = () => {
      if (this.readyState === 2) return;
      if (type === 'message') this.onmessage?.(ev);
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    };
    if (NodeEventSource.delayMs > 0) setTimeout(go, NodeEventSource.delayMs);
    else go();
  }

  private async run(): Promise<void> {
    try {
      const r = await fetch(this.url, { headers: { Accept: 'text/event-stream' }, signal: this.ctl.signal });
      if (!r.ok || !r.body) throw new Error('sse ' + r.status);
      this.readyState = 1;
      this.onopen?.({});
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          let type = 'message';
          let id = '';
          const data: string[] = [];
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) type = line.slice(6).trim();
            else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
            else if (line.startsWith('id:')) id = line.slice(3).trim();
          }
          this.dispatch(type, data.join('\n'), id);
        }
      }
      if (this.readyState !== 2) throw new Error('sse closed');
    } catch (e) {
      if (this.readyState === 2) return;
      this.readyState = 2;
      this.onerror?.(e);
    }
  }
}
