#!/usr/bin/env node
/**
 * MindStorms 本地后端（Phase 1–2）。spawn `claude` 走订阅，无需 API key。
 *   GET  /api/self_mirror
 *   POST /api/chat            {mode, cards, history, input}
 *   POST /api/generate-world  {topic?}      -> 基于真自我现生成一个平行世界
 *   POST /api/converge        {cards, history, topic} -> 主宇宙的我收敛出"被回避的取舍"
 */
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";

const PORT = 8787;
const SELF_MIRROR_FILE = "E:\\ForStudy\\Project\\MindStorms\\cards\\self_mirror_main.json";

function loadSelfMirror() {
  try {
    return JSON.parse(fs.readFileSync(SELF_MIRROR_FILE, "utf8"));
  } catch {
    return null;
  }
}

// ---- 多 provider LLM 层 ----
// Claude 订阅 = spawn `claude` CLI（已验证、最稳，等价于走订阅 OAuth，不按 token 计费）；
// Claude API key / 其它家（OpenAI 兼容：ChatGPT、DeepSeek、GLM、Kimi…）= 直连 HTTP。
// 选哪条由 cards/settings.json 决定，前端「设置」面板写入。
const SETTINGS_FILE = "E:\\ForStudy\\Project\\MindStorms\\cards\\settings.json";
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")); } catch { return {}; }
}
// OpenAI 兼容各家的默认接入点 + 默认模型（baseUrl/model 都可被 settings 覆盖）
const PRESETS = {
  openai:   { baseUrl: "https://api.openai.com/v1",            model: "gpt-4o" },
  deepseek: { baseUrl: "https://api.deepseek.com",             model: "deepseek-chat" },
  glm:      { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-plus" },
  kimi:     { baseUrl: "https://api.moonshot.cn/v1",           model: "moonshot-v1-32k" },
  custom:   { baseUrl: "",                                     model: "" },
};
// 前端下拉传来的多是 Claude 别名——非 Claude provider 一律忽略，回落到该家默认模型。
const isClaudeAlias = (m) => !m || m === "opus" || m === "sonnet" || m === "haiku" || String(m).startsWith("claude");

// Claude 订阅：spawn `claude`，置空 API key 走订阅；可选注入 setup-token（CLAUDE_CODE_OAUTH_TOKEN）。
function runClaudeCli(prompt, model, oauthToken) {
  return new Promise((resolve, reject) => {
    const cli = ["-p", "--output-format", "json", ...(model ? ["--model", model] : [])];
    const env = { ...process.env, ANTHROPIC_API_KEY: "" };
    if (oauthToken) env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken;
    const proc = spawn("cmd.exe", ["/c", "claude", ...cli], { env, cwd: "D:\\tools" });
    let out = "";
    const killer = setTimeout(() => { try { proc.kill(); } catch {} }, 150000);
    proc.stdout.on("data", (d) => (out += d));
    proc.stderr.on("data", () => {});
    proc.stdin.write(prompt);
    proc.stdin.end();
    proc.on("close", (code) => {
      clearTimeout(killer);
      if (code !== 0) return reject(new Error("claude exit " + code));
      try { resolve(JSON.parse(out).result); } catch (e) { reject(e); }
    });
    proc.on("error", reject);
  });
}

// Claude HTTP（API key，按 token 计费）：标准 x-api-key。
async function anthropicHttp(prompt, model, apiKey) {
  if (!apiKey) throw new Error("Claude(API key) 未配置 apiKey");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error("anthropic " + r.status + " " + (await r.text()).slice(0, 300));
  const j = await r.json();
  return (Array.isArray(j.content) ? j.content : []).map((c) => c.text || "").join("").trim();
}

// OpenAI 兼容（ChatGPT/DeepSeek/GLM/Kimi/自建中转）：Bearer + /chat/completions。
async function openaiHttp(prompt, model, baseUrl, apiKey) {
  if (!baseUrl) throw new Error("未配置 baseUrl");
  if (!apiKey) throw new Error("未配置 apiKey");
  const r = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.8, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error("llm " + r.status + " " + (await r.text()).slice(0, 300));
  const j = await r.json();
  return String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim();
}

// 统一入口（替代原 runClaude）：按 settings 选 provider/鉴权。
//   reqModel    = 前端下拉的逐场覆盖（多为 Claude 别名）
//   claudeDefault = 该接口偏好的 Claude 模型（null＝用 CLI/账号默认）
async function callLLM(prompt, reqModel, claudeDefault) {
  const s = loadSettings();
  const provider = s.provider || "claude";
  if (provider === "claude") {
    const model = (reqModel && String(reqModel)) || s.model || claudeDefault || "";
    if ((s.auth || "subscription") === "subscription") return runClaudeCli(prompt, model, s.oauthToken);
    return anthropicHttp(prompt, model || "claude-sonnet-4-6", s.apiKey);
  }
  const preset = PRESETS[provider] || PRESETS.custom;
  const baseUrl = (s.baseUrl || preset.baseUrl || "").trim();
  const model = (reqModel && !isClaudeAlias(reqModel) ? String(reqModel) : "") || s.model || preset.model;
  if (!model) throw new Error(`provider ${provider} 未配置 model`);
  return openaiHttp(prompt, model, baseUrl, s.apiKey);
}
function parseJson(raw) {
  const j = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  return JSON.parse(j);
}
function historyText(history) {
  return (history || [])
    .map((h) => (h.role === "user" ? "他" : (h.cardName || "议会")) + "：" + h.text)
    .join("\n");
}
// 给每条加编号，让发言者能用 replyTo 指向某一条（群聊式引用）。
function historyNumbered(history) {
  return (history || [])
    .map((h, i) => `${i + 1}) ` + (h.role === "user" ? "他" : (h.cardName || "议会")) + "：" + h.text)
    .join("\n");
}
function clampReplyTo(v, len) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= len ? n : null;
}
// 反 AI 腔禁忌：所有「聊天语域」发言入口共享，单一来源。
// 研究依据——markdown 腔 + 超额书面连接词是可清点的 AI 签名（去AI味研究 §词法签名层）。
const ANTI_AI_TELL = `【绝对别露 AI 马脚｜他从不这么说话，违反即穿帮】
- 禁 markdown 加粗（**这种**）、禁破折号"——"串排比金句、禁给词打「」引号。
- 禁"你是一个……的人 / 你所有的 X 都……"这种下定义判案的腔。
- 禁书面连接词："值得注意的是""总的来说""综上""不仅…而且""让我们""首先/其次"。
- 别每句都金句/专家腔；留点迟疑、半句话、"我也说不准"。`;

