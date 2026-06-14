#!/usr/bin/env node
/**
 * map-reduce 蒸馏「主世界的我」。
 *   map:   每个 chunk -> claude(sonnet) 抽结构化观察 -> obs/obs_NNN.json（可断点续）
 *   reduce: 全部观察 -> claude(opus) 合成 -> cards/self_mirror_main.json + 主世界的我.md
 * 走订阅：spawn `claude -p`，ANTHROPIC_API_KEY 置空。无需 API key。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CHUNK_DIR = "D:\\tools\\ms_distill\\chunks";
const OBS_DIR = "D:\\tools\\ms_distill\\obs";
const CARDS = "E:\\ForStudy\\Project\\MindStorms\\cards";
fs.mkdirSync(OBS_DIR, { recursive: true });
fs.mkdirSync(CARDS, { recursive: true });

const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

function runClaude(prompt, model) {
  return new Promise((resolve) => {
    const cli = ["-p", "--output-format", "json", ...(model ? ["--model", model] : [])];
    const proc = spawn("cmd.exe", ["/c", "claude", ...cli], {
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
      cwd: "D:\\tools",
    });
    let out = "";
    const killer = setTimeout(() => { try { proc.kill(); } catch {} }, 300000);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", () => {});
    proc.stdin.write(prompt);
    proc.stdin.end();
    proc.on("close", (code) => {
      clearTimeout(killer);
      if (code !== 0) return resolve(null);
      let text;
      try { text = JSON.parse(out).result; } catch { return resolve(null); }
      const j = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      try { resolve(JSON.parse(j)); } catch { resolve(null); }
    });
    proc.on("error", () => { clearTimeout(killer); resolve(null); });
  });
}
async function runRetry(prompt, model, tries = 2) {
  for (let i = 0; i < tries; i++) {
    const r = await runClaude(prompt, model);
    if (r) return r;
  }
  return null;
}
async function pool(items, n, worker) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

const MAP_PROMPT = `下面是某人（记为 X）自己写或说过的一批真实文字，来自三处：微信里 X 自己发的消息（以「微信·与 某人」分隔）、X 的公众号文章、以及 X 与 AI 协作时的发言。全部是 X 本人说的话。

只依据这些文字，提炼关于 X 的结构化观察。规则：
- 只依据文本证据，不编造；证据不足的字段给空数组。
- 用具体行为描述，不要单个形容词（写"在 X 情况下会 Y"，而非"很 Y"）。
- grounding 原话必须逐字摘录。忽略粘贴的代码/日志/纯事务性短句。
- 直接输出严格 JSON，无任何额外文字、无代码块。

JSON 结构：
{"themes":[],"values":[],"emotional":[],"voice":[],"decisionHabits":[],"relationships":[],"events":[],"grounding":[]}

文字片段：
`;

const REDUCE_PROMPT = `下面是从 X 的大量真实文字（微信本人消息约 9.7 万条、公众号文章、与 AI 协作发言）里分块蒸出的多份观察。请综合成最终的「主世界的我 / self_mirror」——X 最高保真的自我画像，将来作为一个会用苏格拉底式提问引导 X 本人的角色。

规则：综合归并去重；保留跨多块反复出现的强信号；行为化描述不要堆形容词，证据不足处可标「（推断）」；grounding 保留最具代表性的逐字原话。直接输出严格 JSON，无额外文字、无代码块。

JSON 结构：
{"name":"主世界的我","source":"self_mirror","summary":"一句话画像","voice":"语言风格与口头禅","values":[],"fears":[],"decisionHabits":[],"catchphrases":[],"relationships":[],"lifeThemes":[],"grounding":[],"utility":"镜子模式里这个自我优化什么（只问不答，把答案引导出来）","questionsItWouldAsk":[],"narrative":"一段 400-600 字的自我画像，温度与洞察并重"}

各分块观察（JSON 数组）：
`;

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(CHUNK_DIR, "manifest.json"), "utf8"));
  const order = manifest.order;            // [contentHash, ...]，来源顺序稳定
  log(`MAP 开始：${order.length} 块（并行 4，Sonnet；内容哈希增量缓存）`);
  let cached = 0, mapped = 0, failed = 0;
  await pool(order, 4, async (h) => {
    const obsPath = path.join(OBS_DIR, `${h}.json`);
    if (fs.existsSync(obsPath)) { cached++; return; }   // 命中缓存：该块内容没变过
    const chunk = fs.readFileSync(path.join(CHUNK_DIR, `${h}.txt`), "utf8");
    const obs = await runRetry(MAP_PROMPT + chunk, "sonnet");
    if (obs) { fs.writeFileSync(obsPath, JSON.stringify(obs)); mapped++; log(`✓ map ${h}（本次新蒸 ${mapped}）`); }
    else { failed++; log(`✗ ${h} 失败`); }
  });
  log(`MAP 完成：缓存命中 ${cached}，新蒸 ${mapped}，失败 ${failed}`);

  const allObs = order.map((h) => {
    try { return JSON.parse(fs.readFileSync(path.join(OBS_DIR, `${h}.json`), "utf8")); } catch { return null; }
  }).filter(Boolean);
  log(`REDUCE 开始：合成 ${allObs.length} 份观察（Opus）`);
  const mirror = await runRetry(REDUCE_PROMPT + JSON.stringify(allObs), null, 3);
  if (!mirror) { log("REDUCE 失败"); process.exit(1); }

  fs.writeFileSync(path.join(CARDS, "self_mirror_main.json"), JSON.stringify(mirror, null, 2) + "\n");

  const arr = (k) => Array.isArray(mirror[k]) ? mirror[k].map((x) => `- ${x}`).join("\n") : "";
  const md = `# 主世界的我 — self_mirror（从真实语料蒸馏）

> 来源：微信本人消息 ${manifest.wechat_msgs} 条 + 朋友圈/网易云 ${manifest.moments_netease} 份（2016 起）+ 公众号 ${manifest.articles} 篇 + Claude Code session 本人发言 ${manifest.session_msgs} 条
> 方式：${order.length} 块内容哈希增量蒸馏（map: Sonnet / reduce: Opus）

**${mirror.summary || ""}**

## 自我画像
${mirror.narrative || ""}

## 语言风格
${mirror.voice || ""}

## 在乎的（values）
${arr("values")}

## 恐惧 / 逃避（fears）
${arr("fears")}

## 决策与思维习惯
${arr("decisionHabits")}

## 口头禅
${arr("catchphrases")}

## 这几年的人生主题
${arr("lifeThemes")}

## 关系模式
${arr("relationships")}

## 它会这样反问你（镜子模式）
${arr("questionsItWouldAsk")}

## 锚点原话
${arr("grounding")}
`;
  fs.writeFileSync(path.join(CARDS, "主世界的我.md"), md);
  log("DONE：cards/self_mirror_main.json + cards/主世界的我.md");
})();
