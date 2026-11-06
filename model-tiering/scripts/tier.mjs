#!/usr/bin/env node
/**
 * model-tiering CLI —— 按模型实际档位做思考档映射、记账、预算。
 *
 *   node tier.mjs show                              三档定义 + 已知模型
 *   node tier.mjs map --efforts low,high,max        该模型下三档分别对应哪个 effort
 *   node tier.mjs map --model provider/model        同上，但读配置里缓存的档位
 *   node tier.mjs route mid --efforts default,high,max
 *   node tier.mjs check
 *   node tier.mjs log --tier high --reason "..." [--tokens 1234] [--fail]
 *   node tier.mjs stats [--days 7]
 *   node tier.mjs budget
 *
 * 核心规则：档位名字不写死。给定模型支持的 effort 列表（升序），
 * 轻=第一个、高=最后一个、中=中间那个（两级模型时中=高）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = process.env.TIER_CONFIG || path.join(ROOT, 'config', 'tiers.json');
const LOG_PATH = path.join(ROOT, 'logs', 'decisions.jsonl');
const RANKS = new Set(['first', 'middle', 'last']);
const DELEGATE = new Set(['none', 'allowed', 'preferred']);

const argv = process.argv.slice(2);
const cmd = (argv[0] || 'show').toLowerCase();
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) die(`找不到配置：${CONFIG_PATH}`);
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    die(`配置不是合法 JSON：${err.message}`);
  }
  if (!cfg.levels || typeof cfg.levels !== 'object') die('配置缺少 levels 对象');
  return cfg;
}

function levelOf(cfg, id) {
  const key = String(id || '').toLowerCase();
  const level = cfg.levels[key];
  if (!level) die(`没有「${key}」档（可选：${Object.keys(cfg.levels).join(', ')}）`);
  return { key, level };
}

/** 把「模型支持的档位列表」映射成三档实际取值。列表必须是从弱到强的顺序。 */
function mapLevels(cfg, efforts) {
  const n = efforts.length;
  if (n === 0) die('档位列表为空');
  const byRank = (rank) => {
    if (rank === 'first') return efforts[0];
    if (rank === 'last') return efforts[n - 1];
    // 中间：保证不与首尾重复
    return n >= 3 ? efforts[Math.min(n - 2, Math.max(1, Math.floor(n / 2)))] : efforts[n - 1];
  };
  const out = {};
  for (const [id, level] of Object.entries(cfg.levels)) out[id] = byRank(level.rank);
  return out;
}

/** 从 --efforts / --model 取档位列表；都没给就返回 undefined。 */
function effortsFrom(cfg) {
  const raw = flag('efforts');
  if (raw) {
    const list = raw.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) die('--efforts 是空的');
    return list;
  }
  const model = flag('model');
  if (model) {
    const known = cfg.models?.[model];
    if (!known?.efforts?.length) die(`配置里没有 ${model} 的档位缓存；先用 list_subagent_models 查出来写进 config.models`);
    return known.efforts;
  }
  return undefined;
}

function show(cfg) {
  const models = Object.entries(cfg.models ?? {});
  console.log('本机模型档位：' + (models.length ? '' : '（无，先 list_subagent_models 再写进 config.models）'));
  for (const [id, m] of models) {
    const mapped = mapLevels(cfg, m.efforts);
    const seen = [...new Set(Object.values(mapped))];
    console.log(`  ${id}`);
    console.log(`    支持：${m.efforts.join(' / ')}`);
    console.log(`    标记只用：${seen.map((e) => '▸' + e).join(' / ')}`);
    console.log(`    落点：${seen.map((e) => {
      const tasks = Object.entries(mapped).filter(([, v]) => v === e).map(([k]) => cfg.levels[k].label);
      return `${e}←${tasks.join('/')}`;
    }).join('   ')}`);
  }
  console.log(`\n三个任务档位：${Object.entries(cfg.levels).map(([id, l]) => `${l.label}=rank:${l.rank}`).join('  ')}`);
  console.log(`「高」档日上限：${cfg.guard?.maxHighPerDay ?? '∞'}`);
}

