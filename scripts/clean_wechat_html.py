#!/usr/bin/env python3
"""Batch-clean saved WeChat 公众号 HTML into plain-text markdown for the distillation corpus.

    python scripts/clean_wechat_html.py --in <html_dir> --out <md_dir>

Extracts each article's title, publish date and main body (#js_content); strips
scripts/styles/comments/tags and WeChat UI chrome (video player, like/share/reward/
comment widgets). Drops the account name and repeated video captions dynamically,
so nothing is ever substring-removed out of authored prose.
"""
import argparse
import glob
import html
import os
import re

# Whole-line UI labels to drop. Matched against isolated lines only.
BOILERPLATE = {
    "已关注", "关注", "重播", "分享视频", "分享", "点赞", "赞", "在看",
    "随便看看", "关闭", "观看更多", "更多", "退出全屏", "切换到竖屏全屏",
    "切换到横屏模式", "继续播放", "播放", "倍速", "全屏", "倍速播放中",
    "超清", "流畅", "您的浏览器不支持 video 标签", "继续观看", "转载",
    "已同步到看一看", "写下你的评论", "视频详情", "预览时标签不可点",
    "名称已清空", "微信扫一扫赞赏作者", "喜欢作者", "其它金额", "赞赏后展示我的头像",
    "作品", "暂无作品", "最低赞赏", "确定", "返回", "赞赏金额", "作者提示",
    "内容剧情演绎，仅供娱乐", "个人观点，仅供参考", "仅供参考", "搜索", "网络结果",
    "搜索「」网络结果", "调整当前正文文字大小", "留言", "暂无留言", "已无更多数据",
    "发消息", "写留言", "写留言:", "微信扫一扫", "微信扫一扫可打开此内容，",
    "关注该公众号", "继续滑动看下一个", "轻触阅读原文", "向上滑动看下一个",
    "继续访问", "取消", "微信公众平台广告规范指引", "知道了", "使用小程序",
    "允许", "分析", "使用完整服务", "推荐", "轻点两下取消赞", "轻点两下取消在看",
    "，轻点两下取消赞", "，轻点两下取消在看", "收藏", "听过", "我知道了",
    "选择留言身份", "确认提交投诉", "视频", "小程序", "你可以补充投诉原因（选填）",
    "当前内容可能存在未经审核的第三方商业营销信息，请确认是否继续访问。",
    "可在「公众号 > 右上角", "> 划线」找到划线过的内容",
    "可在「公众号 > 右上角 > 划线」找到划线过的内容",
    "，时长", "时长", "进度条，百分之0", "0.5倍", "0.75倍", "1.0倍", "1.5倍",
    "2.0倍", "0个朋友", "暂无内容",
}

# Lines fully matching any of these are UI chrome, not prose.
DROP_RE = re.compile(
    r"^(?:"
    r"\d+\s*条留言"          # "1条留言"
    r"|最低赞赏.*"           # "最低赞赏 ¥0"
    r"|\d+(?:\.\d+)?倍"      # "0.5倍"
    r"|进度条.*"
    r"|¥.*"
    r"|\d+个朋友"
    r"|作者提示.*"          # "作者提示: 个人观点，仅供参考"
    r")$"
)

_TAG = re.compile(r"(?s)<[^>]+>")
_SCRIPT = re.compile(r"(?is)<script.*?</script>")
_STYLE = re.compile(r"(?is)<style.*?</style>")
_COMMENT = re.compile(r"(?s)<!--.*?-->")
_PUNCT_ONLY = re.compile(r"^[\s\d:/.%¥×,，。、!！?？·…\-—()（）>：]+$")


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", fragment))).strip()


def clean_one(data: str):
    data = data.replace("​", "")

    title_m = re.search(r'id="activity-name"[^>]*>(.*?)</h1>', data, re.S) or re.search(
        r'rich_media_title[^>]*>(.*?)</h1>', data, re.S
    )
    title = _text(title_m.group(1)) if title_m else ""

    name_m = re.search(r'id="js_name"[^>]*>(.*?)</a>', data, re.S) or re.search(
        r'class="[^"]*profile_nickname[^"]*"[^>]*>(.*?)</', data, re.S
    )
    account = _text(name_m.group(1)) if name_m else ""

    date_m = re.search(r'id="publish[_-]time"[^>]*>([^<]*)<', data)
    date = date_m.group(1).strip() if date_m else ""

    c = re.search(r'id="js_content"[^>]*>', data)
    body = data[c.end():] if c else data
    body = _COMMENT.sub(" ", body)
    body = _SCRIPT.sub(" ", body)
    body = _STYLE.sub(" ", body)
    body = _TAG.sub("\n", body)  # each text node on its own line
    body = html.unescape(body)

    drop = set(BOILERPLATE)
    drop.update(x for x in (account, title, date) if x)

    kept = []
    prev = None
    for raw in body.split("\n"):
        line = re.sub(r"\s+", " ", raw).strip()
        if not line or line in drop or _PUNCT_ONLY.match(line) or DROP_RE.match(line):
            continue
        tokens = line.split(" ")
        if tokens and all(t in drop for t in tokens):
            continue
        if line == prev:  # collapse repeated video captions
            continue
        kept.append(line)
        prev = line

    return title, date, "\n".join(kept)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", required=True)
    ap.add_argument("--out", dest="outdir", required=True)
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    files = sorted(glob.glob(os.path.join(args.indir, "*.html")))
    if not files:
        print(f"No .html files in {args.indir}")
        return

    total = 0
    for f in files:
        data = open(f, encoding="utf-8", errors="ignore").read()
        title, date, text = clean_one(data)
        base = os.path.splitext(os.path.basename(f))[0]
        out = os.path.join(args.outdir, base + ".md")
        header = f"# {title}\n" + (f"\n> {date}\n" if date else "")
        with open(out, "w", encoding="utf-8") as w:
            w.write(f"{header}\n{text}\n")
        print(f"[{len(text):6d} chars] {date or '—':>18}  {title or base}")
        total += 1
    print(f"\nCleaned {total} file(s) -> {args.outdir}")


if __name__ == "__main__":
    main()
