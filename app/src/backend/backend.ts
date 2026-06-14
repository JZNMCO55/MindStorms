import type { Card } from "../types/card";
import type { ChatMessage, Mode } from "../types/session";

export interface ImportResult {
  cleanedCount: number;
  chars: number;
}

export interface ChatRequest {
  mode: Mode;
  cardIds: string[];
  history: ChatMessage[];
  input: string;
}

/**
 * The boundary between UI and platform.
 *
 * The web/dev build uses an in-memory mock. The Tauri build will implement this
 * over `invoke`, keeping raw corpus and the Claude API key on the Rust side —
 * raw text never leaves the machine; only abstracted card profiles + the current
 * question go to Claude. See docs/CONCEPT.md §9.
 */
export interface Backend {
  listCards(): Promise<Card[]>;
  importCorpus(files: { name: string; html: string }[]): Promise<ImportResult>;
  /** v0 核心:从语料蒸出一张 self_mirror 卡。 */
  distillSelfMirror(): Promise<Card>;
  chat(req: ChatRequest): Promise<ChatMessage[]>;
}
