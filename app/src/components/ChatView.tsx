import { useState } from "react";
import type { CSSProperties } from "react";
import { useStore, MODEL_OPTIONS } from "../store";
import Avatar from "./Avatar";
import { MODE_LABELS } from "../types/session";

export default function ChatView() {
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const members = useStore((s) => s.members);
  const input = useStore((s) => s.input);
  const setInput = useStore((s) => s.setInput);
  const send = useStore((s) => s.send);
  const busy = useStore((s) => s.busy);
  const openDetail = useStore((s) => s.openDetail);
  const converge = useStore((s) => s.converge);
  const exportArticle = useStore((s) => s.exportArticle);
  const model = useStore((s) => s.model);
  const setModel = useStore((s) => s.setModel);
  // 召唤
  const summonOpen = useStore((s) => s.summonOpen);
  const openSummon = useStore((s) => s.openSummon);
  const closeSummon = useStore((s) => s.closeSummon);
  const summon = useStore((s) => s.summon);
  const summonBusy = useStore((s) => s.summonBusy);
  const summonNote = useStore((s) => s.summonNote);
  const summonPick = useStore((s) => s.summonPick);
  const summonProposal = useStore((s) => s.summonProposal);
  const pickSummon = useStore((s) => s.pickSummon);
  const confirmProposal = useStore((s) => s.confirmProposal);
  const cancelSummonStep = useStore((s) => s.cancelSummonStep);
  const summonExisting = useStore((s) => s.summonExisting);
  // 提名
  const nomination = useStore((s) => s.nomination);
  const acceptNomination = useStore((s) => s.acceptNomination);
  const dismissNomination = useStore((s) => s.dismissNomination);

  const [wish, setWish] = useState("");

  const conv = conversations.find((c) => c.id === activeId);
  if (!conv) {
    return (
      <div className="debate">
        <div className="empty-convo">还没有对话。点左侧「＋ 新建对话」开始。</div>
      </div>
    );
  }
  const byId = (id: string) => members.find((m) => m.id === id) ?? members[0];
  const quoted = (id?: string) => (id ? conv.messages.find((mm) => mm.id === id) : undefined);
  const isMirror = conv.mode === "mirror";
  const offTable = members.filter((m) => m.id !== "mirror" && m.saved && !conv.memberIds.includes(m.id));

  const submit = async () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    await send(t);
  };
  const doSummon = async () => {
    const w = wish.trim();
    if (!w) return;
    setWish("");
    await summon(w);
  };

  return (
    <div className="debate">
      <header className="debate-head">
        <div className={"type-tag " + conv.mode}>{MODE_LABELS[conv.mode]}模式</div>
        <div className="round">
          <div className="round-dots">
            {Array.from({ length: conv.totalRounds }).map((_, i) => (
              <i key={i} className={i < conv.round ? "on" : ""} />
            ))}
          </div>
        </div>
        <label className="model-select" title="切换模型">
          <span className="model-spark">✦</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
      </header>

      <div className="topic">
        <h1 className="topic-title">{conv.topic}</h1>
      </div>

      <div className="messages">
        {conv.messages.length === 0 && (
          <div className="hint">
            {isMirror
              ? "说说你最近在纠结什么——镜子里的我会追问你。"
              : conv.memberIds.length === 0
              ? "本场还没有角色——在下方点 ✦ 召唤一个和这次话题相关的「我」，再抛出问题。"
              : "抛出一个问题，召集的“我”们就会开口。"}
          </div>
        )}
        {conv.messages.map((msg) => {
          if (msg.memberId === "__user__") {
            return (
              <div key={msg.id} className="msg user">
                <div className="bubble user"><p>{msg.text}</p></div>
              </div>
            );
          }
          if (msg.memberId === "__sys__") {
            return (
              <div key={msg.id} className="msg sys">
                <div className="sysbubble">{msg.text}</div>
              </div>
            );
          }
          if (msg.memberId === "__crux__") {
            return (
              <div key={msg.id} className="crux">
                <div className="crux-label">主宇宙的我 · 收敛</div>
                <p>{msg.text}</p>
              </div>
            );
          }
          const m = byId(msg.memberId);
          const q = quoted(msg.replyTo);
          return (
            <div key={msg.id} className="msg" style={{ "--accent": m.accent } as CSSProperties}>
              <button className="msg-avatar" onClick={() => openDetail(m.id)} title="查看角色">
                <Avatar type={m.avatar} accent={m.accent} size={46} />
              </button>
              <div className="msg-body">
                <div className="msg-name">{msg.cardName || m.nameZh}</div>
                {q && (
                  <div className="quote-ref">
                    <span className="quote-who">{q.memberId === "__user__" ? "我" : q.cardName || byId(q.memberId).nameZh}</span>
                    <span className="quote-text">{q.text.length > 28 ? q.text.slice(0, 28) + "…" : q.text}</span>
                  </div>
                )}
                <div className="bubble"><p>{msg.text}</p></div>
              </div>
            </div>
          );
        })}
        {busy && <div className="msg thinking"><span /><span /><span /></div>}

        {!busy && nomination && (
          <div className="nominate-chip">
            <div className="nom-text">
              ▸ 议会想请「<b>{nomination.wish}</b>」上桌
              {nomination.reason && <span className="nom-reason">{nomination.reason}</span>}
            </div>
            <div className="nom-actions">
              <button onClick={() => void acceptNomination()}>上桌</button>
              <button className="ghost" onClick={dismissNomination}>不用</button>
            </div>
          </div>
        )}

        {!busy && conv.messages.some((mm) => !["__user__", "__sys__"].includes(mm.memberId)) && (
          <div className="chat-actions">
            {!isMirror && <button className="converge-btn" onClick={() => converge()}>✦ 让主宇宙的我收敛</button>}
            <button className="converge-btn ghost" onClick={() => exportArticle()}>✎ 导出文章</button>
          </div>
        )}
      </div>

      {!isMirror && summonOpen && (
        <div className="summon-pop">
          <div className="summon-head">
            <span>召唤一个我</span>
            <button className="summon-x" onClick={closeSummon}>×</button>
          </div>
          {summonBusy ? (
            <div className="summon-busy">正在从你的角色池里找…</div>
          ) : summonNote ? (
            <div className="summon-note">{summonNote}<button className="link" onClick={cancelSummonStep}>重新描述</button></div>
          ) : summonPick ? (
            <div className="summon-pick">
              <div className="summon-sub">找到几个像的，请谁上桌：</div>
              {summonPick.map((c) => (
                <button key={c.id} className="pick-row" onClick={() => void pickSummon(c.id)}>
                  <b>{c.name}</b>
                  {c.reason && <span>{c.reason}</span>}
                </button>
              ))}
              <button className="link" onClick={cancelSummonStep}>都不太像 → 重新描述</button>
            </div>
          ) : summonProposal ? (
            <div className="summon-propose">
              <div className="summon-sub">池里没有现成的，要不要现造一个：</div>
              <div className="sketch">
                <b>{summonProposal.sketch.nameZh}</b>
                {summonProposal.sketch.oneLine && <p>{summonProposal.sketch.oneLine}</p>}
              </div>
              <div className="cand-actions">
                <button className="btn-ghost" onClick={cancelSummonStep}>再想想</button>
                <button className="btn-primary" onClick={() => void confirmProposal()}>生成并上桌</button>
              </div>
            </div>
          ) : (
            <div className="summon-input">
              <div className="summon-row">
                <input
                  autoFocus
                  value={wish}
                  placeholder="想听哪个你？如：留在体制、真在乎钱的我…"
                  onChange={(e) => setWish(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void doSummon(); }}
                />
                <button disabled={!wish.trim()} onClick={() => void doSummon()}>召唤</button>
              </div>
              {offTable.length > 0 && (
                <div className="summon-existing">
                  <span className="summon-sub">或请已有的上桌：</span>
                  <div className="existing-chips">
                    {offTable.map((m) => (
                      <button key={m.id} className="exist-chip" onClick={() => void summonExisting(m.id)}>{m.nameZh}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="composer">
        <Avatar type="orb" accent="#8a7dff" size={40} />
        <div className="composer-box">
          <label>Universe-Prime Me · 主宇宙的我</label>
          <div className="composer-row">
            {!isMirror && (
              <button
                className={"summon-btn" + (summonOpen ? " on" : "")}
                title="召唤一个我"
                onClick={() => (summonOpen ? closeSummon() : openSummon())}
              >
                ✦
              </button>
            )}
            <input
              value={input}
              placeholder={busy ? "……" : "说点什么…（Enter 发送）"}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <button className="send" onClick={submit} disabled={busy || !input.trim()}>➤</button>
          </div>
        </div>
      </div>
    </div>
  );
}
