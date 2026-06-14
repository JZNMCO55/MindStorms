import type { CSSProperties } from "react";
import { useStore } from "../store";
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

  const conv = conversations.find((c) => c.id === activeId) ?? conversations[0];
  const byId = (id: string) => members.find((m) => m.id === id) ?? members[0];

  const submit = async () => {
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    await send(t);
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
        <button className="settings" title="Council Settings">⚙</button>
      </header>

      <div className="topic">
        <h1 className="topic-title">{conv.topic}</h1>
      </div>

      <div className="messages">
        {conv.messages.length === 0 && (
          <div className="hint">
            {conv.mode === "mirror"
              ? "说说你最近在纠结什么——镜子里的我会追问你。"
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
          return (
            <div key={msg.id} className="msg" style={{ "--accent": m.accent } as CSSProperties}>
              <button className="msg-avatar" onClick={() => openDetail(m.id)} title="查看角色">
                <Avatar type={m.avatar} accent={m.accent} size={46} />
              </button>
              <div className="msg-body">
                <div className="msg-name">{msg.cardName || m.nameZh}</div>
                <div className="bubble"><p>{msg.text}</p></div>
              </div>
            </div>
          );
        })}
        {busy && (
          <div className="msg thinking"><span /><span /><span /></div>
        )}
        {!busy && conv.messages.some((mm) => !["__user__", "__sys__"].includes(mm.memberId)) && (
          <div className="chat-actions">
            {conv.mode !== "mirror" && (
              <button className="converge-btn" onClick={() => converge()}>✦ 让主宇宙的我收敛</button>
            )}
            <button className="converge-btn ghost" onClick={() => exportArticle()}>✎ 导出文章</button>
          </div>
        )}
      </div>

      <div className="composer">
        <Avatar type="orb" accent="#8a7dff" size={40} />
        <div className="composer-box">
          <label>Universe-Prime Me · 主宇宙的我</label>
          <div className="composer-row">
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
            <button className="send" onClick={submit} disabled={busy || !input.trim()}>
              ➤
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
