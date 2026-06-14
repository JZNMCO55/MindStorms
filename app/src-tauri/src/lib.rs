use std::io::Write as _;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ---------- 路径（app 数据目录，可移植）----------
fn data_dir(app: &AppHandle) -> PathBuf {
    let d = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    std::fs::create_dir_all(&d).ok();
    d
}
fn self_mirror_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("self_mirror_main.json")
}
fn state_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("app_state.json")
}
fn drafts_dir(app: &AppHandle) -> PathBuf {
    let d = data_dir(app).join("drafts");
    std::fs::create_dir_all(&d).ok();
    d
}
fn self_mirror(app: &AppHandle) -> Option<Value> {
    std::fs::read_to_string(self_mirror_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

// ---------- 调 claude（订阅鉴权）----------
fn run_claude(prompt: String, model: Option<String>) -> Result<String, String> {
    // claude 的 npm 垫片其实指向一个真正的 exe；直接调它，绕开 cmd.exe + .cmd 批处理
    // + PATH 依赖 + 无控制台时 stdin 经批处理转发的种种坑（GUI 双击启动最易踩）。
    let claude_exe = [
        std::env::var("APPDATA").ok().map(|d| {
            format!("{}\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe", d)
        }),
        std::env::var("USERPROFILE").ok().map(|d| format!("{}\\.local\\bin\\claude.exe", d)),
    ]
    .into_iter()
    .flatten()
    .find(|p| std::path::Path::new(p).exists());

    // 兜底：找不到 exe 时回退 cmd.exe /c claude，得补好 PATH 才能定位 claude.cmd。
    let mut path = std::env::var("PATH").unwrap_or_default();
    for extra in [
        std::env::var("APPDATA").ok().map(|d| format!("{}\\npm", d)),
        std::env::var("USERPROFILE").ok().map(|d| format!("{}\\.local\\bin", d)),
    ]
    .into_iter()
    .flatten()
    {
        if !path.split(';').any(|p| p.eq_ignore_ascii_case(&extra)) {
            path = format!("{};{}", extra, path);
        }
    }

    let mut claude_args: Vec<String> = vec!["-p".into(), "--output-format".into(), "json".into()];
    if let Some(m) = &model {
        claude_args.push("--model".into());
        claude_args.push(m.clone());
    }

    let mut cmd = match &claude_exe {
        Some(exe) => {
            let mut c = Command::new(exe);
            c.args(&claude_args);
            c
        }
        None => {
            let mut c = Command::new("cmd.exe");
            c.arg("/c").arg("claude").args(&claude_args);
            c
        }
    };
    cmd.env("ANTHROPIC_API_KEY", "")
        .env("PATH", &path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        std::thread::spawn(move || {
            let _ = stdin.write_all(prompt.as_bytes());
        });
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let so = String::from_utf8_lossy(&out.stdout);
    let se = String::from_utf8_lossy(&out.stderr);
    // 调试落盘：每次调用都记 exit/stdout/stderr/PATH 头，便于无 UI 排查
    if let Ok(appdata) = std::env::var("APPDATA") {
        let logp = format!("{}\\com.mindstorms.app\\claude_debug.log", appdata);
        let line = format!(
            "[exit={:?}] exe={}\n  stdout: {}\n  stderr: {}\n----\n",
            out.status.code(),
            claude_exe.as_deref().unwrap_or("cmd/c claude"),
            so.chars().take(500).collect::<String>(),
            se.chars().take(500).collect::<String>(),
        );
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&logp) {
            let _ = f.write_all(line.as_bytes());
        }
    }
    if !out.status.success() {
        let s: String = format!("{} {}", se.trim(), so.trim()).trim().chars().take(220).collect();
        return Err(format!("claude exit {:?}：{}", out.status.code(), s));
    }
    let v: Value = serde_json::from_str(&so).map_err(|e| e.to_string())?;
    Ok(v.get("result").and_then(|r| r.as_str()).unwrap_or("").to_string())
}

fn parse_loose(raw: &str) -> Option<Value> {
    let mut t = raw.trim();
    if let Some(s) = t.strip_prefix("```json") {
        t = s.trim();
    } else if let Some(s) = t.strip_prefix("```") {
        t = s.trim();
    }
    if let Some(s) = t.strip_suffix("```") {
        t = s.trim();
    }
    serde_json::from_str(t).ok()
}

fn history_text(history: &Value) -> String {
    match history.as_array() {
        Some(arr) => arr
            .iter()
            .map(|h| {
                let role = h.get("role").and_then(|r| r.as_str()).unwrap_or("");
                let who = if role == "user" {
                    "他".to_string()
                } else {
                    h.get("cardName").and_then(|c| c.as_str()).unwrap_or("议会").to_string()
                };
                let text = h.get("text").and_then(|t| t.as_str()).unwrap_or("");
                format!("{}：{}", who, text)
            })
            .collect::<Vec<_>>()
            .join("\n"),
        None => String::new(),
    }
}
fn hist_or(history: &Value, fallback: &str) -> String {
    let h = history_text(history);
    if h.is_empty() { fallback.to_string() } else { h }
}
fn backdrop(app: &AppHandle) -> String {
    match self_mirror(app) {
        Some(m) => {
            let summary = m.get("summary").and_then(|s| s.as_str()).unwrap_or("");
            let cps = m
                .get("catchphrases")
                .and_then(|c| c.as_array())
                .map(|a| a.iter().take(4).filter_map(|x| x.as_str()).collect::<Vec<_>>().join("、"))
                .unwrap_or_default();
            format!("主世界的他的底色（贴着写，别照抄）：{}｜口头禅：{}\n", summary, cps)
        }
        None => String::new(),
    }
}
fn str_at<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("")
}

// ---------- commands ----------
#[tauri::command]
async fn load_self_mirror(app: AppHandle) -> Option<Value> {
    self_mirror(&app)
}

#[tauri::command]
async fn load_state(app: AppHandle) -> Option<Value> {
    std::fs::read_to_string(state_path(&app)).ok().and_then(|s| serde_json::from_str(&s).ok())
}

#[tauri::command]
async fn save_state(app: AppHandle, state: Value) -> Result<(), String> {
    std::fs::write(state_path(&app), serde_json::to_string(&state).unwrap_or_default()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn chat(app: AppHandle, mode: String, cards: Value, history: Value, input: String) -> Result<Value, String> {
    if mode == "mirror" {
        let m = self_mirror(&app).ok_or("self_mirror 未蒸馏")?;
        let prompt = format!(
            "你是「镜子里的我」——他本人最高保真的内在镜子，由他全部语料蒸出来。下面是他的画像(JSON)，里面有他的经历、关系、原话、在怕什么、在逃避什么：\n{m}\n\n你的任务不是审问他，是帮他启发和挖掘——把他自己没照见的东西照出来，再让他自己说出那层意义。你最大的优势是你真的了解他（画像里有大量他真实的经历和原话）。所以每次回应，先做下面至少一件事，再落到一个往深一层的问题（别每次都只是干问）：\n- 照见模式：点出你注意到的规律（\"你每次提到X，后面其实都跟着Y\"），说成你的观察，让他确认或反驳。\n- 举他自己的例子：从画像/他的经历里拈一件具体的事当镜子（\"比如你…那次，是不是也…\"），用他熟悉的材料启发他，别讲空道理。\n- 试探性猜测：不确定地抛个假设（\"我猜你怕的其实不是A，是B？\"），请他来修正。\n- 偶尔先共情一句，别像查户口。\n\n底线（重要）：你可以观察、举例、猜测、共情，但最终的结论和决定必须让他自己说——别替他下判断、别给行动建议、别说教。你是一个很懂他、陪他一层层往下挖的自己，不是人生导师。\n紧扣他刚说的这件事往深挖（可调用画像里相关的经历），别跳到无关主题。\n2-4 句，中文口语，带他的腔调（可偶尔用他的语气词，但别堆口头禅）。\n\n【对话历史】\n{h}\n\n【他刚说】{input}\n\n镜子里的我，回他（先照见/举例/猜测，再问一句往深挖）：",
            m = m, h = hist_or(&history, "（刚开始）"), input = input
        );
        let raw = tauri::async_runtime::spawn_blocking(move || run_claude(prompt, Some("claude-sonnet-4-6".into())))
            .await.map_err(|e| e.to_string())??;
        Ok(json!({ "replies": [ { "cardName": "镜子里的我", "text": raw.trim() } ] }))
    } else {
        let roster = cards.as_array().map(|a| a.iter().map(|c| {
            format!("- {}（世界#{}）：{}｜在乎：{}｜口头禅：{}",
                str_at(c, "nameZh"), str_at(c, "worldId"), str_at(c, "backstory"), str_at(c, "utilityTitle"), str_at(c, "catchphrase"))
        }).collect::<Vec<_>>().join("\n")).unwrap_or_default();
        let goal = if mode == "exploration" {
            "这是探索模式：发散、互相激发，不急着收敛，可以越聊越开。"
        } else {
            "这是决策模式：各自从自己那条人生路的视角表态、可以互相反驳。"
        };
        let prompt = format!(
            "这是某人内心的「平行世界议会」——上场的都是从主世界的他分叉出去的『平行世界的我』。{goal}\n{bd}上场角色：\n{roster}\n\n【对话历史】\n{h}\n\n【他抛出】{input}\n\n让每个上场角色各发一言：既像他本人（贴他的腔调），又活出各自那条路的取舍；可互相回应；1-3 句，中文口语。\n严格输出 JSON 数组，无别的：[{{\"cardName\":\"角色的中文名\",\"text\":\"发言\"}}]",
            goal = goal, bd = backdrop(&app), roster = roster, h = hist_or(&history, "（刚开始）"), input = input
        );
        let raw = tauri::async_runtime::spawn_blocking(move || run_claude(prompt, Some("claude-sonnet-4-6".into())))
            .await.map_err(|e| e.to_string())??;
        let replies = parse_loose(&raw).unwrap_or_else(|| json!([{ "cardName": "议会", "text": raw.trim() }]));
        Ok(json!({ "replies": replies }))
    }
}

#[tauri::command]
async fn speak(app: AppHandle, mode: String, cards: Value, speaker: Value, history: Value) -> Result<Value, String> {
    let sp_id = str_at(&speaker, "id");
    let others = cards
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|c| str_at(c, "id") != sp_id)
                .map(|c| format!("{}（世界#{}）", str_at(c, "nameZh"), str_at(c, "worldId")))
                .collect::<Vec<_>>()
                .join("、")
        })
        .unwrap_or_default();
    let goal = if mode == "exploration" {
        "这是探索模式：发散、互相激发、敢抬杠脑暴，不急着收敛。"
    } else {
        "这是决策模式：各自从自己那条人生路的视角表态、敢于互相反驳。"
    };
    let last_is_user = history
        .as_array()
        .and_then(|a| a.last())
        .map(|h| h.get("role").and_then(|r| r.as_str()) == Some("user"))
        .unwrap_or(true);
    let floor = if last_is_user {
        "你是这轮第一个开口的，直接回应他抛出的问题、亮出你这条路的态度，给后面的人留个话头。"
    } else {
        "前面已经有人发言了——你要接住或反驳他们（可点名，比如『读博的我说得轻巧，但…』『+1，不过…』），别重复、别各说各的。"
    };
    let said = history_text(&history);
    let prompt = format!(
        "这是某人内心的「平行世界议会」圆桌讨论。{goal}\n{bd}在场的还有：{others}\n现在轮到「{name}（世界#{world}）」发言。\n你的经历：{back}｜你在乎：{util}｜口头禅：{cp}\n\n【现场已经说到这儿】\n{said}\n\n以「{name}」的身份说一句话：\n- 你是从主世界的他分叉出去的这一版人生，带着那条路的取舍和腔调，像他本人在说话。\n- 关键：这是讨论，不是各自答题。{floor}\n- 1-3 句，中文口语，像在现场插话。只输出你这句话本身，不要前缀、不要引号、不要 JSON。",
        goal = goal,
        bd = backdrop(&app),
        others = if others.is_empty() { "（只有你）".to_string() } else { others },
        name = str_at(&speaker, "nameZh"),
        world = str_at(&speaker, "worldId"),
        back = str_at(&speaker, "backstory"),
        util = str_at(&speaker, "utilityTitle"),
        cp = str_at(&speaker, "catchphrase"),
        said = if said.is_empty() { "（还没人开口）".to_string() } else { said },
        floor = floor,
    );
    let raw = tauri::async_runtime::spawn_blocking(move || run_claude(prompt, Some("claude-sonnet-4-6".into())))
        .await
        .map_err(|e| e.to_string())??;
    Ok(json!({ "reply": raw.trim() }))
}

