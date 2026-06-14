import { create } from "zustand";
import type { Mode } from "./types/session";
import type { CouncilMember, Conversation, DebateMessage, AvatarKind } from "./types/council";
import { SAMPLE_MEMBERS, SAMPLE_CONVERSATIONS, CANDIDATE_POOL } from "./data/sampleCouncil";
import {
  chatBackend, beatBackend, fetchSelfMirror, generateWorldBackend, convergeBackend,
  loadState, saveState, articleBackend, saveArticleBackend, refineCardBackend,
} from "./backend/httpBackend";

export type View = "council" | "corpus";
export type PanelView = "roster" | "detail" | "candidate";
export type LeftTab = "history" | "cards";

const AVATARS: AvatarKind[] = ["crystal", "pyramid", "heart", "hourglass", "orb"];
const MIRROR = SAMPLE_MEMBERS[0]; // 「镜子里的我」

function randomWorldId() {
  const letter = "ABCDEFGHJKLM"[Math.floor(Math.random() * 12)];
  return `${letter}-${Math.floor(Math.random() * 90 + 10)}`;
}
function patchConvo(convos: Conversation[], id: string, msgs: DebateMessage[]) {
  return convos.map((c) => (c.id === id ? { ...c, messages: [...c.messages, ...msgs] } : c));
}
// 后端生成的世界 JSON → 一张角色卡
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function worldToMember(w: any): CouncilMember {
  const worldId = String(w.worldId || randomWorldId());
  return {
    id: crypto.randomUUID(),
    worldId,
    nameEn: String(w.nameEn || "A World"),
    nameZh: String(w.nameZh || "另一个我"),
    source: "self_parallel",
    accent: /^#[0-9a-fA-F]{6}$/.test(String(w.accent)) ? String(w.accent) : "#6aa8ff",
    avatar: AVATARS.includes(w.avatar) ? w.avatar : "orb",
    backstory: String(w.backstory || ""),
    resonance: typeof w.resonance === "number" ? w.resonance : 65,
    utilityTitle: String(w.utilityTitle || ""),
    utilityDesc: String(w.utilityDesc || ""),
    timeHorizon: String(w.timeHorizon || ""),
    timeHorizonDesc: String(w.timeHorizonDesc || ""),
    catchphrase: String(w.catchphrase || ""),
    voiceTags: Array.isArray(w.voiceTags) ? w.voiceTags.map(String) : [],
    provenanceLabel: `平行世界 · ${worldId}`,
  };
}
// 退化兜底：后端不通时从模板池抓一张没拥有的
function fallbackWorld(owned: Set<string>): CouncilMember {
  const pool = CANDIDATE_POOL.filter((c) => !owned.has(c.nameZh));
  const pick = (pool.length ? pool : CANDIDATE_POOL)[Math.floor(Math.random() * (pool.length || CANDIDATE_POOL.length))];
  const worldId = randomWorldId();
  return { ...pick, id: crypto.randomUUID(), worldId, provenanceLabel: `平行世界 · ${worldId}` };
}

interface AppState {
  view: View;
  leftTab: LeftTab;
  members: CouncilMember[];
  conversations: Conversation[];
  activeConversationId: string;
  panelView: PanelView;
  inspectedId: string;
  candidate: CouncilMember | null;
  input: string;
  busy: boolean;
  generating: boolean;
  refiningId: string;
  newConvoOpen: boolean;
  hydrated: boolean;
  articleOpen: boolean;
  articleBusy: boolean;
  articleText: string;
  articleTitle: string;

