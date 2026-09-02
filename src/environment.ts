const SAFE_ENVIRONMENT_KEYS = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL",
  "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ", "CI",
  "NO_COLOR", "FORCE_COLOR", "TERM", "COLORTERM",
  "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT",
  "npm_config_cache", "npm_config_prefix", "npm_config_user_agent",
] as const;

export function generatedProcessEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    if (source[key] !== undefined) environment[key] = source[key];
  }
  for (const [key, value] of Object.entries(source)) {
    if (key.startsWith("LC_") && value !== undefined) environment[key] = value;
  }
  return environment;
}

export function challengeProcessEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment = generatedProcessEnvironment(source);
  for (const [key, value] of Object.entries(source)) {
    if ((key.startsWith("CHALLENGE_") || key === "MAX_LLM_REPAIR_ATTEMPTS") && value !== undefined) environment[key] = value;
  }
  const provider = source.CHALLENGE_PROVIDER ?? (source.BERGET_API_KEY ? "berget" : undefined);
  if (provider === "berget" && source.BERGET_API_KEY) environment.BERGET_API_KEY = source.BERGET_API_KEY;
  return environment;
}
