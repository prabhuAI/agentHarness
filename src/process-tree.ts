import type { ChildProcess } from "node:child_process";

export function usesDetachedProcessGroup(): boolean {
  return process.platform !== "win32";
}

// A process that has already exited (or is mid-reap) is no longer signalable:
// the OS reports ESRCH, and on some platforms EPERM when the pid was just
// recycled. Both mean "nothing to kill", not a real failure.
function isAlreadyGone(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ESRCH" || code === "EPERM";
}

export function signalProcessTree(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (child.pid === undefined) return false;

  if (usesDetachedProcessGroup()) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if (!isAlreadyGone(error)) throw error;
    }
  }

  try {
    return child.kill(signal);
  } catch (error) {
    if (!isAlreadyGone(error)) throw error;
    return false;
  }
}

export async function terminateProcessTree(child: ChildProcess, gracePeriodMs = 500): Promise<void> {
  if (!signalProcessTree(child, "SIGTERM")) return;
  await new Promise((resolve) => setTimeout(resolve, gracePeriodMs));
  signalProcessTree(child, "SIGKILL");
}
