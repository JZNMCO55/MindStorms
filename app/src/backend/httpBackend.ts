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

type ChatReq = {
  mode: string;
  cards: unknown[];
  history: { role: string; text: string; cardName?: string }[];
  input: string;
};
export async function chatBackend(req: ChatReq): Promise<{ replies: ChatReply[] }> {
  return isTauri ? invoke("chat", req as Record<string, unknown>) : postJson("/api/chat", req);
}

type SpeakReq = {
  mode: string;
  cards: unknown[];
  speaker: unknown;
  history: { role: string; text: string; cardName?: string }[];
};
// 议会单人发言：让一位「我」接着现场已经说的话往下讲（会接话/反驳）
export async function speakBackend(req: SpeakReq): Promise<{ reply: string }> {
  return isTauri ? invoke("speak", req as Record<string, unknown>) : postJson("/api/speak", req);
}

type BeatReq = {
  mode: string;
  cards: unknown[];
  history: { role: string; text: string; cardName?: string }[];
};
// 导演拍子：现场决定此刻谁开口（或聊透了 end），返回那一句
export async function beatBackend(req: BeatReq): Promise<{ speaker: string; text: string; end: boolean }> {
  return isTauri ? invoke("beat", req as Record<string, unknown>) : postJson("/api/beat", req);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function generateWorldBackend(topic?: string): Promise<any> {
  return isTauri ? invoke("generate_world", { topic }) : postJson("/api/generate-world", { topic });
}

type ConvReq = { cards: unknown[]; history: { role: string; text: string; cardName?: string }[]; topic: string };
export async function convergeBackend(req: ConvReq): Promise<{ crux: string }> {
  return isTauri ? invoke("converge", req as Record<string, unknown>) : postJson("/api/converge", req);
}

export async function loadState(): Promise<{ conversations?: unknown[]; members?: unknown[] } | null> {
  if (isTauri) {
    try {
      return (await invoke("load_state")) as { conversations?: unknown[]; members?: unknown[] } | null;
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
export async function saveState(state: { conversations: unknown[]; members: unknown[] }): Promise<void> {
  try {
    if (isTauri) await invoke("save_state", { state });
    else await postJson("/api/state", state);
  } catch {}
}

export async function articleBackend(req: { topic: string; messages: unknown[] }): Promise<{ article: string }> {
  return isTauri ? invoke("article", req as Record<string, unknown>) : postJson("/api/article", req);
}
export async function saveArticleBackend(req: { title: string; content: string }): Promise<{ path: string }> {
  return isTauri ? invoke("save_article", req as Record<string, unknown>) : postJson("/api/save-article", req);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function refineCardBackend(req: { card: unknown; corrections: string[] }): Promise<any> {
  return isTauri ? invoke("refine_card", req as Record<string, unknown>) : postJson("/api/refine-card", req);
}