// 把主世界的他真实写下的原话当 few-shot 范例注入。
// 风格活在「原话」里、不在「对风格的描述」里（UAR/作者风格嵌入的实证）；
// 优先挑短句（聊天语域），别让公众号长文腔漏进群聊。
function voiceExemplars(m, n = 6) {
  const all = m && Array.isArray(m.grounding) ? m.grounding.filter(Boolean) : [];
  if (!all.length) return "";
  const short = all.filter((g) => g.length <= 40);
  const pick = (short.length >= 3 ? short : all).slice(0, n);
  return `他平时真的会这么说话（学这个味儿和这个句子长度，别照搬内容）：${pick.map((g) => `「${g}」`).join("  ")}`;
}

function selfBackdrop() {
  const m = loadSelfMirror();
  if (!m) return "";
  const ex = voiceExemplars(m);
  return `主世界的他的底色（语气/价值观，仅供你贴着写，别照抄）：${m.summary || ""}｜口头禅：${(m.catchphrases || []).slice(0, 4).join("、")}
${ex ? ex + "\n" : ""}${ANTI_AI_TELL}
`;
}

async function chatMirror({ history, input, model }) {
  const m = loadSelfMirror();
  if (!m) throw new Error("self_mirror 未蒸馏");
  const voiceGuide = `${m.voice || ""}\n${voiceExemplars(m)}`;
  const prompt = `你不是 AI 助手，也不是心理咨询师——你就是「他本人」，一个人对着镜子跟自己唠嗑。下面是你（他）的画像，经历、在怕什么、在逃避什么都在里面：
${JSON.stringify(m)}

【最重要：你说话必须是他这个味儿，绝不能露出 AI 马脚】
你的腔调：${voiceGuide}
所以：
- 短句、口语、能带感叹号；像发微信那样自然，别写小作文。
- 锋芒包进玩笑里：认真话后面可以跟个"(bushi""(doge""我瞎说的哈"，可以自嘲、可以损自己。别像个冷静的旁观者在解剖他。
- 可以有"嗯…""我也说不准""可能吧"这种迟疑、半句话，像真在跟自己嘀咕。
${ANTI_AI_TELL}

【你要做的】
你比谁都懂他（画像里全是他的真事和原话）。帮他把自己没照见的照出来，但**用他自己的方式**：
- 可以先认同/吐槽一句，或拈他自己一件事当镜子（"上次你…那回，不也这样？"）。
- 可以不确定地猜（"我猜你怕的其实不是钱，是…？也可能我想多了"）。
- **不用每句都甩一个扎心问题**。问题可以是轻的、半开玩笑的，顺着他刚说的往下带一点点就行。
- 底线：结论和决定让他自己说，别替他拍板、别给行动建议、别说教。

紧扣他刚说的这件事，别跳题。2-4 句，就像他自己跟自己说话。

【聊到这儿】
${historyText(history) || "（刚开始）"}

【他刚说】${input}

镜子里的你，接着唠（贴死他的腔调，别露 AI 马脚）：`;
  const text = (await callLLM(prompt, model, "claude-sonnet-4-6")).trim();
  return { replies: [{ cardName: "镜子里的我", text }] };
}

