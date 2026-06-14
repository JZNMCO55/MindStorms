import { useState } from "react";
import type { CSSProperties } from "react";
import { useStore } from "../store";
import Avatar from "./Avatar";
import type { Mode } from "../types/session";
import { MODE_LABELS } from "../types/session";

const MODES: Mode[] = ["decision", "exploration", "mirror"];
const MODE_DESC: Record<Mode, string> = {
  decision: "多个“我”辩论，收敛出你一直回避的取舍。",
  exploration: "发散、脑暴、聊哲学——不急着收敛。",
  mirror: "镜子里的我反问你，把你自己的答案引导出来。",
};

export default function NewConversationModal() {
  const members = useStore((s) => s.members);
  const closeNewConvo = useStore((s) => s.closeNewConvo);
  const createConversation = useStore((s) => s.createConversation);

  const [draftMode, setDraftMode] = useState<Mode>("decision");
  // 镜子只属于镜子模式，不进议会候选
  const castable = members.filter((m) => m.id !== "mirror");
  // 创建对话时只「拉」已有角色（可一个都不拉）；新角色改到会话里再生成。
  const [picked, setPicked] = useState<string[]>([]);

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <div className="modal-backdrop" onClick={closeNewConvo}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">新建对话</h2>

        <div className="modal-section">
          <div className="modal-label">对话类型</div>
          <div className="type-grid">
            {MODES.map((m) => (
              <button
                key={m}
                className={"type-card" + (draftMode === m ? " active" : "")}
                onClick={() => setDraftMode(m)}
              >
                <div className="type-name">{MODE_LABELS[m]}模式</div>
                <div className="type-desc">{MODE_DESC[m]}</div>
              </button>
            ))}
          </div>
        </div>

        {draftMode === "mirror" ? (
          <div className="modal-section">
            <div className="modal-label">镜子模式</div>
            <p className="mirror-note">
              只和「镜子里的你」1:1——它只问不答，把你自己的答案一句句引导出来。无需点将。
            </p>
          </div>
        ) : (
          <div className="modal-section">
            <div className="modal-label">
              拉入已有角色 <span className="muted">已选 {picked.length} 位 · 可不选</span>
            </div>
            {castable.length === 0 ? (
              <p className="mirror-note">还没有角色卡——先建一场空对话，进去后再生成和话题相关的「我」。</p>
            ) : (
              <>
                <div className="member-grid">
                  {castable.map((m) => (
                    <button
                      key={m.id}
                      className={"member-pick" + (picked.includes(m.id) ? " active" : "")}
                      style={{ "--accent": m.accent } as CSSProperties}
                      onClick={() => toggle(m.id)}
                    >
                      <Avatar type={m.avatar} accent={m.accent} size={38} />
                      <span>{m.nameZh}</span>
                    </button>
                  ))}
                </div>
                <p className="mirror-note pick-hint">新角色不在这里建——进对话后，在右侧「本场角色」里生成和话题相关的「我」。</p>
              </>
            )}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={closeNewConvo}>取消</button>
          <button
            className="btn-primary"
            onClick={() => createConversation(draftMode, picked)}
          >
            {draftMode === "mirror" || picked.length > 0 ? "召集 · 创建" : "建一场空对话"}
          </button>
        </div>
      </div>
    </div>
  );
}
