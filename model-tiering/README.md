# dsh-model-tiering

给 DeepSeek Harness 用的分级调度插件：**按任务难度决定这一轮花多少推理强度**，而不是所有任务都烧顶配。

装上之后，Agent 每轮回复的第一行会是一个档位标记，比如 `▸high`；同时会拿到一套“够用就好”的定档规则和省 token 的硬约束。

## 它解决什么

大多数任务不值最高推理档。真正贵的是**每一轮都在用顶配思考**。

本插件把任务分成三档，默认从最低档起步，只有出现具体失败信号才升一档：

| 任务性质 | 标记 |
|---|---|
| 闲聊、一句话问答、简单格式转换 | `▸low` |
| 要办事、要多步、要查要改、拿不准 | `▸high` |
| 不可逆（删/覆盖/部署/发布）、疑难攻坚 | `▸max` |

**档位名不写死**：不同模型支持的档位集合不同（`low/high/max` 是很常见的一种，也有 `default/high/max`、四档、甚至只有两档）。插件按配置里该模型的实际档位现算。

## 安装

### 从 tarball 安装（推荐）

```powershell
$pnpm = "<dsh 运行时>/dependencies/pnpm/bin/pnpm.cjs"
$node = "<dsh 运行时>/dependencies/node/bin/node.exe"
Set-Location "$env:USERPROFILE\.dsh\profiles\desktop"

& $node $pnpm add "file:<路径>/dsh-model-tiering-1.0.0.tgz"
```

然后在 `package.json` 的 `dsh.profile.bundles` 里追加 `"dsh-model-tiering"`，重启 DSH。

装好后在**侧栏 → 插件**里能看到 `dsh-model-tiering`，可以随时关掉。

### 从源码安装

```powershell
& $node $pnpm link "C:/path/to/dsh-model-tiering"
```

## 安装后第一件事：配置你的模型

**这一步不能跳过。** `config/tiers.json` 里的 `models` 是**示例**，用的是作者自己的模型标识，你的环境里大概率不存在。

1. 用 `list_subagent_models` 查你的模型支持哪几档，例如：

   ```
   qwen-token-plan-cn/deepseek-v4.1-flash
   Reasoning efforts: low / high / max
   ```

2. 改 `config/tiers.json`：

   ```json
   "models": {
     "<你的 provider>/<你的 model>": {
       "efforts": ["low", "high", "max"]
     }
   }
   ```

   `efforts` 必须**按从弱到强排序**，插件按位置映射（第 1 个=轻、最后 1 个=高）。

3. 验证：

   ```powershell
   node scripts/tier.mjs selfcheck --expect-efforts "low,high,max"
   ```

   全绿才算配好了。

## 用法

```powershell
node scripts/tier.mjs show          # 看档位映射
node scripts/tier.mjs classify --text "把三个文件合并" --efforts "low,high,max"
node scripts/tier.mjs route high --efforts "low,high,max"
node scripts/tier.mjs emit          # 生成各渠道可粘贴的规则文本
node scripts/tier.mjs selfcheck     # 一次性回归检查
node scripts/tier.mjs budget        # 今日高档余额
```

`classify` 用本地正则判定档位，不调模型、几十毫秒，结果可复现。词表在 `config/tiers.json` 的 `classify` 里，判错了改词即可。

## 两个技能

插件注册两个同名来源的技能：

- `model-tiering` —— 完整规则（定档、升级护栏、记账、成本纪律）
- `model-tiering-quick` —— 只含选档表，用来快速判断这轮标什么

关掉插件，两个技能同时消失。

## 已知边界

- **它不改主会话的推理等级**。主会话用哪个档由界面决定，插件不碰。它管的是“派子代理时带什么 `reasoning_effort`”和“这一轮该按哪档办事”。
- **它不省主会话的上下文**。真正省 token 的是里面那套隔离规则：读文件的活派出去，别灌主线。
- `guard.maxHighPerDay` 只是计数提醒，**脚本不强制拦截**。

## 卸载

见 [ROLLBACK.md](./ROLLBACK.md)。

## License

MIT