  setView: (v: View) => void;
  setLeftTab: (t: LeftTab) => void;
  setInput: (s: string) => void;
  setActiveConversation: (id: string) => void;
  openDetail: (memberId: string) => void;
  backToRoster: () => void;
  openNewConvo: () => void;
  closeNewConvo: () => void;
  createConversation: (mode: Mode, memberIds: string[]) => void;
  generateWorld: () => Promise<void>;
  summonWorld: () => Promise<string | null>;
  addCandidate: () => void;
  discardCandidate: () => void;
  deleteCard: (id: string) => void;
  loadMirror: () => Promise<void>;
  hydrate: () => Promise<void>;
  send: (input: string) => Promise<void>;
  converge: () => Promise<void>;
  exportArticle: () => Promise<void>;
  saveArticleDraft: () => Promise<void>;
  closeArticle: () => void;
  addCorrection: (cardId: string, text: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  view: "council",
  leftTab: "history",
  members: SAMPLE_MEMBERS,
  conversations: SAMPLE_CONVERSATIONS,
  activeConversationId: SAMPLE_CONVERSATIONS[0].id,
  panelView: "roster",
  inspectedId: "",
  candidate: null,
  input: "",
  busy: false,
  generating: false,
  refiningId: "",
  newConvoOpen: false,
  hydrated: false,
  articleOpen: false,
  articleBusy: false,
  articleText: "",
  articleTitle: "",

  setView: (view) => set({ view }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setInput: (input) => set({ input }),
  setActiveConversation: (activeConversationId) =>
    set({ activeConversationId, panelView: "roster", candidate: null }),
  openDetail: (inspectedId) => set({ inspectedId, panelView: "detail" }),
  backToRoster: () => set({ panelView: "roster", candidate: null }),
  openNewConvo: () => set({ newConvoOpen: true }),
  closeNewConvo: () => set({ newConvoOpen: false }),

  createConversation: (mode, memberIds) =>
    set((s) => {
      const id = crypto.randomUUID();
      const convo: Conversation = {
        id,
        topic: mode === "mirror" ? "和镜子里的我聊聊" : "新对话",
        date: "刚刚",
        mode,
        round: 0,
        totalRounds: mode === "mirror" ? 1 : 4,
        speakingId: mode === "mirror" ? "mirror" : undefined,
        memberIds: mode === "mirror" ? ["mirror"] : memberIds,
        messages: [],
      };
      return { conversations: [convo, ...s.conversations], activeConversationId: id, panelView: "roster", candidate: null, newConvoOpen: false };
    }),

  generateWorld: async () => {
    if (get().generating) return;
    set({ generating: true, leftTab: "cards" });
    const topic = get().conversations.find((c) => c.id === get().activeConversationId)?.topic;
    try {
      const w = await generateWorldBackend(topic && topic !== "新对话" ? topic : undefined);
      set({ candidate: worldToMember(w), panelView: "candidate", generating: false });
    } catch {
      set({ candidate: fallbackWorld(new Set(get().members.map((m) => m.nameZh))), panelView: "candidate", generating: false });
    }
  },

  // 在新建对话弹窗里现场召唤一个新世界：生成 → 直接进卡库 → 返回 id 供勾选
  summonWorld: async () => {
    if (get().generating) return null;
    set({ generating: true });
    let member: CouncilMember;
    try {
      member = worldToMember(await generateWorldBackend(undefined));
    } catch {
      member = fallbackWorld(new Set(get().members.map((m) => m.nameZh)));
    }
    set((s) => ({ members: [...s.members, member], generating: false }));
    return member.id;
  },

  addCandidate: () =>
    set((s) => (s.candidate ? { members: [...s.members, s.candidate], inspectedId: s.candidate.id, panelView: "detail", candidate: null } : {})),
  discardCandidate: () => set({ candidate: null, panelView: "roster" }),
  deleteCard: (id) =>
    set((s) => ({ members: s.members.filter((m) => m.id !== id), panelView: s.inspectedId === id ? "roster" : s.panelView })),

  loadMirror: async () => {
    const m = await fetchSelfMirror();
    if (!m) return;
    set((s) => ({
      members: s.members.map((c) =>
        c.id === "mirror"
          ? {
              ...c,
              backstory: String(m.summary || c.backstory),
              utilityDesc: String(m.utility || c.utilityDesc),
              catchphrase: Array.isArray(m.catchphrases) && m.catchphrases[0] ? String(m.catchphrases[0]) : c.catchphrase,
            }
          : c,
      ),
    }));
  },

  // 从盘加载持久化状态；没有就用样例。确保「镜子里的我」始终在。
  hydrate: async () => {
    const saved = await loadState();
    if (saved && Array.isArray(saved.members) && saved.members.length) {
      let members = saved.members as CouncilMember[];
      if (!members.some((m) => m.id === "mirror")) members = [MIRROR, ...members];
      const conversations =
        Array.isArray(saved.conversations) && saved.conversations.length
          ? (saved.conversations as Conversation[])
          : SAMPLE_CONVERSATIONS;
      set({ members, conversations, activeConversationId: conversations[0].id, hydrated: true });
    } else {
      set({ hydrated: true });
    }
  },

  send: async (input) => {
    const s = get();
    const text = input.trim();
    if (!text || s.busy) return;
    const conv = s.conversations.find((c) => c.id === s.activeConversationId);
    if (!conv) return;
    const userMsg: DebateMessage = { id: crypto.randomUUID(), memberId: "__user__", text, time: "" };
    set((st) => ({ conversations: patchConvo(st.conversations, conv.id, [userMsg]), busy: true }));

    const toRole = (m: DebateMessage) => ({
      role: m.memberId === "__user__" ? "user" : "card",
      text: m.text,
      cardName: m.cardName,
    });
    try {
      if (conv.mode === "mirror") {
        const { replies } = await chatBackend({ mode: conv.mode, cards: [], history: conv.messages.map(toRole), input: text });
        const msgs: DebateMessage[] = replies.map((r) => ({ id: crypto.randomUUID(), memberId: "mirror", cardName: r.cardName, text: r.text, time: "" }));
        set((st) => ({ conversations: patchConvo(st.conversations, conv.id, msgs), busy: false }));
        return;
      }
      // 议会：导演调度·涌现式——逐拍让"此刻最想插话的那个我"开口；
      // 谁沉默、谁被戳到再开口、何时收，都由现场决定，不再固定顺序/人人一次。
      const cast = s.members.filter((m) => conv.memberIds.includes(m.id));
      const transcript: { role: string; text: string; cardName?: string }[] = [
        ...conv.messages.map(toRole),
        { role: "user", text },
      ];
      const maxBeats = Math.min(6, cast.length * 2);
      for (let beat = 0; beat < maxBeats; beat++) {
        const r = await beatBackend({ mode: conv.mode, cards: cast, history: transcript });
        if (r && r.speaker && r.text) {
          const speaker =
            cast.find((c) => c.nameZh === r.speaker) ??
            cast.find((c) => r.speaker.includes(c.nameZh) || c.nameZh.includes(r.speaker)) ??
            cast[0];
          const msg: DebateMessage = { id: crypto.randomUUID(), memberId: speaker.id, cardName: speaker.nameZh, text: r.text, time: "" };
          set((st) => ({ conversations: patchConvo(st.conversations, conv.id, [msg]) }));
          transcript.push({ role: "card", text: r.text, cardName: speaker.nameZh });
        }
        if (!r || r.end || !r.text) break;
        await new Promise((res) => setTimeout(res, 300));
      }
      set((st) => ({
        conversations: st.conversations.map((c) =>
          c.id === conv.id ? { ...c, round: Math.min(c.totalRounds, c.round + 1) } : c,
        ),
        busy: false,
      }));
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const err: DebateMessage = { id: crypto.randomUUID(), memberId: "__sys__", text: `（没接通：${detail}。原生版需本机装好并登录 Claude Code；浏览器 dev 版需先跑 node app/server/server.mjs）`, time: "" };
      set((st) => ({ conversations: patchConvo(st.conversations, conv.id, [err]), busy: false }));
    }
  },

  converge: async () => {
    const s = get();
    if (s.busy) return;
    const conv = s.conversations.find((c) => c.id === s.activeConversationId);
    if (!conv || conv.messages.length === 0) return;
    set({ busy: true });
    try {
      const cast = s.members.filter((m) => conv.memberIds.includes(m.id));
      const history = conv.messages.map((m) => ({ role: m.memberId === "__user__" ? "user" : "card", text: m.text, cardName: m.cardName }));
      const { crux } = await convergeBackend({ cards: cast, history, topic: conv.topic });
      const msg: DebateMessage = { id: crypto.randomUUID(), memberId: "__crux__", text: crux, time: "" };
      set((st) => ({ conversations: patchConvo(st.conversations, conv.id, [msg]), busy: false }));
    } catch {
      set({ busy: false });
    }
  },

  // 公众号飞轮：把会谈综合成主宇宙口吻的文章
  exportArticle: async () => {
    const s = get();
    const conv = s.conversations.find((c) => c.id === s.activeConversationId);
    if (!conv || conv.messages.length === 0) return;
    set({ articleOpen: true, articleBusy: true, articleText: "", articleTitle: conv.topic });
    try {
      const { article } = await articleBackend({ topic: conv.topic, messages: conv.messages });
      set({ articleText: article, articleBusy: false });
    } catch {
      set({ articleText: "（生成失败——确认后端在跑）", articleBusy: false });
    }
  },
  saveArticleDraft: async () => {
    const s = get();
    if (!s.articleText) return;
    try { await saveArticleBackend({ title: s.articleTitle, content: s.articleText }); } catch {}
  },
  closeArticle: () => set({ articleOpen: false }),

  // 纠错回路：标"这不是我"→ 精修这张卡
  addCorrection: async (cardId, text) => {
    const s = get();
    const card = s.members.find((m) => m.id === cardId);
    if (!card || !text.trim()) return;
    const corrections = [...(card.corrections || []), text.trim()];
    set((st) => ({ members: st.members.map((m) => (m.id === cardId ? { ...m, corrections } : m)), refiningId: cardId }));
    try {
      const refined = await refineCardBackend({ card: { ...card, corrections }, corrections });
      set((st) => ({ members: st.members.map((m) => (m.id === cardId ? { ...m, ...refined, id: cardId, corrections } : m)), refiningId: "" }));
    } catch {
      set({ refiningId: "" });
    }
  },
}));

// ---- 自动持久化：hydrate 之后，conversations/members 一变就防抖存盘 ----
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((state, prev) => {
  if (!state.hydrated) return;
  if (state.conversations === prev.conversations && state.members === prev.members) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const st = useStore.getState();
    void saveState({ conversations: st.conversations, members: st.members });
  }, 700);
});
