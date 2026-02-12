import { tool } from "@opencode-ai/plugin"
import type { SessionManager } from "./session-manager"
import {
  hasChanges,
  commitAllChanges,
  pushBranch,
  getRemoteUrl,
} from "./worktree"

/**
 * Create the create_branch tool that pushes worktree changes to the original repo.
 */
export function createBranchTool(
  sessionManager: SessionManager,
  projectDir: string,
) {
  return tool({
    description: `Create a new branch on the original repository with all changes from this sandbox session. This stages all changes, commits them, and pushes to the remote as a new branch. Use this before ending the session to make it easy to create a PR from your changes. The tool will fail if the branch already exists on the remote.`,
    args: {
      branchName: tool.schema
        .string()
        .describe(
          "The name of the branch to create (e.g., 'opencode/fix-login-bug'). Must not already exist on the remote.",
        ),
      commitMessage: tool.schema
        .string()
        .describe(
          "The commit message describing the changes (e.g., 'Fix login validation bug')",
        ),
      description: tool.schema
        .string()
        .optional()
        .describe("A description of what this tool call does"),
    },
    async execute(args, context) {
      const state = sessionManager.get(context.sessionID)
      if (!state) {
        return "Error: No active session found. The sandbox may not have been initialized."
      }

      const { worktreeDir } = state

      // Update metadata
      context.metadata({
        title: args.description ?? `Creating branch: ${args.branchName}`,
        metadata: {
          branchName: args.branchName,
          commitMessage: args.commitMessage,
          status: "checking for changes",
        },
      })

      // Check if there are any changes to commit
      const changes = await hasChanges(worktreeDir)
      if (!changes) {
        return "No changes to push. The working tree is clean."
      }

      // Stage and commit all changes
      context.metadata({
        title: args.description ?? `Creating branch: ${args.branchName}`,
        metadata: {
          branchName: args.branchName,
          commitMessage: args.commitMessage,
          status: "committing changes",
        },
      })

      try {
        await commitAllChanges(worktreeDir, args.commitMessage)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `Error committing changes: ${message}`
      }

      // Push to remote
      context.metadata({
        title: args.description ?? `Creating branch: ${args.branchName}`,
        metadata: {
          branchName: args.branchName,
          commitMessage: args.commitMessage,
          status: "pushing to remote",
        },
      })

      try {
        await pushBranch(worktreeDir, args.branchName)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes("already exists")) {
          return `Error: Branch '${args.branchName}' already exists on the remote. Please choose a different branch name.`
        }
        return `Error pushing branch: ${message}`
      }

      // Get remote URL for helpful output
      const remoteUrl = await getRemoteUrl(projectDir)
      let result = `Successfully created branch '${args.branchName}' with your changes.`

      if (remoteUrl) {
        // Try to construct a PR URL for common Git hosts
        const prUrl = getPullRequestUrl(remoteUrl, args.branchName)
        if (prUrl) {
          result += `\n\nCreate a PR: ${prUrl}`
        } else {
          result += `\n\nRemote: ${remoteUrl}`
        }
      }

      return result
    },
  })
}

/**
 * Auto-create a branch for a session (used on session cleanup).
 * Returns the branch name if successful, null if skipped or failed.
 */
export async function autoCreateBranch(
  sessionManager: SessionManager,
  projectDir: string,
  sessionID: string,
): Promise<string | null> {
  const state = sessionManager.get(sessionID)
  if (!state) return null

  const { worktreeDir } = state

  // Check if there are any changes
  const changes = await hasChanges(worktreeDir).catch(() => false)
  if (!changes) return null

  // Generate branch name and commit message from session ID
  const shortId = sessionID.replace(/^ses_/, "").slice(0, 8)
  const branchName = `opencode/session-${shortId}`
  const commitMessage = `Changes from OpenCode session ${sessionID}`

  try {
    await commitAllChanges(worktreeDir, commitMessage)
    await pushBranch(worktreeDir, branchName)
    return branchName
  } catch {
    // Silently fail - this is best-effort cleanup
    return null
  }
}

/**
 * Try to construct a PR creation URL for common Git hosting services.
 */
function getPullRequestUrl(
  remoteUrl: string,
  branchName: string,
): string | null {
  // Normalize the remote URL
  let normalized = remoteUrl
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "")

  // GitHub
  if (normalized.includes("github.com")) {
    return `${normalized}/compare/${encodeURIComponent(branchName)}?expand=1`
  }

  // GitLab
  if (normalized.includes("gitlab.com") || normalized.includes("gitlab")) {
    return `${normalized}/-/merge_requests/new?merge_request[source_branch]=${encodeURIComponent(branchName)}`
  }

  // Bitbucket
  if (normalized.includes("bitbucket.org")) {
    return `${normalized}/pull-requests/new?source=${encodeURIComponent(branchName)}`
  }

  return null
}
