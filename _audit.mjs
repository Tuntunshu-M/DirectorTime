// 临时审计：找出"写好了但从没被接线"的部分（跑完整理结论后删除）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js') && !entry.name.startsWith('_')) files.push(full);
  }
})(path.join(ROOT, 'src'));
files.push(path.join(ROOT, 'index.js'));

const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
const sources = new Map(files.map((f) => [rel(f), fs.readFileSync(f, 'utf8')]));

// 1) 导出符号 → 定义处；再看有没有别的文件引用
const exports = new Map(); // name -> [files]
for (const [file, text] of sources) {
  const re = /^export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of text.matchAll(re)) {
    if (!exports.has(m[1])) exports.set(m[1], []);
    exports.get(m[1]).push(file);
  }
}

const orphans = [];
const externallyUsed = [];
for (const [name, defs] of [...exports].sort((a, b) => a[0].localeCompare(b[0]))) {
  const users = [];
  for (const [file, text] of sources) {
    if (defs.includes(file)) {
      // 定义文件里除了定义处还有别处用到 → 内部使用，不算外部接线
      const count = (text.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
      if (count > 1) users.push(`${file}(自身)`);
      continue;
    }
    if (new RegExp(`\\b${name}\\b`).test(text)) users.push(file);
  }
  const outside = users.filter((u) => !u.endsWith('(自身)'));
  if (outside.length === 0) orphans.push({ name, defs, selfOnly: users.length > 0 });
  else externallyUsed.push({ name, outside });
}

// 2) 模块级孤儿：没有任何文件 import 它
const moduleOrphans = [];
for (const file of sources.keys()) {
  const base = file.replace(/^src\//, './').replace(/\.js$/, '.js');
  const needle = path.basename(file);
  let imported = false;
  for (const [other, text] of sources) {
    if (other === file) continue;
    if (text.includes(`/${needle}`) || text.includes(`'./${needle}'`) || text.includes(`'../${needle}'`)) { imported = true; break; }
  }
  if (!imported && file !== 'index.js') moduleOrphans.push(base);
}

// 3) 提示词模板：定义了但没人调
const promptsText = sources.get('src/llm/prompts.js') ?? '';
const templateKeys = [...promptsText.matchAll(/^  ([A-Z][A-Z0-9_]+):\s*\{/gm)].map((m) => m[1]);
const promptOrphans = templateKeys.filter((key) => {
  for (const [file, text] of sources) {
    if (file === 'src/llm/prompts.js') continue;
    if (text.includes(`'${key}'`) || text.includes(`"${key}"`) || new RegExp(`\\b${key}\\b`).test(text)) return false;
  }
  // prompts.js 里除了定义，是否有别处引用（如 PROMPTS[key] 映射）
  const selfCount = (promptsText.match(new RegExp(`\\b${key}\\b`, 'g')) ?? []).length;
  return selfCount <= 1;
});

// 4) 设置项：定义了但没人读
const defState = sources.get('src/core/default-state.js') ?? '';
const settingsBlock = defState.slice(defState.indexOf('export function createDefaultSettings'));
const settingsKeys = [...settingsBlock.matchAll(/^\s{4}([a-zA-Z][\w]*):/gm)].map((m) => m[1]);
const settingUnread = [];
for (const key of settingsKeys) {
  let read = 0;
  for (const [file, text] of sources) {
    if (file === 'src/core/default-state.js') continue;
    const count = (text.match(new RegExp(`\\.${key}\\b`, 'g')) ?? []).length;
    read += count;
  }
  if (read === 0) settingUnread.push(key);
}

// 5) 事件：emit 了但没人 on
const emitted = new Set();
const handled = new Set();
for (const [file, text] of sources) {
  for (const m of text.matchAll(/emit\(\s*'([^']+)'/g)) emitted.add(m[1]);
  for (const m of text.matchAll(/\.on\(\s*'([^']+)'/g)) handled.add(m[1]);
  for (const m of text.matchAll(/bus\.on\(\s*'([^']+)'/g)) handled.add(m[1]);
}

console.log('===== A. 导出但从没被其它文件引用 =====');
for (const item of orphans) {
  console.log(`- ${item.name}  (定义于 ${item.defs.join(', ')}${item.selfOnly ? '，仅自用' : ''})`);
}

console.log('\n===== B. 没有任何文件 import 的模块 =====');
for (const m of moduleOrphans) console.log(`- ${m}`);

console.log('\n===== C. 定义了但没人调的提示词模板 =====');
console.log(promptOrphans.length ? promptOrphans.map((k) => `- ${k}`).join('\n') : '（无）');

console.log('\n===== D. 定义了但没人读的设置项 =====');
console.log(settingUnread.length ? settingUnread.map((k) => `- ${k}`).join('\n') : '（无）');

console.log('\n===== E. 事件 =====');
console.log('emit 过：', [...emitted].sort().join(', '));
console.log('on  过：', [...handled].sort().join(', '));
console.log('emit 但没人 on：', [...emitted].filter((e) => !handled.has(e)).join(', ') || '（无）');

console.log('\n===== F. 被引用次数最多的模块（判断主链路）=====');
const counts = [];
for (const [file, text] of sources) {
  if (file === 'index.js') continue;
  const needle = path.basename(file);
  let used = 0;
  for (const [other, otherText] of sources) {
    if (other === file) continue;
    if (otherText.includes(`${needle}'`)) used += 1;
  }
  counts.push([file, used]);
}
counts.sort((a, b) => a[1] - b[1]);
for (const [file, used] of counts) console.log(`${String(used).padStart(2)} 次被 import  ${file}`);
