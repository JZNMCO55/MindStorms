#!/usr/bin/env node
/**
 * Distill a `self_mirror` card from a folder of cleaned corpus (.md) files.
 *
 *   node scripts/distill_self_mirror.mjs --in <clean_md_dir> [--out cards/self_mirror.json] [--model sonnet]
 *
 * Reuses Claude Code under the user's subscription instead of a metered API key —
 * it spawns the `claude` CLI in headless print mode with ANTHROPIC_API_KEY blanked,
 * exactly like agentara's ClaudeAgentRunner. No API key required.
 *
 * This is the offline prototype of the v0 "magic moment". The same spawn logic
 * will be ported into the Tauri Rust backend later (std::process::Command).
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const inDir = arg("in", null);
const outFile = arg("out", "cards/self_mirror.json");
const model = arg("model", null); // null => inherit Claude Code default (Opus)

if (!inDir) {
  console.error("Usage: node scripts/distill_self_mirror.mjs --in <clean_md_dir> [--out ...] [--model ...]");
  process.exit(1);
}

// ---- gather corpus ---------------------------------------------------------
const files = readdirSync(inDir).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) {
  console.error(`No .md files in ${inDir}. Run clean_wechat_html.py first.`);
  process.exit(1);
}
const corpus = files
  .map((f) => readFileSync(join(inDir, f), "utf8").trim())
  .join("\n\n---\n\n");
console.log(`Corpus: ${files.length} articles, ${corpus.length} chars`);

// ---- build the distillation prompt ----------------------------------------
const prompt = `你是一个"自我蒸馏"引擎。下面是某人写的全部公众号文章。请仔细阅读，提炼出"镜子里的我"——这个人最高保真的自我画像。它将用于一个**只问不答、用苏格拉底式提问引导他本人思考**的角色。

硬性要求：
- 只依据文本证据，绝不编造；证据不足的字段宁可留空数组。
- grounding 必须是**逐字摘录**的原话（不要改写、不要加引号外的内容）。
- 直接输出**严格的 JSON**，不要任何解释文字、不要 markdown 代码块。

JSON 结构（键名照抄）：
{
  "name": "镜子里的我",
  "source": "self_mirror",
  "fidelity": "high",
  "voice": "说话风格与口头禅的概括（一两句）",
  "values": ["他在乎什么"],
  "fears": ["典型的恐惧/焦虑/逃避"],
  "decisionHabits": ["决策与思维习惯"],
  "catchphrases": ["反复出现的口头禅，逐字"],
  "grounding": ["逐字原话1", "逐字原话2", "逐字原话3"],
  "utility": "在镜子模式里这个自我优化什么（把他自己的答案引导出来，而不是替他回答）",
  "questionsItWouldAsk": ["它会这样反问你……（3-5 条，贴合此人语气与他真实关心的议题）"],
  "provenanceLabel": "蒸馏自你的 ${files.length} 篇公众号文章",
  "publishPolicy": "freely"
}

==== 文章开始 ====
${corpus}
==== 文章结束 ====`;

// ---- spawn claude (subscription auth) -------------------------------------
const isWin = process.platform === "win32";
const cliArgs = ["-p", "--output-format", "json", ...(model ? ["--model", model] : [])];
const cmd = isWin ? "cmd.exe" : "claude";
const spawnArgs = isWin ? ["/c", "claude", ...cliArgs] : cliArgs;

console.log(`Spawning: claude ${cliArgs.join(" ")} (model: ${model ?? "default"})`);

const proc = spawn(cmd, spawnArgs, {
  env: { ...process.env, ANTHROPIC_API_KEY: "" }, // blank => use subscription
});

let stdout = "";
let stderr = "";
proc.stdout.on("data", (d) => (stdout += d));
proc.stderr.on("data", (d) => (stderr += d));
proc.stdin.write(prompt);
proc.stdin.end();

proc.on("close", (code) => {
  if (code !== 0) {
    console.error(`claude exited with code ${code}`);
    if (stderr.trim()) console.error("stderr:\n" + stderr.trim().slice(0, 2000));
    if (stdout.trim()) console.error("stdout:\n" + stdout.trim().slice(0, 2000));
    process.exit(1);
  }

  // outer wrapper from --output-format json
  let resultText;
  try {
    resultText = JSON.parse(stdout).result;
  } catch {
    console.error("Could not parse claude JSON wrapper. Raw head:\n" + stdout.slice(0, 1500));
    process.exit(1);
  }

  // strip ```json fences if the model added them, then parse the card
  const jsonText = resultText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let card;
  try {
    card = JSON.parse(jsonText);
  } catch {
    console.error("Model output was not valid JSON. Got:\n" + resultText.slice(0, 2000));
    process.exit(1);
  }

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(card, null, 2) + "\n", "utf8");

  console.log("\n===== 镜子里的我（蒸馏结果）=====\n");
  console.log(JSON.stringify(card, null, 2));
  console.log(`\nSaved -> ${outFile}`);
});
