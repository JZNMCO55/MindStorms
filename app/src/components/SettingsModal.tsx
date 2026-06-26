import { useState } from "react";
import { useStore } from "../store";
import type { LLMSettings, Provider } from "../backend/httpBackend";

const PROVIDERS: { value: Provider; label: string; note: string }[] = [
  { value: "claude", label: "Claude", note: "可走订阅(免按量)或 API Key" },
  { value: "openai", label: "ChatGPT / OpenAI", note: "按量计费 · 需 API Key" },
  { value: "deepseek", label: "DeepSeek", note: "国产直连 · 便宜 · 需 Key" },
  { value: "glm", label: "GLM / 智谱", note: "国产直连 · 需 Key" },
  { value: "kimi", label: "Kimi / 月之暗面", note: "国产直连 · 需 Key" },
  { value: "custom", label: "自定义 · OpenAI 兼容", note: "填 baseUrl + Key + 模型" },
];

// 占位符（仅提示默认值，留空即用后端默认）
const HINTS: Record<Provider, { baseUrl: string; model: string }> = {
  claude: { baseUrl: "", model: "claude-sonnet-4-6" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o" },
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  glm: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus" },
  kimi: { baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-32k" },
  custom: { baseUrl: "https://…/v1", model: "模型名" },
};

export default function SettingsModal() {
  const settings = useStore((s) => s.settings);
  const closeSettings = useStore((s) => s.closeSettings);
  const updateSettings = useStore((s) => s.updateSettings);

  const [draft, setDraft] = useState<LLMSettings>({ ...settings });
  const set = (patch: Partial<LLMSettings>) => setDraft((d) => ({ ...d, ...patch }));

  const isClaude = draft.provider === "claude";
  const needsKey = !isClaude || draft.auth === "apikey";
  const hint = HINTS[draft.provider];

  const onSave = async () => {
    await updateSettings(draft);
    closeSettings();
  };

  return (
    <div className="modal-backdrop" onClick={closeSettings}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title">模型设置</h2>

        <div className="modal-section">
          <div className="modal-label">模型来源</div>
          <div className="type-grid">
            {PROVIDERS.map((p) => (
              <button
                key={p.value}
                className={"type-card" + (draft.provider === p.value ? " active" : "")}
                onClick={() => set({ provider: p.value })}
              >
                <div className="type-name">{p.label}</div>
                <div className="type-desc">{p.note}</div>
              </button>
            ))}
          </div>
        </div>

        {isClaude && (
          <div className="modal-section">
            <div className="modal-label">鉴权方式</div>
            <div className="type-grid two">
              <button
                className={"type-card" + (draft.auth === "subscription" ? " active" : "")}
                onClick={() => set({ auth: "subscription" })}
              >
                <div className="type-name">订阅 · Claude Code</div>
                <div className="type-desc">复用已登录的订阅，不按 token 计费。需本机装并登录 Claude Code。</div>
              </button>
              <button
                className={"type-card" + (draft.auth === "apikey" ? " active" : "")}
                onClick={() => set({ auth: "apikey" })}
              >
                <div className="type-name">API Key</div>
                <div className="type-desc">用 Anthropic API Key 直连，按 token 计费。</div>
              </button>
            </div>
          </div>
        )}

        {needsKey && (
          <div className="modal-section">
            <div className="modal-label">API Key</div>
            <input
              className="settings-input"
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              placeholder="sk-…"
              onChange={(e) => set({ apiKey: e.target.value })}
            />
          </div>
        )}

        {isClaude && draft.auth === "subscription" && (
          <div className="modal-section">
            <div className="modal-label">
              setup-token <span className="muted">可选</span>
            </div>
            <input
              className="settings-input"
              type="password"
              autoComplete="off"
              value={draft.oauthToken}
              placeholder="CLAUDE_CODE_OAUTH_TOKEN（留空＝用已登录会话）"
              onChange={(e) => set({ oauthToken: e.target.value })}
            />
          </div>
        )}

        {!isClaude && (
          <div className="modal-section">
            <div className="modal-label">
              接入地址 baseUrl <span className="muted">留空用默认</span>
            </div>
            <input
              className="settings-input"
              value={draft.baseUrl}
              placeholder={hint.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </div>
        )}

        <div className="modal-section">
          <div className="modal-label">
            默认模型 <span className="muted">留空用默认</span>
          </div>
          <input
            className="settings-input"
            value={draft.model}
            placeholder={hint.model}
            onChange={(e) => set({ model: e.target.value })}
          />
        </div>

        <div className="modal-actions">
          <button className="btn-ghost" onClick={closeSettings}>取消</button>
          <button className="btn-primary" onClick={onSave}>保存</button>
        </div>
      </div>
    </div>
  );
}