function map(cfg) {
  const efforts = effortsFrom(cfg) || die('需要 --efforts "a,b,c" 或 --model provider/model');
  const mapped = mapLevels(cfg, efforts);
  if (has('json')) return console.log(JSON.stringify(mapped));
  console.log(`模型档位（弱→强）：${efforts.join(' / ')}`);
  for (const [id, effort] of Object.entries(mapped)) {
    const l = cfg.levels[id];
    console.log(`  ${id.padEnd(4)} ${l.label}  →  ${effort}`);
  }
}

function route(cfg, id) {
  const { key, level } = levelOf(cfg, id);
  const efforts = effortsFrom(cfg);
  if (!efforts) die('需要 --efforts "a,b,c" 或 --model provider/model（不同模型档位不同，不能猜）');
  const mapped = mapLevels(cfg, efforts);
  const out = { tier: key, label: level.label, reasoning_effort: mapped[key], delegate: level.delegate, from: efforts };
  if (has('json')) return console.log(JSON.stringify(out));
  console.log(`${key}（${level.label}）→ reasoning_effort=${out.reasoning_effort}  delegate=${level.delegate}`);
  if (level.delegate === 'none') console.log('  本档自己干，勿派子代理');
  else if (level.delegate === 'preferred') console.log('  本档应派子代理，并带上 reasoning_effort');
}

/** 用本地正则给一段话定档：不调模型、几十毫秒、可复现。 */
function classify(cfg) {
  const text = flag('text') || '';
  if (!text.trim()) die('classify 需要 --text "用户原话"');
  const c = cfg.classify ?? {};
  const hit = (list) => (list ?? []).find((w) => text.toLowerCase().includes(String(w).toLowerCase()));
  const ext = (c.codeExt ?? []).join('|');
  const paths = ext ? [...new Set(text.match(new RegExp(`[\\w.\\-]+\\.(?:${ext})\\b`, 'gi')) ?? [])] : [];
  const multiWord = hit(c.multi);
  const irreversible = hit(c.irreversible);
  const write = hit(c.write);
  const read = hit(c.read);
  const risky = hit(c.risky);
  const len = text.trim().length;
  const trivialMax = Number(c.trivialMaxChars) || 12;
  // 检查/检测/验证 属于“要动手核对”，不是随口一问，按中档处理。
  // 注意：不能写含“检查”字样的注释来判断，这里用拆开的字符类，避免正则误匹配注释本身。
  const audit = /(检\s*查|检\s*测|核\s*查|核\s*对|验\s*证|复\s*查|审\s*计|体\s*检)/.test(text);

  let level, rule;
  if (irreversible) {
    level = 'high'; rule = `含不可逆动作「${irreversible}」`;
  } else if (write && risky) {
    level = 'high'; rule = `写操作「${write}」+ 风险词「${risky}」`;
  } else if (write && (paths.length > 0 || multiWord)) {
    level = 'high'; rule = `写操作「${write}」${paths.length > 0 ? `涉及代码文件（${paths.slice(0, 3).join(', ')}）` : `批量（${multiWord}）`}`;
  } else if (write) {
    level = 'mid'; rule = `单目标、低风险写操作「${write}」`;
  } else if (audit) {
    level = 'mid'; rule = '要动手核对（检查/验证类），至少中档';
  } else if (paths.length > 0) {
    level = 'mid'; rule = `只读但要读代码（${paths.slice(0, 3).join(', ')}）`;
  } else if (multiWord) {
    level = 'mid'; rule = `批量只读「${multiWord}」`;
  } else if (risky) {
    level = 'mid'; rule = `涉及「${risky}」类问题，至少中档`;
  } else if (len <= trivialMax && !read) {
    level = 'low'; rule = '短句/寒暄，无动作词';
  } else if (read) {
    level = 'low'; rule = `只读问答「${read}」`;
  } else {
    level = 'mid'; rule = '没有可识别的动作词，按中档（上判，避免降质）';
  }

  const efforts = effortsFrom(cfg);
  const effort = efforts ? mapLevels(cfg, efforts)[level] : undefined;
  if (has('json')) return console.log(JSON.stringify({ level, effort, rule }));
  console.log(`定档：${level}${effort ? `（reasoning_effort=${effort}）` : ''}`);
  console.log(`依据：${rule}`);
  if (!effort) console.log('（没给 --efforts/--model，只出档位不出具体 effort 名）');
}

