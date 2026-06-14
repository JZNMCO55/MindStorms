import { useState } from "react";
import type { CSSProperties } from "react";
import { useStore } from "../store";
import Avatar from "./Avatar";
import type { CouncilMember } from "../types/council";

function Profile({
  m,
  eyebrow,
  speaking,
}: {
  m: CouncilMember;
  eyebrow: string;
  speaking: boolean;
}) {
  return (
    <>
      <div className="insp-eyebrow">{eyebrow}</div>
      <div className="world-id">世界 #{m.worldId}</div>

      <div className="insp-hero">
        <Avatar type={m.avatar} accent={m.accent} size={112} speaking={speaking} />
        <div className="insp-name">{m.nameZh}</div>
        <div className="insp-name-zh">{m.nameEn}</div>
      </div>

      <section className="stat">
        <div className="stat-label"><span>经历</span></div>
        <p className="backstory">{m.backstory}</p>
      </section>

      <section className="stat">
        <div className="stat-head"><span>共鸣度</span><span className="stat-val">{m.resonance}%</span></div>
        <div className="fid-bar"><i style={{ width: `${m.resonance}%` }} /></div>
      </section>

      <section className="stat">
        <div className="stat-label"><span>性格 · 效用</span></div>
        <div className="stat-main">{m.utilityTitle}</div>
        <p className="stat-desc">{m.utilityDesc}</p>
      </section>

      <section className="stat last">
        <div className="stat-label"><span>口头禅</span></div>
        <div className="stat-main quote">“{m.catchphrase}”</div>
        <div className="tags">{m.voiceTags.join(" · ")}</div>
      </section>
    </>
  );
}

export default function Inspector() {
  const members = useStore((s) => s.members);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const panelView = useStore((s) => s.panelView);
  const inspectedId = useStore((s) => s.inspectedId);
  const candidate = useStore((s) => s.candidate);
  const openDetail = useStore((s) => s.openDetail);
  const backToRoster = useStore((s) => s.backToRoster);
  const addCandidate = useStore((s) => s.addCandidate);
  const discardCandidate = useStore((s) => s.discardCandidate);
  const addCorrection = useStore((s) => s.addCorrection);
  const refiningId = useStore((s) => s.refiningId);
  const [draft, setDraft] = useState("");

  const submitCorrection = (cardId: string) => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    void addCorrection(cardId, t);
  };

  const conv = conversations.find((c) => c.id === activeId) ?? conversations[0];
  const cast = members.filter((m) => conv.memberIds.includes(m.id));

  // a freshly generated world, pending keep/discard
  if (panelView === "candidate" && candidate) {
    return (
      <aside className="panel charpanel" style={{ "--accent": candidate.accent } as CSSProperties}>
        <button className="cp-back" onClick={discardCandidate}>‹ 返回</button>
        <Profile m={candidate} eyebrow="NEW WORLD · 候选" speaking={false} />
        <div className="cand-actions">
          <button className="btn-ghost" onClick={discardCandidate}>丢弃</button>
          <button className="btn-primary" onClick={addCandidate}>加入收藏</button>
        </div>
      </aside>
    );
  }

  // a saved world's full profile
  if (panelView === "detail") {
    const m = members.find((x) => x.id === inspectedId) ?? cast[0];
    if (!m) return <aside className="panel charpanel" />;
    const speaking = conv.speakingId === m.id;
    return (
      <aside className="panel charpanel" style={{ "--accent": m.accent } as CSSProperties}>
        <button className="cp-back" onClick={backToRoster}>‹ 返回</button>
        <Profile m={m} eyebrow={speaking ? "CURRENTLY SPEAKING" : "PARALLEL WORLD"} speaking={speaking} />
        <div className="correct">
          <div className="correct-label">{refiningId === m.id ? "精修中…" : "✎ 这不是我？说一句纠正"}</div>
          <div className="correct-row">
            <input
              value={draft}
              placeholder="比如：我没那么焦虑钱"
              disabled={refiningId === m.id}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCorrection(m.id); }}
            />
            <button disabled={refiningId === m.id || !draft.trim()} onClick={() => submitCorrection(m.id)}>纠正</button>
          </div>
          {m.corrections && m.corrections.length > 0 && (
            <div className="correct-log">已纠正 {m.corrections.length} 条，卡已精修</div>
          )}
        </div>
      </aside>
    );
  }

  // the cast of the active conversation
  return (
    <aside className="panel charpanel">
      <div className="cp-head">
        <span>本场角色</span>
        <span className="muted">{cast.length}</span>
      </div>
      <ul className="cp-roster">
        {cast.map((m) => {
          const speaking = conv.speakingId === m.id;
          return (
            <li
              key={m.id}
              className={"cp-card" + (speaking ? " speaking" : "")}
              style={{ "--accent": m.accent } as CSSProperties}
              onClick={() => openDetail(m.id)}
            >
              <Avatar type={m.avatar} accent={m.accent} size={46} speaking={speaking} />
              <div className="roster-meta">
                <div className="roster-name">
                  {m.nameZh}
                  {speaking && <i className="live" />}
                </div>
                <div className="roster-name-zh">世界 #{m.worldId}</div>
              </div>
              <span className="cp-arrow">›</span>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
