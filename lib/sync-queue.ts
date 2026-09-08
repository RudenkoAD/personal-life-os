import type { Action, LifeState } from './domain.ts';
import { ApiError } from './api-client.ts';
import {
  applyMutation,
  prepareMutation,
  validateMutation,
  type Mutation,
} from './mutations.ts';
export type SyncSnapshot = {
  state: LifeState | null;
  count: number;
  status: 'loading' | 'saved' | 'sending' | 'retrying' | 'blocked';
  error: string;
  canDiscard: boolean;
  needsSignIn: boolean;
  calendarPending: boolean;
  storageError: string;
  discardCount: number;
};
type ActionJob = {
  kind: 'action';
  mutation: Mutation;
  projectionError?: string;
};
type RemoteJob = {
  kind: 'remote';
  path: string;
  payload: Record<string, unknown>;
  resolve: (ok: boolean) => void;
};
type Job = ActionJob | RemoteJob;
type Dependencies = {
  load: (ids: string[]) => Promise<{ state: LifeState; applied: string[] }>;
  send: (revision: number, mutation: Mutation) => Promise<LifeState>;
  remote: (
    path: string,
    payload: Record<string, unknown>,
  ) => Promise<LifeState>;
  read: () => unknown;
  write: (mutations: Mutation[]) => void;
  changed: (snapshot: SyncSnapshot) => void;
  remoteError: (error: unknown) => void;
  retryDelay?: (attempt: number) => number;
};
/** Confirmed state plus an ordered, replayable outbox. Only one write is in flight. */
export class SyncQueue {
  private deps: Dependencies;
  private base: LifeState | null = null;
  private view: LifeState | null = null;
  private jobs: Job[] = [];
  private working = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private error = '';
  private canDiscard = false;
  private needsSignIn = false;
  private storageError = '';
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  snapshot(): SyncSnapshot {
    return {
      state: this.view,
      count: this.jobs.length,
      status: this.error
        ? 'blocked'
        : !this.base
          ? 'loading'
          : this.timer
            ? 'retrying'
            : this.jobs.length
              ? 'sending'
              : 'saved',
      error: this.error,
      canDiscard: this.canDiscard,
      needsSignIn: this.needsSignIn,
      calendarPending: this.jobs.some((j) => j.kind === 'remote'),
      storageError: this.storageError,
      discardCount: this.canDiscard ? this.discardPlan().size : 0,
    };
  }
  private emit() {
    if (!this.stopped) this.deps.changed(this.snapshot());
  }
  private ids() {
    return this.jobs.flatMap((j) =>
      j.kind === 'action' ? [j.mutation.id] : [],
    );
  }
  private persist() {
    try {
      this.deps.write(
        this.jobs.flatMap((j) => (j.kind === 'action' ? [j.mutation] : [])),
      );
      this.storageError = '';
    } catch {
      this.storageError = this.jobs.length
        ? 'Не удалось сохранить очередь в этой вкладке. Дождитесь синхронизации перед закрытием.'
        : '';
    }
  }
  private rebuild() {
    if (!this.base) return;
    let state = this.base;
    for (const job of this.jobs)
      if (job.kind === 'action') {
        try {
          state = applyMutation(state, job.mutation);
          delete job.projectionError;
        } catch (e) {
          job.projectionError = (e as Error).message;
        }
      }
    this.view = state;
  }
  private async reconcile() {
    const result = await this.deps.load(this.ids());
    if (this.stopped) return;
    this.base = result.state;
    const applied = new Set(result.applied);
    this.jobs = this.jobs.filter(
      (j) => j.kind === 'remote' || !applied.has(j.mutation.id),
    );
    this.persist();
    this.rebuild();
    this.emit();
  }
  async start() {
    try {
      const stored = this.deps.read();
      if (stored !== null && stored !== undefined) {
        if (!Array.isArray(stored) || stored.length > 100)
          throw Error('Не удалось восстановить очередь изменений');
        const seen = new Set<string>();
        this.jobs = stored.map((value) => {
          const mutation = validateMutation(value);
          if (seen.has(mutation.id)) throw Error('Повтор в очереди изменений');
          seen.add(mutation.id);
          return { kind: 'action', mutation };
        });
      }
      await this.reconcile();
      if (!this.stopped) void this.pump();
    } catch (e) {
      this.block(e, false);
    }
  }
  enqueue(action: Action): boolean {
    if (!this.view || this.stopped) return false;
    if (this.jobs.length >= 100)
      throw Error('В очереди 100 изменений. Дождитесь синхронизации.');
    const mutation = prepareMutation(this.view, action);
    // Validation happens before accepting the draft and before clearing any form.
    const next = applyMutation(this.view, mutation);
    this.jobs.push({ kind: 'action', mutation });
    this.view = next;
    this.persist();
    this.emit();
    void this.pump();
    return true;
  }
  remote(path: string, payload: Record<string, unknown>): Promise<boolean> {
    if (
      !this.base ||
      this.stopped ||
      this.jobs.some((j) => j.kind === 'remote')
    )
      return Promise.resolve(false);
    return new Promise((resolve) => {
      this.jobs.push({
        kind: 'remote',
        path,
        payload: structuredClone(payload),
        resolve,
      });
      this.emit();
      void this.pump();
    });
  }
  private block(error: unknown, canDiscard: boolean) {
    if (this.stopped) return;
    this.error =
      error instanceof Error
        ? error.message
        : 'Не удалось синхронизировать изменения';
    this.canDiscard = canDiscard;
    this.needsSignIn = error instanceof ApiError && error.needsSignIn;
    this.emit();
  }
  private async pump() {
    if (this.working || this.stopped || this.timer || this.error || !this.base)
      return;
    this.working = true;
    try {
      let conflicts = 0;
      while (this.jobs.length && !this.stopped && !this.error) {
        const job = this.jobs[0];
        if (job.kind === 'action' && job.projectionError) {
          try {
            await this.reconcile();
          } catch (e) {
            this.block(e, false);
            break;
          }
          if (this.jobs[0] !== job) continue;
          if (job.projectionError) {
            this.block(new Error(job.projectionError), true);
            break;
          }
        }
        try {
          const state: LifeState =
            job.kind === 'action'
              ? await this.deps.send(this.base!.revision, job.mutation)
              : await this.deps.remote(job.path, {
                  ...job.payload,
                  revision: this.base!.revision,
                });
          if (this.stopped) return;
          this.base = state;
          this.jobs.shift();
          this.retries = 0;
          this.persist();
          this.rebuild();
          this.emit();
          if (job.kind === 'remote') job.resolve(true);
        } catch (e) {
          if (this.stopped) return;
          if (job.kind === 'remote') {
            this.jobs.shift();
            job.resolve(false);
            this.deps.remoteError(e);
            // Remote imports contain credentials and are never persisted or replayed.
            try {
              await this.reconcile();
            } catch {
              this.rebuild();
              this.emit();
            }
            continue;
          }
          if (
            e instanceof ApiError &&
            e.status === 409 &&
            e.responseIsJson &&
            conflicts++ < 3
          ) {
            try {
              await this.reconcile();
              continue;
            } catch (loadError) {
              this.block(loadError, false);
              break;
            }
          }
          const definitive =
            e instanceof ApiError &&
            e.responseIsJson &&
            [400, 403, 404, 409, 413, 422].includes(e.status) &&
            !e.needsSignIn;
          if (
            !definitive &&
            !(e instanceof ApiError && e.needsSignIn) &&
            this.retries < 3
          ) {
            const delay =
              this.deps.retryDelay?.(this.retries) ??
              [1000, 3000, 10000][this.retries];
            this.retries++;
            this.timer = setTimeout(() => {
              this.timer = undefined;
              this.emit();
              void this.pump();
            }, delay);
            this.emit();
            break;
          }
          this.block(e, definitive);
          break;
        }
      }
    } finally {
      this.working = false;
    }
  }
  async retry() {
    if (this.working || this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.error = '';
    this.canDiscard = false;
    this.needsSignIn = false;
    this.retries = 0;
    this.working = true;
    try {
      await this.reconcile();
    } catch (e) {
      this.block(e, false);
    } finally {
      this.working = false;
    }
    void this.pump();
  }
  private discardPlan() {
    const removed = new Set<Job>();
    const prefixes: string[] = [];
    for (const job of this.jobs) {
      if (job.kind !== 'action') continue;
      const a = job.mutation.action;
      const refs = [
        a.id,
        a.boardId,
        a.columnId,
        a.stepId,
        a.promptId,
        ...(Array.isArray(a.tags) ? a.tags : []),
      ];
      if (
        job === this.jobs[0] ||
        refs.some(
          (ref) =>
            typeof ref === 'string' &&
            prefixes.some((prefix) => ref.startsWith(prefix)),
        )
      ) {
        removed.add(job);
        prefixes.push(`m_${job.mutation.id}_`);
      }
    }
    return removed;
  }
  discardRejected() {
    // An uncertain mutation cannot be discarded until a receipt settles its outcome.
    if (this.working || !this.canDiscard || this.jobs[0]?.kind !== 'action')
      return;
    const removed = this.discardPlan();
    this.jobs = this.jobs.filter((job) => !removed.has(job));
    this.error = '';
    this.canDiscard = false;
    this.needsSignIn = false;
    this.persist();
    this.rebuild();
    this.emit();
    void this.pump();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const job of this.jobs) if (job.kind === 'remote') job.resolve(false);
  }
}
