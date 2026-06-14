import { create } from "zustand";
import type { Mode } from "./types/session";
import type { CouncilMember, Conversation, DebateMessage, AvatarKind } from "./types/council";
import { SAMPLE_MEMBERS, SAMPLE_CONVERSATIONS, CANDIDATE_POOL } from "./data/sampleCouncil";
import {
  chatBackend, beatBackend, speakBackend, summonMatchBackend, fetchSelfMirror,
  generateWorldBackend, convergeBackend, loadState, saveState, articleBackend,
  saveArticleBackend, refineCardBackend,
} from "./backend/httpBackend";
import type { Nomination } from "./backend/httpBackend";

export type View = "council" | "corpus";
export type PanelView = "roster" | "detail";
export type LeftTab = "history" | "cards";

// 模型切换：空串＝用各接口默认；其余透传给 claude --model（接受别名 opus/sonnet/haiku）。
export const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "默认" },
  { value: "opus", label: "Opus · 最强" },
  { value: "sonnet", label: "Sonnet · 均衡" },
  { value: "haiku", label: "Haiku · 最快" },
];

const AVATARS: AvatarKind[] = ["crystal", "pyramid", "heart", "hourglass", "orb"];
const MIRROR = SAMPLE_MEMBERS[0]; // 「镜子里的我」

function randomWorldId() {
  const letter = "ABCDEFGHJKLM"[Math.floor(Math.random() * 12)];
  return `${letter}-${Math.floor(Math.random() * 90 + 10)}`;
}
function patchConvo(convos: Conversation[], id: string, msgs: DebateMessage[]) {
  return convos.map((c) => (c.id === id ? { ...c, messages: [...c.messages, ...msgs] } : c));
}
// 历史消息 → 后端要的 role 形状
function toRoleMsg(m: DebateMessage) {
  return { role: m.memberId === "__user__" ? "user" : "card", text: m.text, cardName: m.cardName };
}
// 后端生成的世界 JSON → 一张角色卡（默认是本场「访客」saved:false，需手动「收入卡池」才常驻）
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
    saved: false,
  };
}
// 退化兜底：后端不通时从模板池抓一张没拥有的
function fallbackWorld(owned: Set<string>): CouncilMember {
  const pool = CANDIDATE_POOL.filter((c) => !owned.has(c.nameZh));
  const pick = (pool.length ? pool : CANDIDATE_POOL)[Math.floor(Math.random() * (pool.length || CANDIDATE_POOL.length))];
  const worldId = randomWorldId();
  return { ...pick, id: crypto.randomUUID(), worldId, provenanceLabel: `平行世界 · ${worldId}`, saved: false };
}

interface AppState {
  view: View;
  leftTab: LeftTab;
  members: CouncilMember[];
  conversations: Conversation[];
  activeConversationId: string;
  panelView: PanelView;
  inspectedId: string;
  input: string;
  busy: boolean;
  refiningId: string;
  newConvoOpen: boolean;
  hydrated: boolean;
  articleOpen: boolean;
  articleBusy: boolean;
  articleText: string;
  articleTitle: string;
  model: string;
  // 召唤(检索优先)流程状态
  summonOpen: boolean;
  summonBusy: boolean;
  summonNote: string;
  summonPick: { id: string; name: string; reason: string }[] | null;
  summonProposal: { wish: string; sketch: { nameZh: string; oneLine: string } } | null;
  // 导演提名（待用户同意）
  nomination: Nomination | null;

  setView: (v: View) => void;
  setLeftTab: (t: LeftTab) => void;
  setInput: (s: string) => void;
  setActiveConversation: (id: string) => void;
  openDetail: (memberId: string) => void;
  backToRoster: () => void;
  openNewConvo: () => void;
  closeNewConvo: () => void;
  createConversation: (mode: Mode, memberIds: string[]) => void;
  setModel: (m: string) => void;

  openSummon: () => void;
  closeSummon: () => void;
  summon: (wish: string) => Promise<void>;
  summonExisting: (memberId: string) => Promise<void>;
  pickSummon: (id: string) => Promise<void>;
  confirmProposal: () => Promise<void>;
  cancelSummonStep: () => void;
  acceptNomination: () => Promise<void>;
  dismissNomination: () => void;

  saveCard: (id: string) => void;
  editCard: (id: string, patch: Partial<CouncilMember>) => void;
  removeFromCast: (memberId: string) => void;
  deleteCard: (id: string) => void;
  renameConversation: (id: string, topic: string) => void;
  deleteConversation: (id: string) => void;