async function chatCouncil({ mode, cards, history, input, model }) {
  const roster = (cards || [])
    .map((c) => `- ${c.nameZh}（世界#${c.worldId}）：${c.backstory || ""}｜在乎：${c.utilityTitle || ""}｜口头禅：${c.catchphrase || ""}`)
    .join("\n");
  const goal =
    mode === "exploration"
      ? "这是探索模式：发散、互相激发，不急着收敛，可以越聊越开。"
      : "这是决策模式：各自从自己那条人生路的视角表态、可以互相反驳。";
  const prompt = `这是某人内心的「平行世界议会」——上场的都是从主世界的他分叉出去的『平行世界的我』。${goal}
${selfBackdrop()}上场角色：
${roster}

【对话历史】
${historyText(history) || "（刚开始）"}

【他抛出】${input}

让每个上场角色各发一言：既像他本人（贴他的腔调），又活出各自那条路的取舍；可互相回应；1-3 句，中文口语。
严格输出 JSON 数组，无别的：[{"cardName":"角色的中文名","text":"发言"}]`;
  const raw = await callLLM(prompt, model, "claude-sonnet-4-6");
  try { return { replies: parseJson(raw) }; }
  catch { return { replies: [{ cardName: "议会", text: raw.trim() }] }; }
}

// 议会单人发言：轮到 speaker 时，让它接着现场已经说的话往下讲（会接话/反驳）
async function speak({ mode, cards, speaker, history, model }) {
  const sp = speaker || {};
  const others = (cards || [])
    .filter((c) => c.id !== sp.id)
    .map((c) => `${c.nameZh}（世界#${c.worldId}）`)
    .join("、");
  const goal =
    mode === "exploration"
      ? "这是探索模式：发散、互相激发、敢抬杠脑暴，不急着收敛。"
      : "这是决策模式：各自从自己那条人生路的视角表态、敢于互相反驳。";
  const hist = history || [];
  const lastIsUser = hist.length > 0 && hist[hist.length - 1].role === "user";
  const prompt = `这是某人内心的「平行世界议会」圆桌讨论。${goal}
${selfBackdrop()}在场的还有：${others || "（只有你）"}
现在轮到「${sp.nameZh}（世界#${sp.worldId}）」发言。
你的经历：${sp.backstory || ""}｜你在乎：${sp.utilityTitle || ""}｜口头禅：${sp.catchphrase || ""}

【现场已经说到这儿】（每条带了编号）
${historyNumbered(hist) || "（还没人开口）"}

以「${sp.nameZh}」的身份说一句话：
- 你是从主世界的他分叉出去的这一版人生，带着那条路的取舍和腔调，像他本人在说话。
- **关键：这是讨论，不是各自答题。**${lastIsUser ? "你是这轮第一个开口的，直接回应他抛出的问题、亮出你这条路的态度，给后面的人留个话头。" : "前面已经有人发言了——你要接住或反驳他们，别重复、别各说各的。"}
- **别在话里报谁说的**（"读博的我说…"这种）——头像已经标了谁在说。要是你这句针对上面某一条，就用 replyTo 指向它的编号；顺着往下说就别填。
- 1-3 句，中文口语，像在现场插话。
严格输出 JSON，无别的：{"text":"你这句话","replyTo":针对的那条编号或null}`;
  const raw = await callLLM(prompt, model, "claude-sonnet-4-6");
  try {
    const j = parseJson(raw);
    return { reply: String(j.text || "").trim(), replyTo: clampReplyTo(j.replyTo, hist.length) };
  } catch {
    return { reply: raw.trim(), replyTo: null };
  }
}

