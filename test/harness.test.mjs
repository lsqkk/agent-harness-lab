import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../docs/harness.mjs';
import { fixture, scenarios } from '../docs/scenarios.mjs';
import { makeTrace, parseTrace } from '../docs/trace.mjs';
import { deepSeek } from '../deepseek.mjs';

const preset = (id) => fixture(scenarios.find((scenario) => scenario.id === id));
const configPath = 'config/app.json';

async function advance(harness) {
  for (let step = 0; step < 40; step++) {
    const snapshot = harness.snapshot();
    if (snapshot.state !== 'ready') return snapshot;
    await harness.step();
  }
  assert.fail('Harness did not finish or pause');
}

test('pairs a tool result with the assistant call in the next request', async () => {
  const harness = createHarness(preset('read'));
  const snapshot = await advance(harness);
  assert.equal(snapshot.state, 'done');
  assert.equal(snapshot.rounds, 2);
  assert.equal(snapshot.calls, 1);
  const final = snapshot.events.at(-1).detail;
  const [call, result] = final.request.messages.slice(-2);
  assert.equal(call.tool_calls[0].id, result.tool_call_id);
  assert.match(final.message.content, /light/);
  const trace = makeTrace('read', snapshot.events);
  assert.deepEqual(parseTrace(JSON.stringify(trace)), trace);
});

test('recovers from a wrong path and returns a denied write as a tool result', async () => {
  const harness = createHarness(preset('recover'));
  let snapshot = await advance(harness);
  assert.equal(snapshot.state, 'approval');
  assert.equal(snapshot.events[2].detail.result.code, 'FILE_NOT_FOUND');
  assert.equal(JSON.parse(snapshot.files[configPath]).theme, 'light');
  harness.decide(false);
  snapshot = await advance(harness);
  assert.equal(snapshot.events.at(-2).detail.result.code, 'DENIED');
  assert.equal(JSON.parse(snapshot.files[configPath]).theme, 'light');
});

test('rejects a stale preview and preserves the manual edit after fresh approval', async () => {
  const harness = createHarness(preset('conflict'));
  const preview = await advance(harness);
  const edited = preview.files[configPath].replace('zh-CN', 'en-US');
  assert.equal(harness.edit(configPath, edited), true);
  harness.decide(true);
  let snapshot = harness.snapshot();
  assert.equal(snapshot.events.at(-1).detail.result.code, 'CONFLICT');
  assert.equal(snapshot.files[configPath], edited);
  snapshot = await advance(harness);
  assert.equal(snapshot.state, 'approval');
  assert.equal(snapshot.pending.revision, 1);
  harness.decide(true);
  snapshot = await advance(harness);
  assert.equal(snapshot.state, 'done');
  assert.deepEqual(JSON.parse(snapshot.files[configPath]), { name: 'Field Notes', theme: 'dark', locale: 'en-US' });
});

test('enforces the workspace boundary and the tool budget', async () => {
  const config = preset('budget');
  const snapshot = await advance(createHarness(config));
  assert.equal(snapshot.state, 'stopped');
  assert.equal(snapshot.calls, 3);
  assert.equal(snapshot.events[2].detail.result.code, 'OUTSIDE_WORKSPACE');
  assert.deepEqual(snapshot.files, config.files);
});

test('rejects a whole batch before execution when it exceeds the remaining budget', async () => {
  const calls = ['one', 'two'].map((id) => ({
    id, type: 'function', function: { name: 'list_files', arguments: '{}' },
  }));
  const snapshot = await advance(createHarness({
    ...preset('read'), maxCalls: 1,
    respond: async () => ({ message: { content: null, tool_calls: calls } }),
  }));
  assert.equal(snapshot.state, 'stopped');
  assert.equal(snapshot.calls, 0);
  assert.equal(snapshot.events.at(-1).detail.proposed, 2);
});

test('returns a structured result for malformed tool arguments and stops at the round limit', async () => {
  const snapshot = await advance(createHarness({
    ...preset('read'), maxRounds: 1,
    respond: async () => ({
      message: { tool_calls: [{ id: 'bad', type: 'function', function: { name: 'read_file', arguments: 'not JSON' } }] },
    }),
  }));
  assert.equal(snapshot.events.at(-2).detail.result.code, 'INVALID_ARGUMENTS');
  assert.equal(snapshot.events.at(-1).detail.maxRounds, 1);
});

test('rejects trace records with unsupported events or non-text file contents', () => {
  assert.throws(() => parseTrace(JSON.stringify(makeTrace('invalid', [
    { kind: 'task', title: 'wrong', detail: {}, files: { 'bad.txt': 2 } },
  ]))), /无效事件/);
  assert.throws(() => parseTrace(JSON.stringify(makeTrace('invalid', [
    { kind: '__proto__', title: 'wrong', detail: {}, files: {} },
  ]))), /无效事件/);
});

test('uses the official chat endpoint with structured tools and disabled thinking', async () => {
  const respond = deepSeek({
    apiKey: 'test-key',
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.deepseek.com/chat/completions');
      assert.equal(options.headers.Authorization, 'Bearer test-key');
      const body = JSON.parse(options.body);
      assert.equal(body.thinking.type, 'disabled');
      assert.equal(body.tools[1].function.name, 'read_file');
      return {
        ok: true,
        json: async () => ({
          choices: [{ finish_reason: 'stop', message: { content: '完成。' } }],
          usage: { prompt_tokens: 4, completion_tokens: 2 },
        }),
      };
    },
  });
  const snapshot = await advance(createHarness({ ...preset('read'), respond }));
  assert.equal(snapshot.state, 'done');
  assert.deepEqual(snapshot.usage, { prompt_tokens: 4, completion_tokens: 2 });
});
