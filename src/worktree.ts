import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import path from "node:path"

const exec = promisify(execFile)

/**
 * Create a detached git worktree for a session.
 * Uses `--detach` to avoid branch-name conflicts across concurrent sessions.
 */
export async function createWorktree(
  projectDir: string,
  baseDir: string,
  sessionID: string,
): Promise<string> {
  const worktreeDir = path.join(baseDir, sessionID)
  await fs.mkdir(worktreeDir, { recursive: true })

  await exec("git", ["worktree", "add", "--detach", worktreeDir, "HEAD"], {
    cwd: projectDir,
  })

  return worktreeDir
}

/**
 * Remove a git worktree and clean up its directory.
 */
export async function removeWorktree(
  projectDir: string,
  worktreeDir: string,
): Promise<void> {
  await exec("git", ["worktree", "remove", "--force", worktreeDir], {
    cwd: projectDir,
  }).catch(() => {})

  await fs.rm(worktreeDir, { recursive: true, force: true }).catch(() => {})
}

/**
 * Prune stale worktree references (e.g. after a crash).
 */
export async function pruneWorktrees(projectDir: string): Promise<void> {
  await exec("git", ["worktree", "prune"], { cwd: projectDir }).catch(() => {})
}
