import { defaultLook, type ProducerLook } from '../config/producer.config';
import { PrimeApiError } from '../net/PrimeApi';
import type { Game } from './Game';

// Alpha 1.9.0 — PRIME PRODUCER AVATARS on this page. The SERVER holds the look; this keeps the signed-in account's copy
// in memory only (never localStorage), forgets it the moment another account signs in, and saves one change at a time
// with the revision it was based on (another tab saved meanwhile → the server's look is taken, nothing is mixed).

export interface OwnLook extends ProducerLook {
  rev: number;
  chosen: boolean;
}

export class ProducerRuntime {
  look: OwnLook | null = null;
  /** The account this look belongs to. */
  private uid = '';
  loading = false;
  saving = false;
  error = '';
  private listeners = new Set<() => void>();

  constructor(private readonly g: Game) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** The signed-in account here (null: a guest) — and whether this server knows producer looks. */
  private account(): { uid: string } | null {
    const acc = this.g.account;
    const me = acc?.me;
    if (!acc?.api || !me || !acc.serverConfig?.producer) return null;
    return { uid: me.id };
  }

  /** The look to show for this page's producer: the server's, else the stable default of the account (or a guest's). */
  shown(): ProducerLook {
    const a = this.account();
    if (a && this.look && this.uid === a.uid) return this.look;
    return defaultLook(a ? a.uid : 'guest');
  }

  canSave(): boolean {
    const acc = this.g.account;
    return !!this.account() && !!acc?.me?.verified;
  }

  /** Loads the account's look (a new account on this page forgets the previous one first). */
  async load(): Promise<void> {
    const a = this.account();
    if (!a) {
      if (this.look) {
        this.look = null;
        this.uid = '';
        this.emit();
      }
      return;
    }
    if (this.uid !== a.uid) {
      this.look = null;
      this.uid = a.uid;
    }
    if (this.loading) return;
    this.loading = true;
    this.error = '';
    try {
      const l = await this.g.account!.api!.producerGet();
      if (this.uid === a.uid) this.look = l;
    } catch (e) {
      this.error = e instanceof PrimeApiError ? e.code : 'network';
    }
    this.loading = false;
    this.emit();
  }

  /** Saves; resolves 'ok' | 'changed' (another tab saved — the server's look is now shown) | an error code. */
  async save(next: ProducerLook): Promise<string> {
    const a = this.account();
    if (!a || this.saving) return 'busy';
    this.saving = true;
    this.emit();
    let res = 'ok';
    try {
      this.look = await this.g.account!.api!.producerPut(next, this.look?.rev ?? 0);
      this.uid = a.uid;
    } catch (e) {
      const err = e instanceof PrimeApiError ? e : null;
      if (err?.code === 'look_changed' && err.data.look) {
        this.look = err.data.look as OwnLook;
        res = 'changed';
      } else res = err?.code || 'network';
    }
    this.saving = false;
    this.emit();
    return res;
  }
}
