# 回滚与卸载

本插件（`dsh-model-tiering`）在主机上留下的东西，以及撤销方式。

## 卸载

```powershell
$pnpm = "<dsh 运行时>/dependencies/pnpm/bin/pnpm.cjs"
$node = "<dsh 运行时>/dependencies/node/bin/node.exe"
Set-Location "$env:USERPROFILE\.dsh\profiles\desktop"
& $node $pnpm remove dsh-model-tiering
```

然后从 `package.json` 的 `dsh.profile.bundles` 里删掉 `"dsh-model-tiering"` 一行，**重启 DSH**。

卸载后 `model-tiering` 与 `model-tiering-quick` 两个技能同时消失。

## 只关闭、不卸载

插件页 → 找到 `dsh-model-tiering` → 关闭。

或把 `cordis.patch.yml` 的 `config.enabled` 改成 `false` 后重启。

## 单独撤销全局规则

`AGENTS.md` 不是插件的一部分，是独立文件。若只想停掉“每轮标档位”：

```powershell
Remove-Item "$env:USERPROFILE\.dsh\AGENTS.md"
```

⚠️ 该文件同时承载省 token 硬约束与隔离规则，删除后一并失效。

## 撤销渠道内的档位规则

| 渠道 | 位置 | 做法 |
|---|---|---|
| QQ | `profiles\desktop\cordis.patch.yml` 的 `im-qqbot.groupPrompt` / `directPrompt` | 删掉其中【档位标记】那几行，重启 |
| 微信 | 微信插件设置页的「在场说明 / presenceNote」 | 清空或删掉【档位标记】那段 |

⚠️ 微信的 `presenceNote` 由插件运行时持有并回写，**不要直接改 `state.json`**，改了会被覆盖。只能走设置页。

## 验证恢复干净

```powershell
# 技能不应再出现在目录里
# 插件页不应再有 dsh-model-tiering
# 下面这条应报错说找不到文件
node "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-model-tiering\scripts\tier.mjs" show
```

## 遗留物清理（可选）

本插件开发过程中曾尝试一个已被撤除的实验插件 `model-tier-level`，若目录还在，可一并删除：

```powershell
Remove-Item "$env:USERPROFILE\.dsh\plugins\model-tier-level" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.dsh\plugins\dist\model-tier-level-0.1.0.tgz" -Force -ErrorAction SilentlyContinue
```

它早已不在加载链上，删不删都不影响运行。