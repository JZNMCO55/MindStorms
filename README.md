# MindStorms

把一个人的思维方式「蒸馏」成多张有性格的**角色卡**,让不同的你、你生命里的人、乃至名人,在同一窗口里依次发言、互相反驳,由「主宇宙的我」收敛成决策建议或一篇可发表的记录。

完整概念见 [`docs/CONCEPT.md`](docs/CONCEPT.md)。

## 仓库结构

```
docs/        概念与设计文档
app/         桌面应用(Tauri + React/TS/Vite;当前 Node 优先,Tauri 外壳待 Rust 装好后接入)
scripts/     离线管线工具(如公众号 HTML 清理器)
corpus/      个人语料(已 gitignore,永不提交)
```

## 运行(当前:Node 后端 + 前端,无需 Rust)

两个进程:

```bash
# 1) 本地后端（spawn claude 走订阅，需本机登录 Claude Code）
node app/server/server.mjs            # 监听 127.0.0.1:8787

# 2) 前端
cd app && npm install && npm run dev  # 打开 http://localhost:1420
```

打开后默认进「和镜子里的我聊聊」——打字，你真实蒸馏出的 `self_mirror` 会苏格拉底式反问你。
`npm run build` 做类型检查 + 打包。

## 原生应用（Tauri，需 Rust）

```bash
cd app
npx tauri dev      # 原生窗口里开发（前端 + Rust 后端，热重载）
npx tauri build    # 出安装包：src-tauri/target/release/bundle/nsis/MindStorms_*_x64-setup.exe
```

原生版里后端是 **Rust**（`src-tauri/src/lib.rs`，直接 spawn `claude` 走订阅），不需要 Node，双击即用。
`self_mirror` 等数据放在 app 数据目录（`%APPDATA%/com.mindstorms.app/`）；首启会从项目 `cards/` 复制一份进去。
前端 `httpBackend` 双模：在 Tauri 里走 `invoke`，浏览器 dev 里走 `fetch`。

## 蒸馏「主世界的我」(语料 → self_mirror)

语料放在 `corpus/`(已 gitignore):微信本人消息 JSON、公众号 `.md`、朋友圈/网易云 `.md`。两步,都复用本机 Claude Code 订阅、无需 API key:

```bash
# 1) 聚合 + 切块（只取你本人的话；按内容哈希命名 → 增量缓存）
python scripts/build_self_corpus.py        # → D:\tools\ms_distill\chunks\<hash>.txt + manifest.json

# 2) map-reduce 蒸馏（map: Sonnet 并行 4，断点续；reduce: Opus 合成）
node scripts/distill_run.mjs               # → cards/self_mirror_main.json + cards/主世界的我.md
```

**增量蒸馏**:块按内容哈希命名,obs 缓存在 `D:\tools\ms_distill\obs\<hash>.json`。语料变动后重跑,只有内容真正变了的块会重新 map,其余直接命中缓存——日志会打印「缓存命中 N，新蒸 M」。

(公众号 HTML→md 另有 `scripts/clean_wechat_html.py`;十年成长轨迹另有 `scripts/distill_growth.mjs`。)

## 待办(对照 CONCEPT.md §12)

- [x] 概念闭合 + 设计文档
- [x] 前端三栏精致 UI(议会花名册·点将 / 辩论流 / 右栏卡片检视;星空玻璃主题、水晶头像、三模式切换;目前 mock 数据)
- [x] 公众号 HTML 清理器 v2(抽标题+日期+正文)
- [x] 蒸馏:语料 → 一张 `self_mirror` 卡(`scripts/distill_self_mirror.mjs`,**spawn claude、走订阅、无需 API key**)
- [x] **镜子模式真对话进 GUI**:`app/server/server.mjs`(spawn claude 走订阅)+ 前端 `httpBackend` 接通,打字→真 self_mirror 苏格拉底反问,UI 端到端验证通过
- [x] **决策/探索模式真辩论**(平行世界扎根真自我)+ **收敛**出「被你回避的取舍」+ **真世界生成**(基于真自我现生成,非模板池);UI 端到端验证通过
- [x] **持久化**(对话/卡存盘,重启不丢)+ **纠错回路**(详情里标"这不是我"→ 精修卡)+ **公众号导出飞轮**(会谈→主宇宙口吻文章,可复制/存草稿)
- [x] **Tauri 原生壳**:Rust 后端(9 个 command,spawn claude,app 数据目录,无黑窗)+ 前端双模(invoke/fetch)+ **打包成 NSIS 安装包**(`MindStorms_x64-setup.exe` ~2MB / 原生 `app.exe` ~9MB);原生窗口已启动验证 ✅
- [ ] 多卡辩论引擎 + 三模式收敛
- [ ] 关系切/名人卡、共享卡库、纠错养成、公众号导出飞轮
