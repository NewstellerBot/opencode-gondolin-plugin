import path from "node:path"

/**
 * Tools whose path arguments need remapping from project dir → worktree dir.
 * Key = tool ID, value = list of arg names that contain file paths.
 */
export const TOOL_PATH_ARGS: Record<string, string[]> = {
  read: ["filePath"],
  write: ["filePath"],
  edit: ["filePath"],
  glob: ["path"],
  grep: ["path"],
}

/**
 * Remaps a file path from the original project directory to a session's worktree.
 *
 * - Absolute paths within `projectDir` get their prefix replaced with `worktreeDir`
 * - Relative paths are resolved against `worktreeDir`
 * - Paths outside `projectDir` are returned unchanged
 */
export function remapPath(
  filePath: string,
  projectDir: string,
  worktreeDir: string,
): string {
  if (!path.isAbsolute(filePath)) {
    return path.resolve(worktreeDir, filePath)
  }

  const normalized = path.normalize(filePath)
  const normalizedProject = path.normalize(projectDir)

  if (
    normalized === normalizedProject ||
    normalized.startsWith(normalizedProject + path.sep)
  ) {
    const relative = path.relative(normalizedProject, normalized)
    return path.join(worktreeDir, relative)
  }

  // Outside the project — leave it unchanged
  return filePath
}
