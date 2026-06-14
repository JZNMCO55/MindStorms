#!/usr/bin/env node
/**
 * 从朋友圈(2016–2025) + 网易云笔记(2019–2023)蒸出一份「成长轨迹」。
 * 这些黑历史带时间戳、横跨十年，适合看"怎么变的 / 什么没变"。
 * spawn claude 走订阅，单次调用。-> cards/成长轨迹.md
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const root = "E:\\ForStudy\\Project\\MindStorms";
const moments = fs.existsSync(`${root}\\corpus\\微信\\朋友圈\\朋友圈.md`)
  ? fs.readFileSync(`${root}\\corpus\\微信\\朋友圈\\朋友圈.md`, "utf8")
  : "";
const netease = fs.existsSync(`${root}\\corpus\\网易云\\笔记.md`)
  ? fs.readFileSync(`${root}\\corpus\\网易云\\笔记.md`, "utf8")
  : "";

const prompt = `下面是某人（记为 X）2016–2025 年的朋友圈，和 2019–2023 年的网易云笔记——他的"黑历史"，时间跨度近十年。请据此写一份**成长画像**：看 X 这些年怎么变的、什么一直没变。

要求：
- 只依据文本证据；锚点引用逐字原话。
- 中文，贴着他的语气，温度与洞察并重。
- 直接输出 markdown，结构如下：

## 一直没变的内核
（贯穿十年的 4-6 条主线，每条一句概括 + 跨年份的证据）

## 变了的东西
（早年的 X vs 现在的 X，3-5 组对照：心态/表达/在乎的事 怎么挪的）

## 几个标志性时刻
（3-5 个，每个带年份 + 一句逐字原话 + 一句你的解读）

## 写给现在的你
（一段 300-500 字旁白，让现在的他看见过去的他——那个画铅笔画、写黑猫小说、做"无畏开拓者"小车、在朋友圈写孤独哲学、在网易云想着生与死的少年，是怎么一路走到今天这个反内卷、做引擎、盘算 35 岁退休的人的。)

==== 朋友圈 ====
${moments}

==== 网易云笔记 ====
${netease}`;

const proc = spawn("cmd.exe", ["/c", "claude", "-p", "--output-format", "json"], {
  env: { ...process.env, ANTHROPIC_API_KEY: "" },
  cwd: "D:\\tools",
});
let out = "";
proc.stdout.on("data", (d) => (out += d));
proc.stdin.write(prompt);
proc.stdin.end();
proc.on("close", (code) => {
  if (code !== 0) {
    console.error("claude exit", code);
    process.exit(1);
  }
  let text;
  try {
    text = JSON.parse(out).result;
  } catch (e) {
    console.error("parse fail", String(e), out.slice(0, 400));
    process.exit(1);
  }
  fs.mkdirSync(`${root}\\cards`, { recursive: true });
  fs.writeFileSync(`${root}\\cards\\成长轨迹.md`, text.trim() + "\n", "utf8");
  console.log("DONE -> cards/成长轨迹.md (" + text.length + " chars)");
});