  loadMirror: () => Promise<void>;
  hydrate: () => Promise<void>;
  send: (input: string) => Promise<void>;
  converge: () => Promise<void>;
  exportArticle: () => Promise<void>;
  saveArticleDraft: () => Promise<void>;
  closeArticle: () => void;
  addCorrection: (cardId: string, text: string) => Promise<void>;
}

export const useStore = create<AppState>((set, get) => {
  // 让一位「我」对当前现场说一句（新上桌或被点到时用）。带群聊式引用 replyTo。
  const speakOnce = async (member: CouncilMember) => {
    const s = get();
    const conv = s.conversations.find((c) => c.id === s.activeConversationId);
    if (!conv || conv.mode === "mirror") return;
    const cast = s.members.filter((m) => conv.memberIds.includes(m.id));
    const history = conv.messages.map(toRoleMsg);
    const ids = conv.messages.map((m) => m.id);
    set({ busy: true });
    try {
      const r = await speakBackend({ mode: conv.mode, cards: cast, speaker: member, history, model: s.model });
      const replyTo = r.replyTo && ids[r.replyTo - 1] ? ids[r.replyTo - 1] : undefined;
      const msg: DebateMessage = { id: crypto.randomUUID(), memberId: member.id, cardName: member.nameZh, text: r.reply, time: "", replyTo };
      set((st) => ({ conversations: patchConvo(st.conversations, conv.id, [msg]), busy: false }));
    } catch {
      set({ busy: false });
    }
  };

  // 把一个我请上本场阵容（新角色 isNew 时先入 members 为访客），随即让它接话。
  const seatAndSpeak = async (member: CouncilMember, isNew: boolean) => {
    const s = get();
    const conv = s.conversations.find((c) => c.id === s.activeConversationId);
    if (!conv || conv.mode === "mirror") return;
    set((st) => {
      const members = isNew && !st.members.some((m) => m.id === member.id) ? [...st.members, member] : st.members;
      const conversations = st.conversations.map((c) =>
        c.id === conv.id && !c.memberIds.includes(member.id) ? { ...c, memberIds: [...c.memberIds, member.id] } : c,
      );
      return { members, conversations };
    });
    await speakOnce(member);
  };

  return {
    view: "council",
    leftTab: "history",
    members: SAMPLE_MEMBERS,
    conversations: SAMPLE_CONVERSATIONS,
    activeConversationId: SAMPLE_CONVERSATIONS[0].id,
    panelView: "roster",
    inspectedId: "",
    input: "",
    busy: false,
    refiningId: "",
    newConvoOpen: false,
    hydrated: false,
    articleOpen: false,
    articleBusy: false,
    articleText: "",
    articleTitle: "",
    model: "",
    summonOpen: false,
    summonBusy: false,
    summonNote: "",
    summonPick: null,
    summonProposal: null,
    nomination: null,

    setView: (view) => set({ view }),
    setLeftTab: (leftTab) => set({ leftTab }),
    setInput: (input) => set({ input }),
    setActiveConversation: (activeConversationId) => set({ activeConversationId, panelView: "roster" }),
    openDetail: (inspectedId) => set({ inspectedId, panelView: "detail" }),
    backToRoster: () => set({ panelView: "roster" }),
    openNewConvo: () => set({ newConvoOpen: true }),
    closeNewConvo: () => set({ newConvoOpen: false }),
    setModel: (model) => set({ model }),

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
        return { conversations: [convo, ...s.conversations], activeConversationId: id, panelView: "roster", newConvoOpen: false };
      }),

    // ---- 召唤：检索优先 → 复用 or 经同意生成 ----
    openSummon: () => set({ summonOpen: true, summonNote: "", summonPick: null, summonProposal: null }),
    closeSummon: () => set({ summonOpen: false, summonNote: "", summonPick: null, summonProposal: null }),
    cancelSummonStep: () => set({ summonPick: null, summonProposal: null, summonNote: "" }),

    summon: async (wishRaw) => {
      const wish = (wishRaw || "").trim();
      if (!wish) return;
      const s = get();
      const conv = s.conversations.find((c) => c.id === s.activeConversationId);
      if (!conv || conv.mode === "mirror") return;
      set({ summonOpen: true, summonBusy: true, summonNote: "", summonPick: null, summonProposal: null });
      const onTableIds = new Set(conv.memberIds);
      const pool = s.members.filter((m) => m.id !== "mirror" && !onTableIds.has(m.id));
      const onTable = s.members.filter((m) => onTableIds.has(m.id)).map((m) => m.nameZh);
      const topic = conv.topic && conv.topic !== "新对话" ? conv.topic : undefined;
      try {
        const res = await summonMatchBackend({ wish, pool, onTable, topic, model: s.model });
        if (res.kind === "on_table") {
          set({ summonBusy: false, summonNote: `「${res.name || wish}」已经在场了。` });
          return;
        }
        if (res.kind === "match") {
          if (res.candidates.length === 1) {
            const m = get().members.find((x) => x.id === res.candidates[0].id);
            set({ summonBusy: false, summonOpen: false });
            if (m) await seatAndSpeak(m, false);
            return;
          }
          set({ summonBusy: false, summonPick: res.candidates });
          return;
        }
        set({ summonBusy: false, summonProposal: { wish, sketch: res.sketch } });
      } catch {
        // 后端没有匹配能力（如尚未同步的 Tauri）→ 直接走「提案生成」
        set({ summonBusy: false, summonProposal: { wish, sketch: { nameZh: wish, oneLine: "" } } });
      }
    },

    // 召唤面板里直接点一张「未在场的已有卡」请上桌
    summonExisting: async (id) => {
      const m = get().members.find((x) => x.id === id);
      set({ summonOpen: false, summonNote: "", summonPick: null, summonProposal: null });
      if (m) await seatAndSpeak(m, false);
    },

    // 从多个匹配里选一个
    pickSummon: async (id) => {
      const m = get().members.find((x) => x.id === id);
      set({ summonPick: null, summonOpen: false });
      if (m) await seatAndSpeak(m, false);
    },

    // 同意提案 → 真正生成新角色（带 wish 种子）→ 上桌接话
    confirmProposal: async () => {
      const prop = get().summonProposal;
      if (!prop) return;
      const s = get();
      const conv = s.conversations.find((c) => c.id === s.activeConversationId);
      const topic = conv && conv.topic !== "新对话" ? conv.topic : undefined;
      set({ summonBusy: true });
      let member: CouncilMember;
      try {
        member = worldToMember(await generateWorldBackend({ topic, wish: prop.wish, model: s.model }));
      } catch {
        member = fallbackWorld(new Set(get().members.map((m) => m.nameZh)));
      }
      set({ summonBusy: false, summonProposal: null, summonOpen: false });
      await seatAndSpeak(member, true);
    },

    // 导演提名：用户同意后走同一条召唤管线
    acceptNomination: async () => {
      const n = get().nomination;
      set({ nomination: null });
      if (n) await get().summon(n.wish);
    },
    dismissNomination: () => set({ nomination: null }),

    // ---- 角色卡 CRUD ----
    saveCard: (id) => set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, saved: true } : m)) })),
    editCard: (id, patch) => set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, ...patch, id } : m)) })),
    removeFromCast: (memberId) =>
      set((s) => {
        const conv = s.conversations.find((c) => c.id === s.activeConversationId);
        if (!conv) return {};
        const conversations = s.conversations.map((c) =>
          c.id === conv.id ? { ...c, memberIds: c.memberIds.filter((x) => x !== memberId) } : c,
        );
        // 未入库的访客若不再被任何对话引用 → 顺手清掉，避免孤儿堆积
        const member = s.members.find((m) => m.id === memberId);
        let members = s.members;
        if (member && !member.saved && !conversations.some((c) => c.memberIds.includes(memberId))) {
          members = s.members.filter((m) => m.id !== memberId);
        }
        return { conversations, members, panelView: "roster" };
      }),
    deleteCard: (id) =>
      set((s) => {
        if (id === "mirror") return {}; // 镜子不可删
        return {
          members: s.members.filter((m) => m.id !== id),
          conversations: s.conversations.map((c) => ({ ...c, memberIds: c.memberIds.filter((x) => x !== id) })),
          panelView: s.inspectedId === id ? "roster" : s.panelView,
        };
      }),

    // ---- 历史对话 CRUD ----
    renameConversation: (id, topic) => {
      const t = topic.trim();
      if (!t) return;
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, topic: t } : c)) }));
    },
    deleteConversation: (id) =>
      set((s) => {
        const conversations = s.conversations.filter((c) => c.id !== id);
        const activeConversationId = s.activeConversationId === id ? conversations[0]?.id ?? "" : s.activeConversationId;
        return { conversations, activeConversationId, panelView: "roster" };
      }),

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

    // 从盘加载持久化状态；没有就用样例。确保「镜子里的我」始终在、且历史卡补上 saved 标记。
    hydrate: async () => {
      const saved = await loadState();
      if (saved && Array.isArray(saved.members) && saved.members.length) {
        let members = saved.members as CouncilMember[];
        members = members.map((m) => (m.saved === undefined ? { ...m, saved: true } : m));
        if (!members.some((m) => m.id === "mirror")) members = [MIRROR, ...members];
        const conversations =
          Array.isArray(saved.conversations) && saved.conversations.length
            ? (saved.conversations as Conversation[])
            : SAMPLE_CONVERSATIONS;
        set({
          members,
          conversations,
          activeConversationId: conversations[0].id,
          model: typeof saved.model === "string" ? saved.model : "",
          hydrated: true,
        });
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
      // 首条发言顺手给对话起个标题，让「本场召唤的角色」有真话题可贴。
      set((st) => ({
        conversations: st.conversations.map((c) =>
          c.id === conv.id ? { ...c, topic: c.topic === "新对话" ? text.slice(0, 18) : c.topic, messages: [...c.messages, userMsg] } : c,
        ),
        busy: true,
      }));

      try {
        if (conv.mode === "mirror") {
          const { replies } = await chatBackend({ mode: conv.mode, cards: [], history: conv.messages.map(toRoleMsg), input: text, model: s.model });
          const msgs: DebateMessage[] = replies.map((r) => ({ id: crypto.randomUUID(), memberId: "mirror", cardName: r.cardName, text: r.text, time: "" }));
          set((st) => ({ conversations: patchConvo(st.conversations, conv.id, msgs), busy: false }));
          return;
        }
        // 议会：导演调度·涌现式——逐拍让"此刻最想插话的那个我"开口；引用/提名都从拍子里来。
        const cast = s.members.filter((m) => conv.memberIds.includes(m.id));
        const transcript: { role: string; text: string; cardName?: string }[] = [...conv.messages.map(toRoleMsg), { role: "user", text }];
        const transcriptIds: string[] = [...conv.messages.map((m) => m.id), userMsg.id];
        const maxBeats = Math.min(6, cast.length * 2);
        let nominated: Nomination | null = null;
        for (let beat = 0; beat < maxBeats; beat++) {
          const r = await beatBackend({ mode: conv.mode, cards: cast, history: transcript, model: s.model });
          if (r && r.speaker && r.text) {
            const speaker =
              cast.find((c) => c.nameZh === r.speaker) ??
              cast.find((c) => r.speaker.includes(c.nameZh) || c.nameZh.includes(r.speaker)) ??
              cast[0];
            const replyTo = r.replyTo && transcriptIds[r.replyTo - 1] ? transcriptIds[r.replyTo - 1] : undefined;
            const msgId = crypto.randomUUID();
            const msg: DebateMessage = { id: msgId, memberId: speaker.id, cardName: speaker.nameZh, text: r.text, time: "", replyTo };
            set((st) => ({ conversations: patchConvo(st.conversations, conv.id, [msg]) }));
            transcript.push({ role: "card", text: r.text, cardName: speaker.nameZh });
            transcriptIds.push(msgId);
          }
          if (r && r.nominate) nominated = r.nominate;
          if (!r || r.end || !r.text) break;
          await new Promise((res) => setTimeout(res, 300));
        }
        set((st) => ({
          conversations: st.conversations.map((c) => (c.id === conv.id ? { ...c, round: Math.min(c.totalRounds, c.round + 1) } : c)),
          busy: false,
          nomination: nominated ?? st.nomination,
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
        const { crux } = await convergeBackend({ cards: cast, history, topic: conv.topic, model: s.model });
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
        const { article } = await articleBackend({ topic: conv.topic, messages: conv.messages, model: s.model });
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
        const refined = await refineCardBackend({ card: { ...card, corrections }, corrections, model: s.model });
        set((st) => ({ members: st.members.map((m) => (m.id === cardId ? { ...m, ...refined, id: cardId, corrections, saved: m.saved } : m)), refiningId: "" }));
      } catch {
        set({ refiningId: "" });
      }
    },
  };
});

// ---- 自动持久化：hydrate 之后，conversations/members/model 一变就防抖存盘 ----
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((state, prev) => {
  if (!state.hydrated) return;
  if (state.conversations === prev.conversations && state.members === prev.members && state.model === prev.model) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const st = useStore.getState();
    void saveState({ conversations: st.conversations, members: st.members, model: st.model });
  }, 700);
});
