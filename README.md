dsh-model-tiering
English | 中文

给 DeepSeek Harness 用的分级调度插件：按任务难度决定这一轮花多少推理强度，而不是所有任务都烧顶配。

装上之后，Agent 每轮回复的第一行会是一个档位标记，比如 ▸high；同时会拿到一套“够用就好”的定档规则和省 token 的硬约束。

仅支持 DeepSeek Harness。核心规则是纯文本，理论上可移植到其他支持 system prompt 的工具，但插件部分（注册、脚本、自检）依赖 DSH。

它解决什么
大多数任务不值最高推理档。真正贵的是每一轮都在用顶配思考——包括"帮我查个文件"这种活。

本插件把任务分成三档，默认从最低档起步，只有出现具体失败信号才升一档：

任务性质	标记
闲聊、一句话问答、简单格式转换	▸low
要办事、要多步、要查要改、拿不准	▸high
不可逆（删/覆盖/部署/发布）、疑难攻坚	▸max
档位名不写死：不同模型支持的档位集合不同（low/high/max 很常见，也有 default/high/max、四档、甚至只有两档）。插件按配置里该模型的实际档位现算，按"最弱 / 居中 / 最强"映射。

设计经过（以及为什么绕了弯）
最初的设计是按难度换模型，实测发现账号通常只有一条模型路由，换不了。真正可调的是推理强度（reasoning_effort）。

接着发现档位名不通用：写死 medium 会被模型直接拒绝，因为很多模型只有 low / high / max。于是改成按模型实际支持的档位动态映射。

这也是本插件不预设档位名的原因。

它到底省什么
说清楚边界，别抱错预期：

项目	效果
速度	明显。低档思考产出的推理内容少得多，而推理是串行生成的，简单活从"干等"变"秒回"
子代理成本	有效。派单时带对应 reasoning_effort，简单活不按顶配跑
主会话 token	不省。主会话用哪个档由界面决定，插件碰不到
主会话上下文	不省。真正省上下文的是配套的隔离规则：读文件、看日志、试错一律派子代理，脏数据不进主线
一句话：省时间和子代理成本，不省主会话 token。

安装
从 tarball 安装（推荐）
powershell


$pnpm = "<dsh 运行时>/dependencies/pnpm/bin/pnpm.cjs"
$node = "<dsh 运行时>/dependencies/node/bin/node.exe"
Set-Location "$env:USERPROFILE\.dsh\profiles\desktop"

& $node $pnpm add "file:<路径>/dsh-model-tiering-1.0.0.tgz"
然后在 package.json 的 dsh.profile.bundles 里追加 "dsh-model-tiering"，重启 DSH。

装好后在侧栏 → 插件里能看到 dsh-model-tiering，可以随时关掉——关掉则两个技能同时消失。

从源码安装
powershell


& $node $pnpm link "C:/path/to/dsh-model-tiering"
安装后第一件事：配置你的模型
这一步不能跳过。 config/tiers.json 里的 models 是模板，写的是 REPLACE-ME/provider，直接跑会映射到不存在的模型。

用 list_subagent_models 查你的模型支持哪几档：

代码块


<你的 provider>/<你的 model>
Reasoning efforts: low / high / max
改 config/tiers.json：

json


"models": {
  "<你的 provider>/<你的 model>": {
    "efforts": ["low", "high", "max"]
  }
}
efforts 必须按从弱到强排序，插件按位置映射（第 1 个 = 轻，最后 1 个 = 高）。

验证：

powershell


node scripts/tier.mjs selfcheck --expect-efforts "low,high,max"
全绿才算配好。

用法
powershell


node scripts/tier.mjs show          # 看档位映射
node scripts/tier.mjs classify --text "把三个文件合并" --efforts "low,high,max"
node scripts/tier.mjs route high --efforts "low,high,max"
node scripts/tier.mjs emit          # 生成各渠道可粘贴的规则文本
node scripts/tier.mjs selfcheck     # 八项回归检查
node scripts/tier.mjs budget        # 今日高档余额
classify 用本地正则判定档位：不调模型、不占上下文、几十毫秒出结果、可复现。词表在 config/tiers.json 的 classify 里，判错了改词即可，不用改代码。

定档顺序
先命中先用，从高到低：

含不可逆动作 → 高
写操作 + 风险词（架构/设计/排查/迁移/重构/并发/性能）→ 高
写操作 + 代码文件或批量 → 高
写操作（单目标、低风险）→ 中
检查/验证类 → 中
只读但要读代码 → 中
风险词但无写操作 → 中
短句/寒暄 → 低
只读问答 → 低
都没命中 → 中（上判，宁可贵一点也别降质）
两个技能
插件注册两个技能：

model-tiering —— 完整规则（定档、升级护栏、记账、成本纪律、隔离规则）
model-tiering-quick —— 只含选档表与标记格式，用来快速判断这轮标什么
已知边界
不改主会话的推理等级：界面控制的，插件不碰
不省主会话上下文：省上下文靠隔离规则，不靠调档
guard.maxHighPerDay 只是计数提醒，脚本不强制拦截
档位名必须来自目标模型，写错会被拒（错误信息是 does not support reasoning effort）
卸载
见 ROLLBACK.md。

