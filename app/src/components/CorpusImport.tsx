import { useState } from "react";

export default function CorpusImport() {
  const [status, setStatus] = useState("");

  const onFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = await Promise.all(
      Array.from(fileList).map(async (f) => ({ name: f.name, chars: (await f.text()).length }))
    );
    const chars = files.reduce((n, f) => n + f.chars, 0);
    setStatus(`已读取 ${files.length} 个文件，约 ${chars.toLocaleString()} 字符（占位：清理/蒸馏走 scripts/ 管线）`);
  };

  return (
    <div className="corpus">
      <h2>语料 / 记录</h2>
      <p className="muted">
        把公众号文章存成 HTML 后导入。原始文字只在本地处理，只有抽象画像会参与会谈。
      </p>
      <label className="dropzone">
        <input type="file" accept=".html,.htm" multiple onChange={(e) => onFiles(e.target.files)} />
        <span>选择 / 拖入 HTML 文件</span>
      </label>
      {status && <p className="import-status">{status}</p>}
    </div>
  );
}
