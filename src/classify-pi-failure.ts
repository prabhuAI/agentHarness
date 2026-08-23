// Maps a failed Pi run to a specific, honest cause so result.json and the
// console say what actually went wrong instead of a generic fallback. Two
// distinct classes are handled: provider/transport errors surfaced on Pi's
// stderr (fatal, worth aborting early) and model-capability failures where Pi
// exits cleanly but never produces verifiable artifacts.

export type PiFailureKind =
  | "auth"
  | "rate_limit"
  | "connection"
  | "config"
  | "model_output"
  | "no_model"
  | "none";

export type ProviderErrorKind = "auth" | "rate_limit" | "connection" | "config";

export interface PiFailure {
  kind: PiFailureKind;
  summary: string;
}

interface ProviderSignature {
  kind: ProviderErrorKind;
  pattern: RegExp;
  summary: string;
}

// Ordered by specificity: auth (401/403) is checked before the broader
// rate-limit and connection families so a "401 too many keys"-style message is
// still classified as auth.
const PROVIDER_SIGNATURES: ProviderSignature[] = [
  {
    kind: "auth",
    pattern:
      /\b(401|403|unauthorized|forbidden|invalid[_ -]?api[_ -]?key|missing[_ -]?api[_ -]?key|no[_ -]?api[_ -]?key|authentication[_ -]?(failed|error)|invalid[_ -]?credentials)\b/i,
    summary:
      "Provider rejected the request (authentication failed). Verify CHALLENGE_PROVIDER, CHALLENGE_MODEL, and the provider API key environment variable.",
  },
  {
    kind: "rate_limit",
    pattern:
      /\b(429|rate[_ -]?limit(ed|ing)?|ratelimit|too[_ -]?many[_ -]?requests|quota|insufficient[_ -]?quota|billing[_ -]?(hard[_ -]?limit|limit)|credit[_ -]?balance)\b/i,
    summary: "Provider API limit reached (rate limit or quota exceeded).",
  },
  {
    kind: "connection",
    pattern:
      /(econnrefused|enotfound|etimedout|econnreset|eai_again|epipe|socket[_ ]?hang[_ ]?up|network[_ ]?error|fetch[_ ]?failed|could[_ ]?not[_ ]?connect|connection[_ ]?(refused|error|reset|timed[_ ]?out|closed))/i,
    summary: "Could not reach the provider API (connection failure).",
  },
  {
    kind: "config",
    pattern: /\b(unknown|unsupported|unrecognized)[_ ]?(provider|model)\b|--list-models|no such model/i,
    summary:
      "Provider or model is not recognized. Check CHALLENGE_PROVIDER and CHALLENGE_MODEL against the supported provider/model list.",
  },
];

// Returns a fatal provider error if the text matches a known transport/auth
// signature. Called both live (to abort a looping/retrying run early) and after
// the run (to compose a clear summary). Returns null when nothing matches.
export function matchProviderError(
  text: string,
): { kind: ProviderErrorKind; summary: string } | null {
  for (const signature of PROVIDER_SIGNATURES) {
    if (signature.pattern.test(text)) return { kind: signature.kind, summary: signature.summary };
  }
  return null;
}

// `producedProductReport` is true when Pi wrote a compiled product report
// (report.partial.json with a non-failed status) — i.e. the model did produce a
// valid, verifiable Product IR. A clean exit with a product report is a success,
// not a model_output failure, so the diagnosis must not fire for it. It defaults
// to false so an unqualified call still treats a bare clean exit as suspect.
export function classifyPiFailure(stderr: string, exitCode: number, modelCalls: number, producedProductReport = false): PiFailure {
  const provider = matchProviderError(stderr);
  if (provider) return provider;
  if (modelCalls === 0) {
    return {
      kind: "no_model",
      summary:
        "Pi produced no audited model usage; the model never ran. Verify the provider, model, and API key are configured.",
    };
  }
  if (exitCode === 0 && !producedProductReport) {
    return {
      kind: "model_output",
      summary:
        "The model connected but never compiled a valid, verifiable Product IR (no product report was written). The selected model may be too weak or it exhausted its turns before compiling.",
    };
  }
  return { kind: "none", summary: "" };
}
