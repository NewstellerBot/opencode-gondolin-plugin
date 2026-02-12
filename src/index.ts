import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { SessionManager } from "./session-manager"
import { createBashTool } from "./bash-tool"
import { remapPath, TOOL_PATH_ARGS } from "./path-remap"
import { pruneWorktrees } from "./worktree"

const DEFAULT_VM_WORKSPACE = "/workspace"

export const GondolinPlugin: Plugin = async (input) => {
  const { directory, project } = input
  const projectName = project.name ?? path.basename(directory)
  const baseDir = path.join("/tmp", "opencode-gondolin", projectName)
  const vmWorkspace = DEFAULT_VM_WORKSPACE

  const sessionManager = new SessionManager(directory, { baseDir, vmWorkspace })

  // Clean up stale worktrees from previous crashes
  await pruneWorktrees(directory).catch(() => {})

  // Process exit cleanup
  const cleanup = () => {
    sessionManager.destroyAll().catch(() => {})
  }
  process.on("SIGINT", cleanup)
  process.on("SIGTERM", cleanup)
  process.on("beforeExit", cleanup)

  return {
    // Override the bash tool to execute inside the VM
    tool: {
      bash: createBashTool(sessionManager, directory, vmWorkspace),
    },

    // Remap file paths for read/write/edit/glob/grep to the session's worktree
    "tool.execute.before": async (toolInput, output) => {
      const pathArgs = TOOL_PATH_ARGS[toolInput.tool]
      if (!pathArgs) return

      const state = await sessionManager.getOrCreate(toolInput.sessionID)

      for (const argName of pathArgs) {
        const value = output.args[argName]
        if (typeof value !== "string") continue
        output.args[argName] = remapPath(value, directory, state.worktreeDir)
      }
    },

    // Auto-allow worktree paths that would trigger external_directory prompts
    "permission.ask": async (permission, output) => {
      if (permission.type !== "external_directory") return

      const patterns = (permission as any).patterns as string[] | undefined
      if (!patterns) return

      const isWorktreePath = patterns.some((p) => p.startsWith(baseDir))
      if (isWorktreePath) {
        output.status = "allow"
      }
    },

    // Inform the model about the sandbox environment
    "experimental.chat.system.transform": async (transformInput, output) => {
      const { sessionID } = transformInput
      if (!sessionID) return

      const state = sessionManager.get(sessionID)
      if (!state) return

      output.system.push(
        [
          "<gondolin-sandbox>",
          "This session is running inside a Gondolin sandboxed VM.",
          `Bash commands execute inside the VM at ${vmWorkspace}.`,
          `File operations target the worktree at ${state.worktreeDir}.`,
          `Use ${state.worktreeDir} as the base directory for file paths.`,
          "</gondolin-sandbox>",
        ].join("\n"),
      )
    },

    // Clean up VMs and worktrees when sessions are deleted
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        const info = (event as any).properties?.info
        if (info?.id) {
          await sessionManager.destroy(info.id).catch(() => {})
        }
      }
    },
  }
}

export default GondolinPlugin
