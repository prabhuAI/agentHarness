import type { NormalizedProductIR } from "../ir/types.js";

export type KnownInteraction = "interactiveGraph" | "audioCapture";

const GRAPH_SIGNAL = /(?=.*\b(?:graph|network|canvas|nodes?)\b)(?=.*\b(?:drag|arrow|edge|connect|relationship|dependenc)\w*\b)/isu;
const AUDIO_SIGNAL = /(?=.*\b(?:audio|microphone|mediarecorder|voice memo)\b)(?=.*\b(?:record|capture|playback|waveform)\w*\b)/isu;
const GRAPH_REQUIREMENT = /\b(?:graph|canvas|node|edge|arrow|dependenc|position|rearrang|side panel|predecessor|successor|starting point|leaves)\w*\b/iu;
const AUDIO_REQUIREMENT = /\b(?:audio|microphone|mediarecorder|record|clip|playback|waveform)\w*\b/iu;

export function knownInteractionFor(ir: NormalizedProductIR): KnownInteraction | undefined {
  const prose = `${ir.product.description} ${ir.customRequirements.join(" ")}`;
  if (GRAPH_SIGNAL.test(prose) && ir.customRequirements.every((requirement) => GRAPH_REQUIREMENT.test(requirement))) return "interactiveGraph";
  if (AUDIO_SIGNAL.test(prose) && ir.customRequirements.every((requirement) => AUDIO_REQUIREMENT.test(requirement))) return "audioCapture";
  return undefined;
}
