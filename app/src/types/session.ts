export type Mode = "decision" | "exploration" | "mirror";

export const MODE_LABELS: Record<Mode, string> = {
  decision: "决策",
  exploration: "探索",
  mirror: "镜子",
};

export interface ChatMessage {
  id: string;
  role: "user" | "card" | "system";
  cardId?: string;
  cardName?: string;
  text: string;
}
