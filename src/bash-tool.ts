import { tool } from "@opencode-ai/plugin"
import type { SessionManager } from "./session-manager"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = 2 * 60 * 1000

export function createBashTool(
  sessionManager: SessionManager,
  projectDir: string,
  vmWorkspace: string,
) {
  return tool({
    description: `Run a bash command inside a Gondolin micro-VM. The working directory defaults to ${vmWorkspace}.`,
    args: {
      command: tool.schema.string().describe("The bash command to execute"),
      timeout: tool.schema
        .number()
        .optional()
        .describe("Timeout in milliseconds"),
      workdir: tool.schema
        .string()
        .optional()
        .describe(
          `Working directory for the command. Defaults to ${vmWorkspace}`,
        ),
      description: tool.schema
        .string()
        .optional()
        .describe("A description of what this command does"),
    },
    async execute(args, context) {
      const state = await sessionManager.getOrCreate(context.sessionID)

      // Remap workdir: replace projectDir prefix with vmWorkspace
      let cwd = vmWorkspace
      if (args.workdir) {
        if (args.workdir.startsWith(projectDir)) {
          cwd =
            vmWorkspace + args.workdir.slice(projectDir.length)
        } else {
          cwd = args.workdir
        }
      }

      // Validate and default timeout
      const timeout =
        args.timeout && args.timeout > 0 ? args.timeout : DEFAULT_TIMEOUT

      // Set initial metadata
      context.metadata({
        title: args.description ?? args.command,
        metadata: { command: args.command, cwd, output: "" },
      })

      // Execute the command in the VM
      const proc = state.vm.exec(["/bin/bash", "-lc", args.command], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      })

      let output = ""
      let timedOut = false
      let aborted = false

      // Timeout handling
      const timer = setTimeout(() => {
        timedOut = true
        proc.kill?.()
      }, timeout)

      // Abort signal handling
      const onAbort = () => {
        aborted = true
        proc.kill?.()
      }
      context.abort.addEventListener("abort", onAbort, { once: true })

      try {
        for await (const chunk of proc.output()) {
          output += chunk.data
          context.metadata({
            title: args.description ?? args.command,
            metadata: {
              command: args.command,
              cwd,
              output: output.slice(-MAX_METADATA_LENGTH),
            },
          })

          if (timedOut || aborted) break
        }

        const result = await proc

        // Append exit code info if non-zero
        if (result.exitCode !== 0) {
          if (result.stderr) {
            output += result.stderr
          }
        }
      } catch {
        // Process may have been killed due to timeout or abort
      } finally {
        clearTimeout(timer)
        context.abort.removeEventListener("abort", onAbort)
      }

      if (timedOut) {
        output += "\n<metadata>Command timed out</metadata>"
      }
      if (aborted) {
        output += "\n<metadata>Command was aborted</metadata>"
      }

      return output
    },
  })
}
