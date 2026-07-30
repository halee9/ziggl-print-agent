import fs from 'node:fs';
import path from 'node:path';
import type { PersistedJob } from './types';
import { log } from './log';

// POS의 autoPrintedRef(중복 방지) + autoPrintInitRef(초기 프린트 폭풍 방지)를 영속화한 것
export interface AgentState {
  initialized: boolean;
  printedIds: Record<string, string>; // orderId → printed-at ISO (또는 "init-marked"/"skipped-READY" 태그 포함)
  pendingJobs: PersistedJob[];
}

const PRUNE_DAYS = 3; // /active 창(당일)보다 넉넉히

export class StateStore {
  private filePath: string;
  state: AgentState;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, 'state.json');
    this.state = this.load();
  }

  private load(): AgentState {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      const state: AgentState = {
        initialized: raw.initialized === true,
        printedIds: raw.printedIds && typeof raw.printedIds === 'object' ? raw.printedIds : {},
        pendingJobs: Array.isArray(raw.pendingJobs) ? raw.pendingJobs : [],
      };
      this.prune(state);
      return state;
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        log.warn(`state.json unreadable (${err.message}) — treating as first run (init guard will mark, not print)`);
      }
      return { initialized: false, printedIds: {}, pendingJobs: [] };
    }
  }

  private prune(state: AgentState) {
    const cutoff = Date.now() - PRUNE_DAYS * 86400_000;
    for (const [id, iso] of Object.entries(state.printedIds)) {
      const t = new Date(iso.split('|')[0]).getTime();
      if (Number.isFinite(t) && t < cutoff) delete state.printedIds[id];
    }
  }

  isPrinted(orderId: string): boolean {
    return orderId in this.state.printedIds;
  }

  markPrinted(orderId: string, tag?: string) {
    this.state.printedIds[orderId] = new Date().toISOString() + (tag ? `|${tag}` : '');
    this.persist();
  }

  setInitialized() {
    this.state.initialized = true;
    this.persist();
  }

  setPendingJobs(jobs: PersistedJob[]) {
    this.state.pendingJobs = jobs;
    this.persist();
  }

  persist() {
    const tmp = this.filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.filePath);
  }
}
