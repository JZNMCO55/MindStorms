// 双模后端：
//  - Tauri 里走 invoke（Rust 命令，spawn claude，单原生 exe）
//  - 浏览器 dev 里走 fetch（app/server/server.mjs）
// 两边接口形状一致；切换只看是不是在 Tauri 里。
import { invoke } from "@tauri-apps/api/core";

const BASE = "http://127.0.0.1:8787";
const isTauri =
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window || "isTauri" in window);

async function postJson(path: string, body: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(path + " " + r.status);
  return r.json();
}

export interface ChatReply {
  cardName: string;
  text: string;
}

export interface Nomination {
  wish: string;
  reason: string;
}

type ChatReq = {
  mode: string;
  cards: unknown[];
  history: { role: string; text: string; cardName?: string }[];
  input: string;
  model?: string;
};
export async function chatBackend(req: ChatReq): Promise<{ replies: ChatReply[] }> {
  return isTauri ? invoke("chat", req as Record<string, unknown>) : postJson("/api/chat", req);
}

type SpeakReq = {
  mode: string;
  cards: unknown[];
  speaker: unknown;
  history: { role: string; text: string; cardName?: string }[];
  model?: string;
};
// 议会单人发言：让一位「我」接着现场已经说的话往下讲（会接话/反驳）。
// replyTo＝它在回应的那条消息的 1-based 编号（群聊式引用）；Tauri 旧后端可能不返回，按缺省处理。
export async function speakBackend(req: SpeakReq): Promise<{ reply: string; replyTo?: number | null }> {
  return isTauri ? invoke("speak", req as Record<string, unknown>) : postJson("/api/speak", req);
}

type BeatReq = {
  mode: string;
  cards: unknown[];
  history: { role: string; text: string; cardName?: string }[];
  model?: string;
};
// 导演拍子：现场决定此刻谁开口（或聊透了 end），返回那一句；可能附带引用 replyTo 与提名 nominate。
export async function beatBackend(
  req: BeatReq,
): Promise<{ speaker: string; text: string; end: boolean; replyTo?: number | null; nominate?: Nomination | null }> {
  return isTauri ? invoke("beat", req as Record<string, unknown>) : postJson("/api/beat", req);
}

export type SummonResult =
  | { kind: "on_table"; name: string }
  | { kind: "match"; candidates: { id: string; name: string; reason: string }[] }
  | { kind: "propose"; sketch: { nameZh: string; oneLine: string } };

type SummonReq = {
  wish: string;
  pool: unknown[];
  onTable: string[];
  topic?: string;
  model?: string;
};
// 检索优先的召唤：先在池里找，找不到才提案现造。Tauri 旧后端没有此命令 → 抛错，由 store 兜底为 propose。
export async function summonMatchBackend(req: SummonReq): Promise<SummonResult> {
  return isTauri ? invoke("summon_match", req as Record<string, unknown>) : postJson("/api/summon-match", req);
}

export async function fetchSelfMirror(): Promise<Record<string, unknown> | null> {
  if (isTauri) {
    try {
      return (await invoke("load_self_mirror")) as Record<string, unknown> | null;
    } catch {
      return null;
    }
  }
  try {
    const r = await fetch(`${BASE}/api/self_mirror`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// wish＝召唤意图种子（用户描述或导演提名）；topic＝当前话题做底色。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateWorldBackend(req: { topic?: string; wish?: string; model?: string } = {}): Promise<any> {
  return isTauri ? invoke("generate_world", req as Record<string, unknown>) : postJson("/api/generate-world", req);
}

type ConvReq = { cards: unknown[]; history: { role: string; text: string; cardName?: string }[]; topic: string; model?: string };
export async function convergeBackend(req: ConvReq): Promise<{ crux: string }> {
  return isTauri ? invoke("converge", req as Record<string, unknown>) : postJson("/api/converge", req);
}

export async function loadState(): Promise<{ conversations?: unknown[]; members?: unknown[]; model?: string } | null> {
  if (isTauri) {
    try {
      return (await invoke("load_state")) as { conversations?: unknown[]; members?: unknown[]; model?: string } | null;
    } catch {
      return null;
    }
  }
  try {
    const r = await fetch(`${BASE}/api/state`);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
export async function saveState(state: { conversations: unknown[]; members: unknown[]; model?: string }): Promise<void> {
  try {
    if (isTauri) await invoke("save_state", { state });
    else await postJson("/api/state", state);
  } catch {}
}

export async function articleBackend(req: { topic: string; messages: unknown[]; model?: string }): Promise<{ article: string }> {
  return isTauri ? invoke("article", req as Record<string, unknown>) : postJson("/api/article", req);
}
export async function saveArticleBackend(req: { title: string; content: string }): Promise<{ path: string }> {
  return isTauri ? invoke("save_article", req as Record<string, unknown>) : postJson("/api/save-article", req);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refineCardBackend(req: { card: unknown; corrections: string[]; model?: string }): Promise<any> {
  return isTauri ? invoke("refine_card", req as Record<string, unknown>) : postJson("/api/refine-card", req);
}

// ---- 模型设置：provider / 鉴权 / key / baseUrl / 默认模型 ----
export type Provider = "claude" | "openai" | "deepseek" | "glm" | "kimi" | "custom";
export interface LLMSettings {
  provider: Provider;
  auth: "subscription" | "apikey"; // 仅 claude 有意义；其它家恒为 apikey
  apiKey: string;
  oauthToken: string; // 可选：claude 订阅模式注入 CLAUDE_CODE_OAUTH_TOKEN
  baseUrl: string; // OpenAI 兼容家的接入点（留空用默认）
  model: string; // 默认模型 id（留空用各家默认）
}

export async function loadSettings(): Promise<Partial<LLMSettings>> {
  if (isTauri) {
    try { return (await invoke("load_settings")) as Partial<LLMSettings>; } catch { return {}; }
  }
  try {
    const r = await fetch(`${BASE}/api/settings`);
    if (!r.ok) return {};
    return await r.json();
  } catch {
    return {};
  }
}
export async function saveSettings(s: Partial<LLMSettings>): Promise<void> {
  try {
    if (isTauri) await invoke("save_settings", { settings: s });
    else await postJson("/api/settings", s);
  } catch {}
}