License
MIT

dsh-model-tiering
English | 中文

A tiered-effort dispatcher for DeepSeek Harness: decide how much reasoning power each turn deserves, instead of burning maximum effort on everything.

Once installed, the agent prefixes every reply with a tier marker such as ▸high, and gets a "cheap enough is good enough" rule set plus hard token-saving constraints.

DeepSeek Harness only. The rules themselves are plain text and portable to any tool that supports a system prompt, but the plugin wiring (registration, scripts, self-check) is DSH-specific.

The problem
Most tasks do not deserve the highest reasoning tier. What actually costs money is thinking at maximum effort on every single turn — including "look up a file for me".

The plugin sorts work into three tiers, always starting at the lowest and escalating only on concrete failure signals:

Kind of work	Marker
Small talk, single-question lookups, trivial format conversion	▸low
Real work: multi-step, read-then-change, anything uncertain	▸high
Irreversible (delete / overwrite / deploy / publish), hard debugging	▸max
Tier names are not hard-coded. Different models advertise different effort sets — low/high/max is common, but default/high/max, four-tier, or only two also exist. The plugin maps "weakest / middle / strongest" onto whatever the configured model actually supports.

How it got here
The first design switched models by difficulty. Testing showed most accounts expose a single model route, so that was a dead end. What is actually adjustable is reasoning effort.

That in turn revealed another trap: hard-coding medium gets rejected outright, because many models only offer low / high / max. So the mapping became dynamic, driven by the model's real effort list.

That is why the plugin never assumes tier names.

What it actually saves
Stated plainly, so expectations are right:

Area	Effect
Latency	Significant. Low effort emits far less reasoning text, and reasoning is generated serially — simple tasks go from "wait" to "instant"
Subagent cost	Real. Delegated work carries the matching reasoning_effort instead of always running at maximum
Main-session tokens	No saving. The main session's effort is chosen in the UI; the plugin cannot touch it
Main-session context	No saving. Context is saved by the companion isolation rules — file reads, log inspection and trial-and-error are delegated, so noise never enters the main thread
In one line: saves time and subagent cost, not main-session tokens.

Install
From tarball (recommended)
powershell


$pnpm = "<dsh runtime>/dependencies/pnpm/bin/pnpm.cjs"
$node = "<dsh runtime>/dependencies/node/bin/node.exe"
Set-Location "$env:USERPROFILE\.dsh\profiles\desktop"

& $node $pnpm add "file:<path>/dsh-model-tiering-1.0.0.tgz"
Then append "dsh-model-tiering" to dsh.profile.bundles in package.json and restart DSH.

It appears under sidebar → Plugins, and can be toggled off at any time — disabling it removes both skills at once.

From source
powershell


& $node $pnpm link "C:/path/to/dsh-model-tiering"
First thing after installing: configure your model
Do not skip this. The models block in config/tiers.json ships as a template (REPLACE-ME/provider); an unmodified copy maps to a model that does not exist.

Ask list_subagent_models what your model supports:

代码块


<your provider>/<your model>
Reasoning efforts: low / high / max
Edit config/tiers.json:

json


"models": {
  "<your provider>/<your model>": {
    "efforts": ["low", "high", "max"]
  }
}
efforts must be ordered weakest to strongest. The plugin maps by position: first = light, last = high.

Verify:

powershell


node scripts/tier.mjs selfcheck --expect-efforts "low,high,max"
All green means it is configured.

Usage
powershell


node scripts/tier.mjs show          # show the tier mapping
node scripts/tier.mjs classify --text "merge these three files" --efforts "low,high,max"
node scripts/tier.mjs route high --efforts "low,high,max"
node scripts/tier.mjs emit          # generate paste-ready rule text
node scripts/tier.mjs selfcheck     # eight regression checks
node scripts/tier.mjs budget        # remaining high-tier runs today
classify runs a local regex: no model call, no context cost, tens of milliseconds, fully reproducible. The word lists live under classify in config/tiers.json — fix a misclassification by editing words, not code.

Classification order
First match wins, highest first:

Irreversible action → high
Write + risk word (architecture / design / investigate / migrate / refactor / concurrency / performance) → high
Write + code files or batch → high
Write (single target, low risk) → mid
Check / verify phrasing → mid
Read-only but touches code → mid
Risk word without a write → mid
Short phrase / greeting → low
Read-only question → low
Nothing matched → mid (bias upward; better to overspend than redo)
Two skills
model-tiering — full rules (tiering, escalation guardrails, accounting, cost discipline, isolation rules)
model-tiering-quick — tier table and marker format only, for a fast "what do I prefix this turn with"
Known limits
Does not change the main session's reasoning level — that belongs to the UI
Does not save main-session context — that comes from the isolation rules, not from tiering
guard.maxHighPerDay is a counter, not an enforcement gate
Tier names must come from the target model; a wrong name is rejected with does not support reasoning effort
Uninstall
See ROLLBACK.md.

License
MIT
