import { useStore } from "../store";
import Avatar from "./Avatar";

function NavIcon({ name }: { name: "history" | "cards" | "book" | "graph" }) {
  const paths: Record<string, JSX.Element> = {
    history: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
    cards: (
      <>
        <rect x="4" y="6" width="13" height="10" rx="2" />
        <path d="M8 18h9a2 2 0 0 0 2-2V9" />
      </>
    ),
    book: (
      <>
        <path d="M5 5.5C5 4.7 5.7 4 6.5 4H18v15H6.5C5.7 19 5 18.3 5 17.5z" />
        <path d="M5 16.5h12.5" />
      </>
    ),
    graph: (
      <>
        <circle cx="6" cy="7" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="13" cy="18" r="2" />
        <path d="M7.6 8.2 11.6 16M16.5 7.6 13.8 16" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export default function Sidebar() {
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const setActiveConversation = useStore((s) => s.setActiveConversation);
  const openNewConvo = useStore((s) => s.openNewConvo);
  const members = useStore((s) => s.members);
  const openDetail = useStore((s) => s.openDetail);
  const deleteCard = useStore((s) => s.deleteCard);
  const generateWorld = useStore((s) => s.generateWorld);
  const generating = useStore((s) => s.generating);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const leftTab = useStore((s) => s.leftTab);
  const setLeftTab = useStore((s) => s.setLeftTab);

  const onHistory = view === "council" && leftTab === "history";
  const onCards = view === "council" && leftTab === "cards";

  return (
    <aside className="panel sidebar">
      <div className="brand">
        <span className="brand-mark">🧠</span>
        <span className="brand-name">MindStorms</span>
      </div>

      {leftTab === "history" ? (
        <button className="new-convo" onClick={openNewConvo}>＋ 新建对话</button>
      ) : (
        <button className="new-convo gen" onClick={generateWorld} disabled={generating}>
          {generating ? "✦ 生成中…" : "✦ 生成新世界"}
        </button>
      )}

      {leftTab === "history" ? (
        <>
          <div className="section-head static"><span>🕓 历史对话</span></div>
          <ul className="history">
            {conversations.map((c) => (
              <li
                key={c.id}
                className={"history-item" + (activeId === c.id ? " active" : "")}
                onClick={() => setActiveConversation(c.id)}
              >
                <span className="h-topic">{c.topic}</span>
                <span className="h-date">{c.date}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <div className="section-head static">
            <span>🗂 角色卡库</span>
            <span className="muted">{members.length}</span>
          </div>
          <ul className="collection">
            {members.map((m) => (
              <li key={m.id} className="coll-card" onClick={() => openDetail(m.id)}>
                <Avatar type={m.avatar} accent={m.accent} size={38} />
                <div className="coll-meta">
                  <div className="coll-name">{m.nameZh}</div>
                  <div className="coll-world">世界 #{m.worldId}</div>
                </div>
                <button
                  className="coll-del"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteCard(m.id);
                  }}
                >
                  ×
                </button>
              </li>
            ))}
            {members.length === 0 && <li className="empty">还没有收藏的世界</li>}
          </ul>
        </>
      )}

      <nav className="sidenav">
        <button className={onHistory ? "active" : ""} title="对话" onClick={() => { setLeftTab("history"); setView("council"); }}>
          <NavIcon name="history" />
        </button>
        <button className={onCards ? "active" : ""} title="角色卡库" onClick={() => { setLeftTab("cards"); setView("council"); }}>
          <NavIcon name="cards" />
        </button>
        <button className={view === "corpus" ? "active" : ""} title="语料 / 记录" onClick={() => setView("corpus")}>
          <NavIcon name="book" />
        </button>
        <button title="关系图"><NavIcon name="graph" /></button>
      </nav>
    </aside>
  );
}