#[tauri::command]
async fn beat(app: AppHandle, mode: String, cards: Value, history: Value) -> Result<Value, String> {
    let roster = cards
        .as_array()
        .map(|a| {
            a.iter()
                .map(|c| {
                    format!(
                        "- {}（世界#{}）：{}｜在乎：{}｜腔调参考（别照搬念出来）：{}",
                        str_at(c, "nameZh"), str_at(c, "worldId"), str_at(c, "backstory"),
                        str_at(c, "utilityTitle"), str_at(c, "catchphrase")
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    let vibe = if mode == "exploration" {
        "气氛是探索/脑暴，可以发散、跑题、互相点火"
    } else {
        "气氛是帮他做决定，几个'我'各执一端、敢呛敢戳"
    };
    let prompt = format!(
        "这是某人(他)脑子里的「平行世界议会」——几个平行世界的他在群聊（不是辩论赛、不是排队发言）。{vibe}。\n{bd}在场的角色：\n{roster}\n\n看下面的群聊记录，判断【此刻谁最可能忍不住开口】——基于谁被戳到了、谁对刚才的话有强烈反应、谁憋了别的话想说，让那一个人说一句。\n像真群聊那样，别做作：\n- 不是每个人都要发言。只让此刻最有冲动的那一个开口；可以是刚说完又被怼回来的人，也可以是一直没吭声突然插话的人。\n- 他可以：反驳、附和补刀、跑题、突然感性、直接反问他本人、或岔开话题。绝对不要每句都\"引用上一个人+但是\"那种排比，太假。\n- 口头禅/腔调只是帮你找语气，绝对别把它原样塞进句子里（更别硬拼成病句，比如把\"格局，赌的是未来\"塞成\"格局赌的是第一段\"）——像真人那样自然说话，一场里顶多偶尔冒一次半次。\n- 别每句都是金句/专家腔。可以有迟疑、情绪、自我怀疑、半句话、\"我也说不准，但…\"，像自己跟自己嘀咕，不是站台给人讲课。\n- 长度随意：可以只甩一句，也可以两三句。中文口语，像他本人。\n- 如果已经聊得差不多、该让他（主人公）接话了，就把 end 设成 true。\n\n【群聊记录】\n{hist}\n\n严格输出 JSON，无别的：{{\"speaker\":\"开口者的中文名（必须是在场角色之一）\",\"text\":\"他这一句\",\"end\":true或false}}",
        vibe = vibe, bd = backdrop(&app), roster = roster, hist = history_text(&history)
    );
    let raw = tauri::async_runtime::spawn_blocking(move || run_claude(prompt, Some("claude-sonnet-4-6".into())))
        .await
        .map_err(|e| e.to_string())??;
    match parse_loose(&raw) {
        Some(j) => Ok(json!({
            "speaker": j.get("speaker").and_then(|x| x.as_str()).unwrap_or(""),
            "text": j.get("text").and_then(|x| x.as_str()).unwrap_or("").trim(),
            "end": j.get("end").and_then(|x| x.as_bool()).unwrap_or(false),
        })),
        None => Ok(json!({ "speaker": "", "text": raw.trim(), "end": true })),
    }
}

#[tauri::command]
async fn generate_world(app: AppHandle, topic: Option<String>) -> Result<Value, String> {
    let base = match self_mirror(&app) {
        Some(m) => format!("主世界的他的真实画像(JSON)：\n{}\n\n", m),
        None => String::new(),
    };
    let topic_line = match topic {
        Some(t) if !t.is_empty() => format!("这个世界要特别能就「{}」给他一个他自己想不到的视角。", t),
        _ => String::new(),
    };
    let prompt = format!(
        "{base}请基于「主世界的他」，虚构一个平行世界的他——在某个他真实可能走过的人生岔路上分叉出去的版本。给它一个世界编号、一段经历、以及由经历长出的性格。要贴着他的底色，但活出一条不同的取舍。{topic_line}\n严格输出 JSON，无别的：\n{{\"worldId\":\"如 C-42\",\"nameEn\":\"英文别名\",\"nameZh\":\"如『没放弃画画的我』\",\"backstory\":\"2-3句经历\",\"resonance\":0到100的数字,\"utilityTitle\":\"它在乎/优化什么\",\"utilityDesc\":\"一句\",\"timeHorizon\":\"时间视野\",\"timeHorizonDesc\":\"一句\",\"catchphrase\":\"一句口头禅\",\"voiceTags\":[\"3个性格词\"],\"avatar\":\"crystal|pyramid|heart|hourglass|orb 之一\",\"accent\":\"6位hex如#7ad0ff\"}}",
        base = base, topic_line = topic_line
    );
    let raw = tauri::async_runtime::spawn_blocking(move || run_claude(prompt, Some("claude-sonnet-4-6".into())))
        .await.map_err(|e| e.to_string())??;
    parse_loose(&raw).ok_or_else(|| "生成解析失败".to_string())
}

#[tauri::command]
async fn converge(app: AppHandle, cards: Value, history: Value, topic: String) -> Result<Value, String> {
    let _ = &app;
    let roster = cards.as_array().map(|a| a.iter().map(|c| {
        format!("{}（在乎：{}）", str_at(c, "nameZh"), str_at(c, "utilityTitle"))
    }).collect::<Vec<_>>().join("、")).unwrap_or_default();
    let prompt = format!(
        "下面是某人(他)内心几个『平行世界的我』围绕一个问题的辩论。请你以「主宇宙的他」——那个真要承担后果、做决定的本人——的身份，把这场辩论收敛成他一直在回避的那个取舍。\n不要投票选某个世界、不要和稀泥。点出：真正的选择不是『谁对』，而是『哪一种损失他能承受』。简短、有力、戳心，2-4 句，中文，第二人称对他说。\n议题：{topic}\n上场的世界：{roster}\n\n【辩论】\n{h}\n\n主宇宙的我，收敛：",
        topic = topic, roster = roster, h = history_text(&history)
    );
    let raw = tauri::async_runtime::spawn_blocking(move || run_claude(prompt, None)).await.map_err(|e| e.to_string())??;
    Ok(json!({ "crux": raw.trim() }))
}

#[tauri::command]
async fn article(app: AppHandle, topic: String, messages: Value) -> Result<Value, String> {
    let voice = match self_mirror(&app) {
        Some(m) => {
            let v = m.get("voice").and_then(|x| x.as_str()).unwrap_or("");
            let cps = m.get("catchphrases").and_then(|c| c.as_array())
                .map(|a| a.iter().take(6).filter_map(|x| x.as_str()).collect::<Vec<_>>().join("、")).unwrap_or_default();
            format!("语言风格：{}｜口头禅（可点缀，别堆砌）：{}", v, cps)
        }
        None => String::new(),
    };
    let transcript = messages.as_array().map(|a| a.iter().map(|x| {
        let mid = str_at(x, "memberId");
        let who = if mid == "__user__" { "我" } else { x.get("cardName").and_then(|c| c.as_str()).unwrap_or("") };
        format!("{}：{}", who, str_at(x, "text"))
    }).collect::<Vec<_>>().join("\n")).unwrap_or_default();
    let prompt = format!(
        "下面是我内心一场「平行世界议会」围绕「{topic}」的讨论记录。请用主宇宙的我（我本人）的口吻，把它综合成一篇可以发公众号的第一人称随笔。\n要求：\n- 不是对话记录，是一段自我叙述与反思——把各个\"世界的我\"的所思所想化进我的思考里。\n- 贴着我的语言风格。{voice}\n- 开头点题，中间把矛盾摊开，结尾落到那个取舍或一点感悟。500-900 字。\n- 隐私：不出现任何真实人名，需要时泛化成\"一个朋友\"\"家里人\"。\n- 直接输出文章正文（markdown，可有小标题），不要前后缀说明。\n\n【讨论记录】\n{transcript}",
        topic = topic, voice = voice, transcript = transcript
    );
    let raw = tauri::async_runtime::spawn_blocking(move || run_claude(prompt, None)).await.map_err(|e| e.to_string())??;
    Ok(json!({ "article": raw.trim() }))
}

#[tauri::command]
async fn save_article(app: AppHandle, title: String, content: String) -> Result<Value, String> {
    let safe: String = title.chars().filter(|c| !"\\/:*?\"<>|\n".contains(*c)).take(40).collect();
    let safe = if safe.trim().is_empty() { "未命名".to_string() } else { safe };
    let path = drafts_dir(&app).join(format!("{}.md", safe));
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(json!({ "path": path.to_string_lossy() }))
}

#[tauri::command]
async fn refine_card(card: Value, corrections: Vec<String>) -> Result<Value, String> {
    let corr = corrections.iter().enumerate().map(|(i, c)| format!("{}. {}", i + 1, c)).collect::<Vec<_>>().join("\n");
    let prompt = format!(
        "下面是一张「角色卡」(JSON) 和用户对它的纠正。请根据纠正精修这张卡——改掉不准的、强化用户认可的，保持 JSON 字段结构不变（只改内容值）。证据不足处保守，别瞎编。直接输出修订后的严格 JSON，无别的。\n\n【原卡】\n{card}\n\n【用户的纠正】\n{corr}",
        card = card, corr = corr
    );
    let raw = tauri::async_runtime::spawn_blocking(move || run_claude(prompt, None)).await.map_err(|e| e.to_string())??;
    parse_loose(&raw).ok_or_else(|| "精修解析失败".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
                )?;
            }
            // 首次启动：把项目里蒸好的 self_mirror 复制进 app 数据目录（仅本机有源时生效）
            let dst = self_mirror_path(app.handle());
            if !dst.exists() {
                let src = PathBuf::from("E:\\ForStudy\\Project\\MindStorms\\cards\\self_mirror_main.json");
                if src.exists() {
                    std::fs::copy(&src, &dst).ok();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_self_mirror, load_state, save_state, chat, speak, beat,
            generate_world, converge, article, save_article, refine_card
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
