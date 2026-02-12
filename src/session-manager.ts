import { VM, RealFSProvider } from "@earendil-works/gondolin"
import { createWorktree, removeWorktree } from "./worktree"

export interface SessionState {
  vm: VM
  worktreeDir: string
  vmWorkspace: string // always "/workspace"
  createdAt: number
}

export class SessionManager {
  private sessions = new Map<string, SessionState>()
  private initializing = new Map<string, Promise<SessionState>>()

  constructor(
    private projectDir: string,
    private config: { baseDir: string; vmWorkspace: string },
  ) {}

  /**
   * Return an existing session or create a new one.
   * Concurrent calls for the same sessionID share a single initialisation
   * promise so the VM and worktree are only created once.
   */
  async getOrCreate(sessionID: string): Promise<SessionState> {
    const existing = this.sessions.get(sessionID)
    if (existing) return existing

    const inflight = this.initializing.get(sessionID)
    if (inflight) return inflight

    const promise = this.init(sessionID)
    this.initializing.set(sessionID, promise)

    try {
      const state = await promise
      this.sessions.set(sessionID, state)
      return state
    } finally {
      this.initializing.delete(sessionID)
    }
  }

  /**
   * Return an existing session without creating one.
   */
  get(sessionID: string): SessionState | undefined {
    return this.sessions.get(sessionID)
  }

  /**
   * Check whether a session exists.
   */
  has(sessionID: string): boolean {
    return this.sessions.has(sessionID)
  }

  /**
   * Close the VM, remove the worktree, and delete the session from all maps.
   */
  async destroy(sessionID: string): Promise<void> {
    const state = this.sessions.get(sessionID)
    if (!state) return

    this.sessions.delete(sessionID)
    this.initializing.delete(sessionID)

    await state.vm.close()
    await removeWorktree(this.projectDir, state.worktreeDir)
  }

  /**
   * Destroy every active session. Intended for process-exit cleanup.
   */
  async destroyAll(): Promise<void> {
    const ids = [...this.sessions.keys()]
    await Promise.all(ids.map((id) => this.destroy(id)))
  }

  // ---- private ----

  private async init(sessionID: string): Promise<SessionState> {
    const worktreeDir = await createWorktree(
      this.projectDir,
      this.config.baseDir,
      sessionID,
    )

    const vm = await VM.create({
      vfs: {
        mounts: {
          [this.config.vmWorkspace]: new RealFSProvider(worktreeDir),
        },
      },
    })

    return {
      vm,
      worktreeDir,
      vmWorkspace: this.config.vmWorkspace,
      createdAt: Date.now(),
    }
  }
}
