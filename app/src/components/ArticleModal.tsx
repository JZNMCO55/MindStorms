import { useState } from "react";
import { useStore } from "../store";

export default function ArticleModal() {
  const busy = useStore((s) => s.articleBusy);
  const text = useStore((s) => s.articleText);
  const title = useStore((s) => s.articleTitle);
  const close = useStore((s) => s.closeArticle);
  const saveDraft = useStore((s) => s.saveArticleDraft);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  const onSave = async () => {
    await saveDraft();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal article-modal" onClick={(e) => e.stopPropagation()}>
        <div className="article-head">
          <h2 className="modal-title">导出 · {title}</h2>
          <span className="muted">主宇宙的我口吻 · 已去真名</span>
        </div>
        <div className="article-body">
          {busy ? (
            <div className="article-loading">正在用你的口吻，把这场会谈写成一篇文章…</div>
          ) : (
            <pre>{text}</pre>
          )}
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" onClick={close}>关闭</button>
          <button className="btn-ghost" onClick={onCopy} disabled={busy || !text}>{copied ? "已复制" : "复制"}</button>
          <button className="btn-primary" onClick={onSave} disabled={busy || !text}>{saved ? "已存草稿" : "存草稿"}</button>
        </div>
      </div>
    </div>
  );
}
