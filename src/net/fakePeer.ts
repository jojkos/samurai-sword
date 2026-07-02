/* Minimal in-memory stand-in for PeerJS, used by session.test.ts via vi.mock.
   Events fire synchronously; connections record everything they were sent. */

type Handler = (...args: unknown[]) => void

export class FakeConn {
  handlers: Record<string, Handler[]> = {}
  sent: unknown[] = []
  closed = false
  on(ev: string, cb: Handler) {
    ;(this.handlers[ev] ??= []).push(cb)
  }
  send(msg: unknown) {
    this.sent.push(msg)
  }
  close() {
    this.closed = true
    this.emit('close')
  }
  emit(ev: string, ...args: unknown[]) {
    ;(this.handlers[ev] ?? []).forEach((cb) => cb(...args))
  }
}

export class Peer {
  static instances: Peer[] = []
  handlers: Record<string, Handler[]> = {}
  destroyed = false
  lastConn: FakeConn | null = null
  constructor(public id?: string) {
    Peer.instances.push(this)
  }
  on(ev: string, cb: Handler) {
    ;(this.handlers[ev] ??= []).push(cb)
  }
  emit(ev: string, ...args: unknown[]) {
    ;(this.handlers[ev] ?? []).forEach((cb) => cb(...args))
  }
  connect(_id: string, _opts?: unknown): FakeConn {
    const c = new FakeConn()
    this.lastConn = c
    return c
  }
  destroy() {
    this.destroyed = true
  }
}

export const DataConnection = FakeConn
export default Peer