// 导演拍子：看群聊记录，决定此刻谁最想插话（也可能聊透了→end），让那一个开口。
// 也可能提名一个"这话题该有却没上桌"的我（nominate），由用户决定要不要请上桌。
async function beat({ mode, cards, history, model }) {
  const roster = (cards || [])
    .map((c) => `- ${c.nameZh}（世界#${c.worldId}）：${c.backstory || ""}｜在乎：${c.utilityTitle || ""}｜腔调参考（别照搬念出来）：${c.catchphrase || ""}`)
    .join("\n");
  const vibe =
    mode === "exploration"
      ? "气氛是探索/脑暴，可以发散、跑题、互相点火"
      : "气氛是帮他做决定，几个'我'各执一端、敢呛敢戳";
  const hist = history || [];
  const prompt = `这是某人(他)脑子里的「平行世界议会」——几个平行世界的他在**群聊**（不是辩论赛、不是排队发言）。${vibe}。
${selfBackdrop()}在场的角色：
${roster}

看下面的群聊记录（每条带了编号），判断【此刻谁最可能忍不住开口】——基于谁被戳到了、谁对刚才的话有强烈反应、谁憋了别的话想说，让那一个人说一句。
像真群聊那样，别做作：
- **不是每个人都要发言**。只让此刻最有冲动的那一个开口；可以是刚说完又被人怼回来的人，也可以是一直没吭声突然插话的人。
- 他可以：反驳、附和补刀、跑题、突然感性、直接反问他本人、或岔开话题。**绝对不要每句都"引用上一个人+但是"那种排比，太假。**
- **别在话里报谁说的**（"读博的我说…"这种）——头像已经标了谁在说。要是这句针对上面某一条，就用 replyTo 指向它的编号；顺着往下说就别填（设 null）。引用要克制，像真人只在回早先某句/明确针对某人时才用。
- **口头禅/腔调只是帮你找语气，绝对别把它原样塞进句子里**（更别硬拼成病句）——像真人那样自然说话，一场里顶多偶尔冒一次半次。
- **别每句都是金句/专家腔**。可以有迟疑、情绪、自我怀疑、半句话、"我也说不准，但…"，像自己跟自己嘀咕。
- 长度随意：可以只甩一句，也可以两三句。中文口语，像他本人。
- 如果已经聊得差不多、该让他（主人公）接话了，就把 end 设成 true。

另外（**很克制**，绝大多数时候 nominate 设 null）：如果你发现**这个话题下，桌上缺了一个明显更合适、却还没上场的『我』**——不是为了抬杠凑反方，是这场讨论真该有、但现在没人能代表的那条人生视角——就在 nominate 里提名：wish 写"一个怎样的我"（一句话），reason 写"为什么这场需要他"。只有真有明显缺位才提，否则一律 null。

【群聊记录】
${historyNumbered(hist)}

严格输出 JSON，无别的：{"speaker":"开口者的中文名（必须是在场角色之一）","text":"他这一句","replyTo":针对的那条编号或null,"end":true或false,"nominate":{"wish":"一个怎样的我","reason":"为什么这场需要他"}或null}`;
  const raw = await callLLM(prompt, model, "claude-sonnet-4-6");
  try {
    const j = parseJson(raw);
    const nom = j.nominate && j.nominate.wish
      ? { wish: String(j.nominate.wish).trim(), reason: String(j.nominate.reason || "").trim() }
      : null;
    return {
      speaker: String(j.speaker || ""),
      text: String(j.text || "").trim(),
      replyTo: clampReplyTo(j.replyTo, hist.length),
      end: !!j.end,
      nominate: nom,
    };
  } catch {
    return { speaker: "", text: raw.trim(), replyTo: null, end: true, nominate: null };
  }
}

