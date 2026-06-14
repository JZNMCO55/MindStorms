import { useState } from "react";
import type { CSSProperties } from "react";
import { useStore } from "../store";
import Avatar from "./Avatar";
import type { CouncilMember } from "../types/council";

function Profile({ m, eyebrow, speaking }: { m: CouncilMember; eyebrow: string; speaking: boolean }) {
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

const FIELDS: { key: keyof CouncilMember; label: string; area?: boolean }[] = [
  { key: "nameZh", label: "名字" },
  { key: "backstory", label: "经历", area: true },
  { key: "utilityTitle", label: "在乎 / 效用" },
  { key: "utilityDesc", label: "效用一句话" },
  { key: "catchphrase", label: "口头禅" },
];

function EditForm({ m, onDone }: { m: CouncilMember; onDone: () => void }) {
  const editCard = useStore((s) => s.editCard);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String((m[f.key] as string) ?? "")])),
  );
  const save = () => {
    editCard(m.id, draft as Partial<CouncilMember>);
    onDone();
  };
  return (
    <div className="card-edit">
      <div className="insp-eyebrow">手动编辑</div>
      {FIELDS.map((f) => (
        <label key={String(f.key)} className="edit-field">
          <span>{f.label}</span>
          {f.area ? (
            <textarea rows={3} value={draft[f.key as string]} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
          ) : (
            <input value={draft[f.key as string]} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
          )}
        </label>
      ))}
      <div className="cand-actions">
        <button className="btn-ghost" onClick={onDone}>取消</button>
        <button className="btn-primary" onClick={save}>保存</button>
      </div>
    </div>
  );
}

export default function Inspector() {
  const members = useStore((s) => s.members);
  const conversations = useStore((s) => s.conversations);
  const activeId = useStore((s) => s.activeConversationId);
  const panelView = useStore((s) => s.panelView);
  const inspectedId = useStore((s) => s.inspectedId);
  const openDetail = useStore((s) => s.openDetail);
  const backToRoster = useStore((s) => s.backToRoster);
  const addCorrection = useStore((s) => s.addCorrection);
  const refiningId = useStore((s) => s.refiningId);
  const saveCard = useStore((s) => s.saveCard);
  const removeFromCast = useStore((s) => s.removeFromCast);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  const submitCorrection = (cardId: string) => {
    const t = draft.trim();
    if (!t) return;
    setDraft("");
    void addCorrection(cardId, t);
  };

  const conv = conversations.find((c) => c.id === activeId);
  const cast = conv ? members.filter((m) => conv.memberIds.includes(m.id)) : [];

  // a saved world's full profile
  if (panelView === "detail") {
    const m = members.find((x) => x.id === inspectedId) ?? cast[0];
    if (!m) return <aside className="panel charpanel" />;
    const speaking = conv?.speakingId === m.id;
    const onTable = !!conv && conv.memberIds.includes(m.id);
    const isMirror = m.id === "mirror";
    return (
      <aside className="panel charpanel" style={{ "--accent": m.accent } as CSSProperties}>
        <button className="cp-back" onClick={() => { setEditing(false); backToRoster(); }}>‹ 返回</button>
        {editing ? (
          <EditForm m={m} onDone={() => setEditing(false)} />
        ) : (
          <>
            <Profile m={m} eyebrow={speaking ? "CURRENTLY SPEAKING" : m.saved ? "卡池 · 常驻" : "本场访客 · 未入库"} speaking={speaking} />

            {!isMirror && (
              <div className="card-ops">
                {m.saved ? (
                  <span className="pool-badge saved">★ 已在卡池</span>
                ) : (
                  <button className="btn-primary save-pool" onClick={() => saveCard(m.id)}>★ 收入卡池</button>
                )}
                <button className="btn-ghost" onClick={() => setEditing(true)}>编辑</button>
                {onTable && <button className="btn-ghost" onClick={() => removeFromCast(m.id)}>请下桌</button>}
              </div>
            )}

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
          </>
        )}
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
          const speaking = conv?.speakingId === m.id;
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
                  {m.id !== "mirror" && !m.saved && <span className="guest-tag">访客</span>}
                </div>
                <div className="roster-name-zh">世界 #{m.worldId}</div>
              </div>
              <span className="cp-arrow">›</span>
            </li>
          );
        })}
      </ul>
      {conv && conv.mode !== "mirror" && (
        <p className="cp-hint">
          {cast.length === 0 ? "本场还没有角色。" : ""}在下方输入框点 ✦ 召唤一个和这次话题相关的「我」。
        </p>
      )}
    </aside>
  );
}
