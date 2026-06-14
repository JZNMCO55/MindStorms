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

function runClaude(prompt, model) {
  return new Promise((resolve, reject) => {
    const cli = ["-p", "--output-format", "json", ...(model ? ["--model", model] : [])];
    const proc = spawn("cmd.exe", ["/c", "claude", ...cli], {
      env: { ...process.env, ANTHROPIC_API_KEY: "" },
      cwd: "D:\\tools",
    });
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
function parseJson(raw) {
  const j = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  return JSON.parse(j);
}
function historyText(history) {
  return (history || [])
    .map((h) => (h.role === "user" ? "他" : (h.cardName || "议会")) + "：" + h.text)
    .join("\n");
}
function selfBackdrop() {
  const m = loadSelfMirror();
  if (!m) return "";
  return `主世界的他的底色（语气/价值观，仅供你贴着写，别照抄）：${m.summary || ""}｜口头禅：${(m.catchphrases || []).slice(0, 4).join("、")}\n`;
}

async function chatMirror({ history, input }) {
  const m = loadSelfMirror();
  if (!m) throw new Error("self_mirror 未蒸馏");
  const prompt = `你是「镜子里的我」——他本人最高保真的内在镜子，由他全部语料蒸出来。下面是他的画像(JSON)，里面有他的经历、关系、原话、在怕什么、在逃避什么：
${JSON.stringify(m)}

你的任务不是审问他，是帮他**启发和挖掘**——把他自己没照见的东西照出来，再让他自己说出那层意义。你最大的优势是你**真的了解他**（画像里有大量他真实的经历和原话）。所以每次回应，**先做下面至少一件事，再落到一个往深一层的问题**（别每次都只是干问）：
- **照见模式**：点出你注意到的规律（"你每次提到X，后面其实都跟着Y"），说成你的观察，让他确认或反驳。
- **举他自己的例子**：从画像/他的经历里拈一件具体的事当镜子（"比如你…那次，是不是也…"），用他熟悉的材料启发他，别讲空道理。
- **试探性猜测**：不确定地抛个假设（"我猜你怕的其实不是A，是B？"），请他来修正。
- 偶尔先**共情**一句，别像查户口。

底线（重要）：你可以观察、举例、猜测、共情，但**最终的结论和决定必须让他自己说**——别替他下判断、别给行动建议、别说教。你是一个很懂他、陪他一层层往下挖的自己，不是人生导师。
紧扣他刚说的这件事往深挖（可调用画像里相关的经历），别跳到无关主题。
2-4 句，中文口语，带他的腔调（可偶尔用他的语气词，但别堆口头禅）。

【对话历史】
${historyText(history) || "（刚开始）"}

【他刚说】${input}

镜子里的我，回他（先照见/举例/猜测，再问一句往深挖）：`;
  const text = (await runClaude(prompt, "claude-sonnet-4-6")).trim();
  return { replies: [{ cardName: "镜子里的我", text }] };
}

async function chatCouncil({ mode, cards, history, input }) {
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
  const raw = await runClaude(prompt, "claude-sonnet-4-6");
  try { return { replies: parseJson(raw) }; }
  catch { return { replies: [{ cardName: "议会", text: raw.trim() }] }; }
}

// 议会单人发言：轮到 speaker 时，让它接着现场已经说的话往下讲（会接话/反驳）
async function speak({ mode, cards, speaker, history }) {
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

【现场已经说到这儿】
${historyText(hist) || "（还没人开口）"}

以「${sp.nameZh}」的身份说一句话：
- 你是从主世界的他分叉出去的这一版人生，带着那条路的取舍和腔调，像他本人在说话。
- **关键：这是讨论，不是各自答题。**${lastIsUser ? "你是这轮第一个开口的，直接回应他抛出的问题、亮出你这条路的态度，给后面的人留个话头。" : "前面已经有人发言了——你要接住或反驳他们（可点名，比如『读博的我说得轻巧，但…』『+1，不过…』），别重复、别各说各的。"}
- 1-3 句，中文口语，像在现场插话。只输出你这句话本身，不要前缀、不要引号、不要 JSON。`;
  const text = (await runClaude(prompt, "claude-sonnet-4-6")).trim();
  return { reply: text };
}

// 导演拍子：看群聊记录，决定此刻谁最想插话（也可能聊透了→end），让那一个开口
async function beat({ mode, cards, history }) {
  const roster = (cards || [])
    .map((c) => `- ${c.nameZh}（世界#${c.worldId}）：${c.backstory || ""}｜在乎：${c.utilityTitle || ""}｜腔调参考（别照搬念出来）：${c.catchphrase || ""}`)
    .join("\n");
  const vibe =
    mode === "exploration"
      ? "气氛是探索/脑暴，可以发散、跑题、互相点火"
      : "气氛是帮他做决定，几个'我'各执一端、敢呛敢戳";
  const prompt = `这是某人(他)脑子里的「平行世界议会」——几个平行世界的他在**群聊**（不是辩论赛、不是排队发言）。${vibe}。
${selfBackdrop()}在场的角色：
${roster}

看下面的群聊记录，判断【此刻谁最可能忍不住开口】——基于谁被戳到了、谁对刚才的话有强烈反应、谁憋了别的话想说，让那一个人说一句。
像真群聊那样，别做作：
- **不是每个人都要发言**。只让此刻最有冲动的那一个开口；可以是刚说完又被人怼回来的人，也可以是一直没吭声突然插话的人。
- 他可以：反驳、附和补刀、跑题、突然感性、直接反问他本人、或岔开话题。**绝对不要每句都"引用上一个人+但是"那种排比，太假。**
- **口头禅/腔调只是帮你找语气，绝对别把它原样塞进句子里**（更别硬拼成病句，比如把"格局，赌的是未来"塞成"格局赌的是第一段"）——像真人那样自然说话，一场里顶多偶尔冒一次半次。
- **别每句都是金句/专家腔**。可以有迟疑、情绪、自我怀疑、半句话、"我也说不准，但…"，像自己跟自己嘀咕，不是站台给人讲课。
- 长度随意：可以只甩一句，也可以两三句。中文口语，像他本人。
- 如果已经聊得差不多、该让他（主人公）接话了，就把 end 设成 true。

【群聊记录】
${historyText(history)}

严格输出 JSON，无别的：{"speaker":"开口者的中文名（必须是在场角色之一）","text":"他这一句","end":true或false}`;
  const raw = await runClaude(prompt, "claude-sonnet-4-6");
  try {
    const j = parseJson(raw);
    return { speaker: String(j.speaker || ""), text: String(j.text || "").trim(), end: !!j.end };
  } catch {
    return { speaker: "", text: raw.trim(), end: true };
  }
}

async function generateWorld({ topic }) {
  const m = loadSelfMirror();
  const base = m ? `主世界的他的真实画像(JSON)：\n${JSON.stringify(m)}\n\n` : "";
  const prompt = `${base}请基于「主世界的他」，虚构一个**平行世界的他**——在某个他真实可能走过的人生岔路上分叉出去的版本。给它一个世界编号、一段经历、以及由经历长出的性格。要贴着他的底色（他可能真会走的路、说话的腔调），但活出一条不同的取舍。${topic ? `这个世界要特别能就「${topic}」给他一个他自己想不到的视角。` : ""}
严格输出 JSON，无别的：
{"worldId":"如 C-42","nameEn":"英文别名","nameZh":"如『没放弃画画的我』","backstory":"2-3句经历","resonance":0到100的数字,"utilityTitle":"它在乎/优化什么","utilityDesc":"一句","timeHorizon":"时间视野","timeHorizonDesc":"一句","catchphrase":"一句口头禅","voiceTags":["3个性格词"],"avatar":"crystal|pyramid|heart|hourglass|orb 之一","accent":"6位hex如#7ad0ff"}`;
  return parseJson(await runClaude(prompt, "claude-sonnet-4-6"));
}

async function converge({ cards, history, topic }) {
  const roster = (cards || []).map((c) => `${c.nameZh}（在乎：${c.utilityTitle || ""}）`).join("、");
  const prompt = `下面是某人(他)内心几个『平行世界的我』围绕一个问题的辩论。请你以「主宇宙的他」——那个真要承担后果、做决定的本人——的身份，把这场辩论**收敛**成他一直在回避的那个取舍。
不要投票选某个世界、不要和稀泥。点出：真正的选择不是『谁对』，而是『哪一种损失他能承受』。简短、有力、戳心，2-4 句，中文，第二人称对他说。
${topic ? `议题：${topic}\n` : ""}上场的世界：${roster}

【辩论】
${historyText(history)}

主宇宙的我，收敛：`;
  const text = (await runClaude(prompt, null)).trim();
  return { crux: text };
}

// ----- 公众号飞轮：把一场会谈综合成主宇宙口吻的文章 -----
async function article({ topic, messages }) {
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
  return { article: (await runClaude(prompt, null)).trim() };
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
async function refineCard({ card, corrections }) {
  const prompt = `下面是一张「角色卡」(JSON) 和用户对它的纠正。请根据纠正**精修这张卡**——改掉不准的、强化用户认可的，**保持 JSON 字段结构不变**（只改内容值）。证据不足处保守，别瞎编。直接输出修订后的严格 JSON，无别的。

【原卡】
${JSON.stringify(card)}

【用户的纠正】
${(corrections || []).map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
  return parseJson(await runClaude(prompt, null));
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