// 检索优先的召唤：拿用户/导演的意图，先在角色池里找；找不到才提案现造一个。
async function summonMatch({ wish, pool, onTable, topic, model }) {
  const want = String(wish || "").trim();
  if (!want) return { kind: "propose", sketch: { nameZh: "另一个我", oneLine: "" } };
  const list = (pool || [])
    .map((c, i) => `${i + 1}. ${c.nameZh}｜在乎：${c.utilityTitle || ""}｜经历：${c.backstory || ""}`)
    .join("\n");
  const seated = (onTable || []).join("、") || "（无）";
  const prompt = `${selfBackdrop()}某人想在这场对话里召唤一个『平行世界的我』，他的意图是：「${want}」。${topic ? `这场对话的话题：${topic}。` : ""}

已经在场的我：${seated}
角色池里**还没上场**的我（候选，带编号）：
${list || "（池子是空的）"}

判断该怎么满足这个意图，三选一：
- 如果在场的我里已经有人明显符合 → kind="on_table"，name 写那个人的中文名。
- 如果角色池里有一个或几个明显合适的（未在场）→ kind="match"，在 candidates 里按合适度从高到低列出（最多3个），每个写它的编号 n 和一句 reason。
- 如果池里都不够贴切 → kind="propose"，给一个**要新建的我**的一句话速写：nameZh（如『把事业全压上去赌一把的我』）+ oneLine（一句经历/取舍）。别现在展开成整张卡。

**保守**：宁可 propose 一个真正不同的我，也别硬把不搭的卡塞过来充数。
严格输出 JSON，无别的：{"kind":"on_table|match|propose","name":"","candidates":[{"n":1,"reason":""}],"sketch":{"nameZh":"","oneLine":""}}`;
  const raw = await callLLM(prompt, model, "claude-sonnet-4-6");
  let j;
  try { j = parseJson(raw); } catch { return { kind: "propose", sketch: { nameZh: want, oneLine: "" } }; }
  if (j.kind === "on_table") return { kind: "on_table", name: String(j.name || "").trim() };
  if (j.kind === "match") {
    const cands = (Array.isArray(j.candidates) ? j.candidates : [])
      .map((c) => {
        const idx = Math.round(Number(c.n)) - 1;
        const card = (pool || [])[idx];
        return card ? { id: card.id, name: card.nameZh, reason: String(c.reason || "").trim() } : null;
      })
      .filter(Boolean);
    if (cands.length) return { kind: "match", candidates: cands };
    return { kind: "propose", sketch: { nameZh: want, oneLine: "" } };
  }
  const sk = j.sketch || {};
  return { kind: "propose", sketch: { nameZh: String(sk.nameZh || want).trim(), oneLine: String(sk.oneLine || "").trim() } };
}

async function generateWorld({ topic, wish, model }) {
  const m = loadSelfMirror();
  const base = m ? `主世界的他的真实画像(JSON)：\n${JSON.stringify(m)}\n\n` : "";
  const wishLine = wish ? `**特别要长成这样的一个我**：「${wish}」——贴着这个意图来分叉，活出这条人生。` : "";
  const prompt = `${base}请基于「主世界的他」，虚构一个**平行世界的他**——在某个他真实可能走过的人生岔路上分叉出去的版本。给它一个世界编号、一段经历、以及由经历长出的性格。要贴着他的底色（他可能真会走的路、说话的腔调），但活出一条不同的取舍。${wishLine}${topic ? `这个世界要特别能就「${topic}」给他一个他自己想不到的视角。` : ""}
严格输出 JSON，无别的：
{"worldId":"如 C-42","nameEn":"英文别名","nameZh":"如『没放弃画画的我』","backstory":"2-3句经历","resonance":0到100的数字,"utilityTitle":"它在乎/优化什么","utilityDesc":"一句","timeHorizon":"时间视野","timeHorizonDesc":"一句","catchphrase":"一句口头禅","voiceTags":["3个性格词"],"avatar":"crystal|pyramid|heart|hourglass|orb 之一","accent":"6位hex如#7ad0ff"}`;
  return parseJson(await callLLM(prompt, model, "claude-sonnet-4-6"));
}

async function converge({ cards, history, topic, model }) {
  const roster = (cards || []).map((c) => `${c.nameZh}（在乎：${c.utilityTitle || ""}）`).join("、");
  const prompt = `下面是某人(他)内心几个『平行世界的我』围绕一个问题的辩论。请你以「主宇宙的他」——那个真要承担后果、做决定的本人——的身份，把这场辩论**收敛**成他一直在回避的那个取舍。
不要投票选某个世界、不要和稀泥。点出：真正的选择不是『谁对』，而是『哪一种损失他能承受』。简短、有力、戳心，2-4 句，中文，第二人称对他说。
${ANTI_AI_TELL}
${topic ? `议题：${topic}\n` : ""}上场的世界：${roster}

【辩论】
${historyText(history)}

主宇宙的我，收敛：`;
  const text = (await callLLM(prompt, model, null)).trim();
  return { crux: text };
}

