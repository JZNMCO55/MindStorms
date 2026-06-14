import type { Backend, ChatRequest, ImportResult } from "./backend";
import type { Card } from "../types/card";
import type { ChatMessage } from "../types/session";

// Placeholder until the real distillation + Claude wiring lands on the Rust side.
const sampleMirror: Card = {
  id: "mirror-sample",
  name: "镜子里的我",
  source: "self_mirror",
  fidelity: "high",
  competence: ["自我觉察", "把问题递回给你"],
  utility: "不给答案,引导你说出自己已知却回避的东西",
  voice: "温和、爱用反问、像在跟自己说话",
  grounding: [],
  provenanceLabel: "蒸馏自你(占位样例,待真实语料替换)",
  publishPolicy: "freely",
};

const cards: Card[] = [sampleMirror];

function msg(role: ChatMessage["role"], text: string, card?: Card): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    cardId: card?.id,
    cardName: card?.name,
  };
}

export const mockBackend: Backend = {
  async listCards() {
    return cards;
  },

  async importCorpus(files): Promise<ImportResult> {
    const chars = files.reduce((n, f) => n + f.html.length, 0);
    return { cleanedCount: files.length, chars };
  },

  async distillSelfMirror() {
    return sampleMirror;
  },

  async chat(req: ChatRequest) {
    const active = cards.filter((c) => req.cardIds.includes(c.id));
    if (req.mode === "mirror") {
      const c = active[0] ?? sampleMirror;
      return [msg("card", `(占位)你说"${req.input}"——那在你心里,最不愿承认的那一面是什么?`, c)];
    }
    if (active.length === 0) {
      return [msg("system", "(占位)还没点将,先在左边选几张卡上场。")];
    }
    return active.map((c) => msg("card", `(占位)${c.name} 对"${req.input}"的看法……`, c));
  },
};