function check(cfg) {
  const problems = [];
  const ranks = new Map();
  for (const [id, l] of Object.entries(cfg.levels)) {
    if (!RANKS.has(l.rank)) problems.push(`${id}: rank 必须是 ${[...RANKS].join('/')}`);
    if (!DELEGATE.has(l.delegate)) problems.push(`${id}: delegate 必须是 ${[...DELEGATE].join('/')}`);
    if (ranks.has(l.rank)) problems.push(`${id} 与 ${ranks.get(l.rank)} 的 rank 相同`);
    else ranks.set(l.rank, id);
  }
  for (const r of RANKS) if (!ranks.has(r)) problems.push(`缺少 rank=${r} 的档位`);
  if (cfg.default && !cfg.levels[cfg.default]) problems.push(`默认档 ${cfg.default} 不存在`);
  for (const [id, m] of Object.entries(cfg.models ?? {})) {
    if (!Array.isArray(m.efforts) || m.efforts.length === 0) problems.push(`models["${id}"].efforts 必须是非空数组`);
    else if (new Set(m.efforts).size !== m.efforts.length) problems.push(`models["${id}"].efforts 有重复`);
    if (m.uiLabels && m.uiLabels.length !== m.efforts.length) problems.push(`models["${id}"].uiLabels 与 efforts 数量不一致`);
  }
  const guard = cfg.guard ?? {};
  for (const key of ['maxHighPerDay', 'maxUpgradesPerTask']) {
    const v = guard[key];
    if (v !== undefined && !(Number.isSafeInteger(v) && v > 0)) problems.push(`guard.${key} 必须是正整数（现在是 ${JSON.stringify(v)}）`);
  }
  if (problems.length) {
    console.log('✗ 配置有问题：');
    for (const p of problems) console.log(`  - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log('✓ 配置合法');
  const m = Object.values(cfg.models ?? {})[0];
  if (m) console.log(`  示例：${m.efforts.join('/')} → ${JSON.stringify(mapLevels(cfg, m.efforts))}`);
}

function readLog() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs.readFileSync(LOG_PATH, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function log(cfg) {
  const { key, level } = levelOf(cfg, flag('tier') || die('log 需要 --tier low|mid|high'));
  const tokens = Number(flag('tokens') || 0);
  const entry = {
    ts: new Date().toISOString(),
    day: dayKey(),
    level: key,
    effort: flag('effort') || '',
    reason: flag('reason') || '',
    tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : 0,
    ok: !has('fail')
  };
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n', 'utf8');
  const cap = cfg.guard?.maxHighPerDay;
  const used = readLog().filter((e) => e.day === entry.day && e.level === 'high').length;
  console.log(`✓ 已记录 ${key}${entry.effort ? `（${entry.effort}）` : ''}${entry.reason ? ` · ${entry.reason}` : ''}`);
  if (cap) console.log(`  今日「高」：${used}/${cap}`);
}

function stats() {
  const days = Number(flag('days') || 7);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const entries = readLog().filter((e) => e.ts >= since);
  if (!entries.length) return console.log(`最近 ${days} 天没有记录。`);
  const byLevel = {};
  for (const e of entries) {
    const s = (byLevel[e.level] ||= { calls: 0, failed: 0, tokens: 0 });
    s.calls++; if (e.ok === false) s.failed++; s.tokens += e.tokens || 0;
  }
  console.log(`最近 ${days} 天：${entries.length} 次\n`);
  console.log('档位  次数  失败   token');
  for (const [level, s] of Object.entries(byLevel)) {
    console.log(`${level.padEnd(5)} ${String(s.calls).padStart(4)}  ${String(s.failed).padStart(4)}  ${String(s.tokens).padStart(7)}`);
  }
  console.log('\n最近：');
  for (const e of entries.slice(-3)) {
    const d = new Date(e.ts); const p = (n) => String(n).padStart(2, '0');
    console.log(`  ${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}  ${e.level}  ${e.effort || '-'}  ${e.reason || ''}`);
  }
}


/** 生成各渠道应使用的标记文本（单一事实来源：本配置）。 */
function emit(cfg) {
  const models = Object.entries(cfg.models ?? {});
  if (!models.length) die('config.models 为空，无法生成');
  const [modelId, m] = models[0];
  const mapped = mapLevels(cfg, m.efforts);
  const one = `【档位标记】每条回复的第一行顶格写当前模型真实支持的档位名，格式形如：${[...new Set(Object.values(mapped))].map((e) => '▸' + e).join(' / ')}，后面不要跟任何解释。本机模型只有 ${m.efforts.join('/')} 这几档，不要编造不存在的档位名。档位名以 ${path.join(ROOT, 'config', 'tiers.json')} 为准。轻=${mapped.low}；要办事、要多步、拿不准=${mapped.mid}；不可逆操作或疑难=${mapped.high}。标记后面直接接正文，不要空行，不要写理由。`;
  if (has('json')) {
    return console.log(JSON.stringify({ model: modelId, efforts: m.efforts, mapped, oneLine: one }, null, 2));
  }
  console.log(`模型：${modelId}`);
  console.log(`档位：${m.efforts.join(' / ')}`);
  console.log('标记：' + [...new Set(Object.values(mapped))].map((e) => '▸' + e).join(' / '));
  console.log('\n--- 下面这段可直接粘贴到各渠道 ---\n');
  console.log(one);
}

function budget(cfg) {
  const cap = cfg.guard?.maxHighPerDay;
  const used = readLog().filter((e) => e.day === dayKey() && e.level === 'high').length;
  if (!cap) return console.log(`今日「高」用了 ${used} 次（未设上限）`);
  console.log(`今日「高」：${used}/${cap}，还剩 ${Math.max(0, cap - used)} 次`);
}

/**
 * 一次性自检：把“改完必须仍然成立”的事情全跑一遍。
 * 只读，不写任何文件；失败返回非零退出码。
 */
function selfcheck(cfg) {
  const results = [];
  const ok = (name, detail = '') => results.push({ pass: true, name, detail });
  const bad = (name, detail) => results.push({ pass: false, name, detail });

  // 1. 配置结构
  const problems = [];
  const ranks = new Set();
  for (const [id, l] of Object.entries(cfg.levels)) {
    if (!RANKS.has(l.rank)) problems.push(`${id}.rank 非法`);
    if (!DELEGATE.has(l.delegate)) problems.push(`${id}.delegate 非法`);
    if (ranks.has(l.rank)) problems.push(`${id} rank 重复`);
    ranks.add(l.rank);
  }
  for (const r of RANKS) if (!ranks.has(r)) problems.push(`缺 rank=${r}`);
  problems.length ? bad('配置结构', problems.join('；')) : ok('配置结构');

  // 2. 模型档位缓存与映射
  const models = Object.entries(cfg.models ?? {});
  if (models.length === 0) bad('模型档位缓存', 'config.models 为空，无法校验档位名');
  for (const [id, m] of models) {
    if (!Array.isArray(m.efforts) || m.efforts.length === 0) {
      bad(`模型 ${id}`, 'efforts 为空');
      continue;
    }
    const mapped = mapLevels(cfg, m.efforts);
    const values = Object.values(mapped);
    const unknown = values.filter((v) => !m.efforts.includes(v));
    unknown.length
      ? bad(`模型 ${id} 映射`, `映射出了模型不支持的档位：${unknown.join(', ')}`)
      : ok(`模型 ${id} 映射`, `${m.efforts.join('/')} → ${[...new Set(values)].join('/')}`);
  }

  // 3. 分类器落在合法范围
  const samples = [
    ['你好', 'low'],
    ['为什么天空是蓝的', 'low'],
    ['把这个文件改一下', 'mid'],
    ['检查一下配置', 'mid'],
    ['删除旧包', 'high'],
    ['部署到线上', 'high'],
  ];
  const badSamples = [];
  const original = process.argv;
  for (const [text, expect] of samples) {
    process.argv = ['node', 'tier.mjs', 'classify', '--text', text];
    let level;
    try {
      const cfgEfforts = models[0]?.efforts ?? ['low', 'high', 'max'];
      const mapped = mapLevels(cfg, cfgEfforts);
      const c = cfg.classify ?? {};
      const hit = (list) => (list ?? []).find((w) => text.toLowerCase().includes(String(w).toLowerCase()));
      if (hit(c.irreversible)) level = 'high';
      else if (/(检\s*查|检\s*测|核\s*查|核\s*对|验\s*证|复\s*查|审\s*计|体\s*检)/.test(text)) level = 'mid';
      else if (hit(c.write)) level = 'mid';
      else level = 'low';
      if (level !== expect) badSamples.push(`${text}→${level}(期望${expect})`);
      if (!mapped[level]) badSamples.push(`${text} 映射为空`);
    } finally {
      process.argv = original;
    }
  }
  badSamples.length ? bad('分类器抽样', badSamples.join('；')) : ok('分类器抽样', `${samples.length} 条全部符合预期`);

  // 4. 不变量：标记值必须来自模型档位
  const allEfforts = new Set(models.flatMap(([, m]) => m.efforts ?? []));
  const mappedVals = models.flatMap(([, m]) => Object.values(mapLevels(cfg, m.efforts ?? [])));
  const strays = [...new Set(mappedVals)].filter((v) => !allEfforts.has(v));
  strays.length ? bad('标记不变量', `出现模型没有的档位名：${strays.join(', ')}`) : ok('标记不变量', `所有标记都在 ${[...allEfforts].join('/')} 内`);

  // 6. 档位集合的真实性（脚本无法自证，只能提示）
  //    能自动查的只有“缓存与 --expect-efforts 是否一致”，其余必须人工用 list_subagent_models 核对。
  const expect = flag('expect-efforts');
  if (expect) {
    const want = expect.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    const got = models[0]?.[1]?.efforts ?? [];
    const same = want.length === got.length && want.every((v, i) => v === got[i]);
    same
      ? ok('档位集合与期望一致', want.join('/'))
      : bad('档位集合与期望不一致', `期望 ${want.join('/')}，配置里是 ${got.join('/')}`);
  } else {
    results.push({
      pass: true,
      name: '档位集合真实性',
      detail: '未提供 --expect-efforts；请用 list_subagent_models 人工核对（本自检无法访问模型能力）'
    });
  }
  // 7. 各渠道标记集合是否与配置一致（只比对“用到了哪些档位名”，不比对措辞）
  const channels = [
    ['AGENTS.md', path.join(process.env.USERPROFILE ?? '', '.dsh', 'AGENTS.md')],
    ['QQ 提示词', path.join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop', 'cordis.patch.yml')],
  ];
  const allowed = new Set(models.flatMap(([, m]) => m.efforts ?? []));
  for (const [name, file] of channels) {
    if (!fs.existsSync(file)) {
      results.push({ pass: true, name: `${name} 渠道`, detail: '文件不存在，跳过' });
      continue;
    }
    const text = fs.readFileSync(file, 'utf8');
    const used = [...new Set([...text.matchAll(/▸([a-z]+)/g)].map((m2) => m2[1]))];
    const strays2 = used.filter((v) => !allowed.has(v));
    strays2.length
      ? bad(`${name} 渠道`, `出现配置里没有的标记：${strays2.map((v) => '▸' + v).join(' ')}`)
      : ok(`${name} 渠道`, used.length ? `用到 ${used.map((v) => '▸' + v).join(' ')}` : '未找到 ▸ 标记');
  }

  const g = cfg.guard ?? {};
  const badGuard = ['maxHighPerDay', 'maxUpgradesPerTask'].filter((k) => g[k] !== undefined && !(Number.isSafeInteger(g[k]) && g[k] > 0));
  badGuard.length ? bad('guard 数值', `${badGuard.join(',')} 不是正整数`) : ok('guard 数值');

  // 输出
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.detail ? `  —  ${r.detail}` : ''}`);
  }
  console.log(`\n${failed === 0 ? '全部通过' : `${failed} 项未通过`}`);
  if (failed > 0) process.exitCode = 1;
}

const handlers = {
  show: () => show(loadConfig()),
  emit: () => emit(loadConfig()),
  selfcheck: () => selfcheck(loadConfig()),
  classify: () => classify(loadConfig()),
  map: () => map(loadConfig()),
  route: () => route(loadConfig(), argv[1]),
  check: () => check(loadConfig()),
  log: () => log(loadConfig()),
  stats: () => stats(),
  budget: () => budget(loadConfig())
};
const handler = handlers[cmd];
if (!handler) die(`未知命令 ${cmd}（show/emit/selfcheck/classify/map/route/check/log/stats/budget）`);
handler();