// ----- 公众号飞轮：把一场会谈综合成主宇宙口吻的文章 -----
async function article({ topic, messages, model }) {
  const m = loadSelfMirror();
  const voice = m ? `语言风格：${m.voice || ""}｜口头禅（可点缀，别堆砌）：${(m.catchphrases || []).slice(0, 6).join("、")}` : "";
  const transcript = (messages || [])
    .map((x) => (x.memberId === "__user__" ? "我" : (x.cardName || "")) + "：" + x.text)
    .join("\n");
  const prompt = `下面是我内心一场「平行世界议会」围绕「${topic}」的讨论记录。请用**主宇宙的我（我本人）的口吻**，把它综合成一篇可以发公众号的**第一人称随笔**。
要求：
- 不是对话记录，是一段自我叙述与反思——把各个"世界的我"的所思所想化进我的思考里。
- 贴着我的语言风格。${voice}
- 开头点题，中间把矛盾摊开，结尾落到那个取舍或一点感悟。500-900 字。
- **隐私**：不出现任何真实人名，需要时泛化成"一个朋友""家里人"。
- 直接输出文章正文（markdown，可有小标题），不要前后缀说明。

【讨论记录】
${transcript}`;
  return { article: (await callLLM(prompt, model, null)).trim() };
}

function saveArticle({ title, content }) {
  const dir = "E:\\ForStudy\\Project\\MindStorms\\corpus\\公众号\\草稿";
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(title || "未命名").replace(/[\\/:*?"<>|\n]/g, "_").slice(0, 40);
  const file = `${dir}\\${safe}.md`;
  fs.writeFileSync(file, content, "utf8");
  return { path: file };
}

// ----- 纠错回路：按用户纠正精修一张卡 -----
async function refineCard({ card, corrections, model }) {
  const prompt = `下面是一张「角色卡」(JSON) 和用户对它的纠正。请根据纠正**精修这张卡**——改掉不准的、强化用户认可的，**保持 JSON 字段结构不变**（只改内容值）。证据不足处保守，别瞎编。直接输出修订后的严格 JSON，无别的。

【原卡】
${JSON.stringify(card)}

【用户的纠正】
${(corrections || []).map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
  return parseJson(await callLLM(prompt, model, null));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (d) => (b += d));
    req.on("end", () => resolve(b));
  });
}

const STATE_FILE = "E:\\ForStudy\\Project\\MindStorms\\cards\\app_state.json";

const ROUTES = {
  "/api/chat": (a) => (a.mode === "mirror" ? chatMirror(a) : chatCouncil(a)),
  "/api/speak": speak,
  "/api/beat": beat,
  "/api/summon-match": summonMatch,
  "/api/generate-world": generateWorld,
  "/api/converge": converge,
  "/api/article": article,
  "/api/save-article": saveArticle,
  "/api/refine-card": refineCard,
};

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  if (req.method === "GET" && req.url === "/api/self_mirror") {
    const m = loadSelfMirror();
    res.writeHead(m ? 200 : 404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(m || { error: "not found" }));
  }

  if (req.method === "GET" && req.url === "/api/state") {
    let s = null;
    try { s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(s));
  }
  if (req.method === "POST" && req.url === "/api/state") {
    const b = await readBody(req);
    try { fs.writeFileSync(STATE_FILE, b, "utf8"); } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end('{"ok":true}');
  }

  // 模型设置：provider / 鉴权 / key / baseUrl / 默认模型。POST 用浅合并，避免改一项把别的清空。
  if (req.method === "GET" && req.url === "/api/settings") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(loadSettings() || {}));
  }
  if (req.method === "POST" && req.url === "/api/settings") {
    const b = await readBody(req);
    try {
      const merged = { ...loadSettings(), ...JSON.parse(b || "{}") };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged, null, 2), "utf8");
    } catch {}
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end('{"ok":true}');
  }

  if (req.method === "POST" && ROUTES[req.url]) {
    try {
      const args = JSON.parse((await readBody(req)) || "{}");
      const result = await ROUTES[req.url](args);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String((e && e.message) || e) }));
    }
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => console.log(`MindStorms backend on http://127.0.0.1:${PORT}`));
