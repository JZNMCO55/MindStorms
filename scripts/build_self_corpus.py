#!/usr/bin/env python3
"""聚合「主世界的我」的全部自述语料 → 切成块，供 map-reduce 蒸馏。

三类来源（只取用户本人的话）：
  1. 微信 1对1 里 isSelf=true 的文本消息（每个对话一个表头，消息只留内容）
  2. 公众号文章
  3. Claude Code session 里 role=user 的人类发言（剔除工具结果/系统注入/我的回复/粘贴代码）

输出：D:\\tools\\ms_distill\\chunks\\chunk_000.txt ...  + manifest.json
"""
import json, glob, os, re, hashlib

OUT = r"D:\tools\ms_distill\chunks"
os.makedirs(OUT, exist_ok=True)
CHUNK_CHARS = 40000

lines = []          # 扁平文本行，按来源分组后整体打包
wx_n = art_n = sess_n = 0

# ---------- 1. 微信本人消息（每对话一个表头）----------
for f in sorted(glob.glob(r"E:\ForStudy\Project\MindStorms\corpus\微信\聊天记录\个人\*.json")):
    try:
        arr = json.load(open(f, encoding="utf-8-sig"))
    except Exception:
        continue
    selftexts = []
    for m in arr:
        if m.get("isSelf") and m.get("type") == 1:
            c = (m.get("content") or "").strip()
            if len(c) >= 2:
                selftexts.append(c)
    if not selftexts:
        continue
    name = os.path.splitext(os.path.basename(f))[0]
    lines.append(f"\n===== 微信·与 {name} =====")
    lines.extend(selftexts)
    wx_n += len(selftexts)

# ---------- 2. 公众号文章 ----------
for f in sorted(glob.glob(r"E:\ForStudy\Project\MindStorms\corpus\公众号\*.md")):
    txt = open(f, encoding="utf-8").read().strip()
    if len(txt) >= 10:
        lines.append("\n===== 公众号文章 =====")
        lines.append(txt)
        art_n += 1

# ---------- 2b. 朋友圈 + 网易云（黑历史，2016 起；全是本人写的）----------
extra_n = 0
for label, pat in [
    ("朋友圈", r"E:\ForStudy\Project\MindStorms\corpus\微信\朋友圈\*.md"),
    ("网易云笔记", r"E:\ForStudy\Project\MindStorms\corpus\网易云\*.md"),
]:
    for f in sorted(glob.glob(pat)):
        txt = open(f, encoding="utf-8").read().strip()
        if len(txt) >= 10:
            lines.append(f"\n===== {label}（本人，2016 起）=====")
            lines.append(txt)
            extra_n += 1

# ---------- 3. Claude Code session 里本人发言 ----------
_TAGS = ("<system-reminder>", "<command-name>", "<command-message>", "<command-args>",
         "<local-command", "<task-notification>", "[Request interrupted",
         "Caveat:", "<user-memory")

def clean_user_text(t):
    t = re.sub(r"(?s)<system-reminder>.*?</system-reminder>", "", t)
    t = re.sub(r"(?s)<command-[a-z]+>.*?</command-[a-z]+>", "", t)
    t = re.sub(r"(?s)<local-command-[a-z]+>.*?</local-command-[a-z]+>", "", t)
    return t.strip()

sess_lines = []
for f in glob.glob(r"C:\Users\Admin\.claude\projects\*\*.jsonl"):
    try:
        fh = open(f, encoding="utf-8", errors="ignore")
    except Exception:
        continue
    for line in fh:
        if '"role":"user"' not in line and '"role": "user"' not in line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get("type") != "user":
            continue
        msg = o.get("message") or {}
        if msg.get("role") != "user":
            continue
        content = msg.get("content")
        blocks = [content] if isinstance(content, str) else (
            [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
            if isinstance(content, list) else [])
        for raw in blocks:
            t = clean_user_text(raw)
            if len(t) < 2 or any(tag in t for tag in _TAGS):
                continue
            zh = len(re.findall(r"[一-鿿]", t))
            if len(t) > 200 and zh < len(t) * 0.15:   # 疑似粘贴代码/日志
                continue
            if len(t) > 1200:                          # 长粘贴/非个人口吻，跳过（个人语料才是主角）
                continue
            sess_lines.append(t)
            sess_n += 1
if sess_lines:
    lines.append("\n===== 与 AI 协作时的发言 =====")
    lines.extend(sess_lines)

# ---------- 打包 ----------
total_chars = sum(len(x) for x in lines)
chunks, cur, cur_len = [], [], 0
for x in lines:
    if cur_len + len(x) > CHUNK_CHARS and cur:
        chunks.append("\n".join(cur)); cur, cur_len = [], 0
    cur.append(x); cur_len += len(x) + 1
if cur:
    chunks.append("\n".join(cur))

# 按内容哈希命名 → obs 缓存跨语料变更存活（增量蒸馏）
order, active = [], set()
for ch in chunks:
    h = hashlib.sha256(ch.encode("utf-8")).hexdigest()[:16]
    order.append(h)
    active.add(h)
    p = os.path.join(OUT, f"{h}.txt")
    if not os.path.exists(p):
        open(p, "w", encoding="utf-8").write(ch)
# 清理不在当前集合里的旧块（含旧 chunk_NNN.txt 与已删内容的块）；obs 缓存保留
for f in glob.glob(os.path.join(OUT, "*.txt")):
    if os.path.splitext(os.path.basename(f))[0] not in active:
        os.remove(f)

manifest = {"order": order, "wechat_msgs": wx_n, "articles": art_n,
            "moments_netease": extra_n, "session_msgs": sess_n,
            "total_chars": total_chars, "chunks": len(chunks), "chunk_chars": CHUNK_CHARS}
json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)
print(json.dumps({k: v for k, v in manifest.items() if k != "order"}, ensure_ascii=False))
