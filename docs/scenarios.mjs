const baseFiles = {
  'README.md': '# Field Notes\n\n一个用于记录野外观察的样例项目。\n',
  'config/app.json': '{\n  "name": "Field Notes",\n  "theme": "light",\n  "locale": "zh-CN"\n}\n',
  'notes/welcome.md': '# 欢迎\n\n在这里记录观察。\n',
};

const ask = (id, name, args, content = null) => ({
  message: { content, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
});
const say = (content) => ({ message: { content } });
const latest = (messages) => {
  const message = messages.at(-1);
  return message.role === 'tool' ? { id: message.tool_call_id, ...JSON.parse(message.content) } : null;
};
const config = 'config/app.json';
const readConfig = (id) => ask(id, 'read_file', { path: config });
const changeTheme = (id) => ask(id, 'replace_text', { path: config, before: '"theme": "light"', after: '"theme": "dark"' });

function editResponse(last) {
  if (last?.ok) return say('已将 config/app.json 的 theme 更新为 dark，其余内容保留。');
  if (last?.code === 'DENIED') return say('修改请求已被拒绝，未应用主题修改。');
  return say('修改未应用，工具返回 ' + last?.code + '。');
}

export const scenarios = [
  {
    id: 'read', title: '第一次工具调用', subtitle: '读文件并回答问题',
    prompt: 'Field Notes 现在用什么主题？请读取 config/app.json 后回答。',
    hint: '先看模型输出里的 tool_calls，再看工具消息的 tool_call_id。下一轮请求会带上它们。',
    script(last) {
      if (!last) return readConfig('read-1');
      return say('当前主题为 ' + JSON.parse(last.content).theme + '。');
    },
  },
  {
    id: 'recover', title: '读错路径以后', subtitle: '错误反馈与写入审批',
    prompt: '把 Field Notes 的主题从 light 改为 dark，保持其他设置不变。',
    hint: '第一次读取会失败。观察错误怎样回到模型，随后比较批准和拒绝的结果。',
    script(last) {
      if (!last) return ask('miss-1', 'read_file', { path: 'app.json' });
      if (last.id === 'miss-1') return ask('list-1', 'list_files', {}, '这个路径不存在，我先看看项目有哪些文件。');
      if (last.id === 'list-1') return ask('read-2', 'read_file', { path: last.paths.find((path) => path.endsWith('/app.json')) });
      if (last.id === 'read-2') return changeTheme('edit-1');
      return editResponse(last);
    },
  },
  {
    id: 'conflict', title: '审批期间文件变了', subtitle: '拒绝旧预览，重新读取',
    prompt: '把主题切换到 dark。保留我在审批期间做的其他编辑。',
    hint: '第一份预览出现后，点击「模拟手动编辑」，再批准旧预览。观察 CONFLICT 和第二份预览。',
    script(last) {
      if (!last) return readConfig('read-1');
      if (last.id === 'read-1') return changeTheme('edit-1');
      if (last.id === 'edit-1' && last.code === 'CONFLICT') return readConfig('read-2');
      if (last.id === 'read-2') return changeTheme('edit-2');
      return editResponse(last);
    },
  },
  {
    id: 'budget', title: '工具边界与预算', subtitle: '在循环失控前停止',
    prompt: '确认项目里有哪些文件，然后回答。',
    hint: '样例模型先提出一个项目范围外的读取，然后持续请求列目录。工具预算为 3 次。',
    maxCalls: 3,
    script(last) {
      if (!last) return ask('outside', 'read_file', { path: '../outside.txt' });
      const next = last.id === 'outside' ? 1 : Number(last.id.slice(5)) + 1;
      return ask('list-' + next, 'list_files', {});
    },
  },
];

export function fixture(scenario) {
  return {
    files: { ...baseFiles },
    prompt: scenario.prompt,
    maxCalls: scenario.maxCalls,
    respond: async ({ messages }) => scenario.script(latest(messages)),
  };
}
