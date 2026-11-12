import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { createHarness } from './docs/harness.mjs';
import { fixture, scenarios } from './docs/scenarios.mjs';
import { makeTrace } from './docs/trace.mjs';
import { deepSeek } from './deepseek.mjs';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      live: { type: 'boolean' },
      model: { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('npm run lab -- [read|recover|conflict|budget] [--live] [--model <id>] [--output <trace.json>]');
    return;
  }
  const scenario = scenarios.find(({ id }) => id === (positionals[0] ?? 'read'));
  if (!scenario || positionals.length > 1 || (values.model && !values.live)) {
    throw new Error('运行 npm run lab -- --help 查看用法。');
  }
  const config = fixture(scenario);
  if (values.live) config.respond = deepSeek({ apiKey: process.env.DEEPSEEK_API_KEY, model: values.model });
  const harness = createHarness(config);
  const input = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  let printed = 0;
  let snapshot;
  try {
    for (;;) {
      snapshot = harness.snapshot();
      for (const event of snapshot.events.slice(printed)) {
        console.log(event.title);
        const message = event.detail.message;
        if (message?.role === 'tool') console.log(JSON.stringify(event.detail.result));
        else if (message?.content) console.log(message.content);
        for (const call of message?.tool_calls ?? []) console.log('  ' + call.function.name + '(' + call.function.arguments + ')');
        if (event.kind === 'stop' && typeof message === 'string') console.log(message);
      }
      printed = snapshot.events.length;
      if (snapshot.state === 'done' || snapshot.state === 'stopped') break;
      if (snapshot.state === 'approval') {
        const { before, after } = snapshot.pending;
        console.log('− ' + before + '\n+ ' + after);
        const answer = input ? await input.question('批准 [y/N]，模拟手动编辑 [e]：') : '';
        if (!input) console.log('当前为非交互终端，拒绝应用。');
        if (answer.trim().toLowerCase() === 'e') {
          const { path, current } = snapshot.pending;
          if (harness.edit(path, current.replace('"locale": "zh-CN"', '"locale": "en-US"'))) continue;
          console.log('没有可模拟的语言设置修改。');
          continue;
        }
        harness.decide(answer.trim().toLowerCase() === 'y');
      } else {
        await harness.step();
      }
    }
  } finally {
    input?.close();
  }
  if (snapshot.usage) console.log('Token 用量 · ' + JSON.stringify(snapshot.usage));
  if (values.output) {
    const trace = makeTrace(scenario.title + (values.live ? ' · DeepSeek API' : ''), snapshot.events);
    await writeFile(values.output, JSON.stringify(trace, null, 2) + '\n', { flag: 'wx' });
  }
  if (snapshot.state === 'stopped') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
