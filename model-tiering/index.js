/**
 * dsh-model-tiering —— 把「按难度定思考档」的 skill 打包成可安装、可开关的插件。
 *
 * 注册两种技能：
 *   1. model-tiering        —— 完整规则（模型可调用）
 *   2. model-tiering-quick  —— 只含标记格式与选档表（模型可调用，用户可调用）
 *
 * 插件关闭 = 两项技能同时消失，规则不再进入任何会话。
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const here = (p) => new URL(p, import.meta.url)

/** 与官方内置 skill 同级：包内提供的技能。 */
const BUNDLED_RANK = 600

export const inject = ['skills']
export const name = 'dsh-model-tiering'

export function apply(ctx, config = {}) {
  if (config.enabled === false) {
    console.log('[dsh-model-tiering] enabled=false，未注册技能')
    return
  }

  const provider = ctx.skills

  // 1) 完整规则
  const full = {
    name: 'model-tiering',
    description:
      '按任务难度自动定思考档（轻/中/高），档位名按当前模型实际支持的 effort 现算、不写死：' +
      '轻活自己干、常规派居中档、攻坚派最强档，靠调推理强度而不是换模型来省 token。含规则化定档、升级护栏与用量记账。',
    provider: 'dsh-model-tiering',
    source: 'bundled',
    rank: BUNDLED_RANK,
    locator: 'skills/model-tiering/SKILL.md',
    invocation: { modelInvocable: true, userInvocable: true }
  }

  // 2) 精简版：只回答「这轮该标什么」
  const quick = {
    name: 'model-tiering-quick',
    description: '快速定档：给出本轮回复第一行该写的档位标记。只含选档表与标记格式，不含完整规则。',
    provider: 'dsh-model-tiering',
    source: 'bundled',
    rank: BUNDLED_RANK,
    locator: 'skills/model-tiering-quick/SKILL.md',
    invocation: { modelInvocable: true, userInvocable: true }
  }

  provider.registerProvider(() => ({
    name: 'dsh-model-tiering',
    list: () => Promise.resolve([full, quick]),
    async get(candidate, options) {
      const file = candidate.locator === quick.locator ? 'skills/model-tiering-quick/SKILL.md' : 'skills/model-tiering/SKILL.md'
      const content = await readFile(here(file), { encoding: 'utf8', signal: options?.signal })
      options?.signal?.throwIfAborted()
      const { rank: _rank, locator: _locator, ...summary } = candidate
      return { ...summary, content }
    }
  }))

  ctx.on('dispose', () => {
    console.log('[dsh-model-tiering] 已卸载，技能随之失效')
  })

  console.log('[dsh-model-tiering] 已注册：model-tiering、model-tiering-quick')
}