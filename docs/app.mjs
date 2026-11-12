import { createHarness } from './harness.mjs';
import { fixture, scenarios } from './scenarios.mjs';
import { eventLabels, makeTrace, parseTrace, traceLimit } from './trace.mjs';

const byId = (id) => document.getElementById(id);
const pretty = (value) => JSON.stringify(value, null, 2);
const timeline = byId('timeline');
const inspector = byId('inspection');
const approval = byId('approval');
const next = byId('next');
const auto = byId('auto');
const reset = byId('reset');
const detailTab = byId('detail-tab');
const filesTab = byId('files-tab');
const notice = byId('notice');
const status = { ready: '待运行', approval: '等待审批', done: '已完成', stopped: '已停止' };

let scenario = scenarios[0];
let harness = createHarness(fixture(scenario));
let replay = null;
let selected = 0;
let filePath;
let tab = detailTab;
let timer;
let playing = false;
let advancing = false;
let generation = 0;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function button(text, listener, className = 'button') {
  const element = node('button', text, className);
  element.type = 'button';
  element.addEventListener('click', listener);
  return element;
}

function showNotice(message = '') {
  notice.textContent = message;
  notice.hidden = !message;
}

function pause() {
  playing = false;
  clearTimeout(timer);
}

function begin(preset) {
  pause();
  generation++;
  scenario = preset;
  harness = createHarness(fixture(scenario));
  replay = null;
  selected = 0;
  filePath = undefined;
  showNotice();
  render();
}

const scenarioButtons = scenarios.map((preset) => {
  const element = button('', () => begin(preset), 'scenario');
  element.append(node('strong', preset.title), node('span', preset.subtitle));
  byId('scenarios').append(element);
  return element;
});

function showTab(current, focus = false) {
  tab = current;
  for (const element of [detailTab, filesTab]) {
    element.setAttribute('aria-selected', String(element === tab));
    element.tabIndex = element === tab ? 0 : -1;
  }
  inspector.setAttribute('aria-labelledby', tab.id);
  renderInspector(visibleEvents()[selected]);
  if (focus) tab.focus();
}

for (const element of [detailTab, filesTab]) {
  element.addEventListener('click', () => showTab(element));
  element.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    showTab(event.key === 'Home' ? detailTab : event.key === 'End' ? filesTab : element === detailTab ? filesTab : detailTab, true);
  });
}

function visibleEvents() {
  return replay ? replay.trace.events.slice(0, replay.cursor + 1) : harness.snapshot().events;
}

function panel(title, content, open = false) {
  const details = node('details');
  details.open = open;
  details.append(node('summary', title), node('pre', content));
  return details;
}

function renderInspector(event) {
  inspector.replaceChildren();
  if (tab === filesTab) {
    const paths = Object.keys(event.files);
    if (!paths.includes(filePath)) filePath = paths[0];
    if (!filePath) {
      inspector.append(node('p', '此事件的工作区为空。'));
      return;
    }
    const label = node('label', '文件');
    const select = node('select');
    const source = node('pre', event.files[filePath]);
    for (const path of paths) {
      const option = node('option', path);
      option.value = path;
      select.append(option);
    }
    select.value = filePath;
    select.addEventListener('change', () => {
      filePath = select.value;
      source.textContent = event.files[filePath];
    });
    label.append(select);
    inspector.append(label, source);
    return;
  }
  const { request, message, result, ...other } = event.detail;
  inspector.append(node('h4', event.title));
  if (message?.content && typeof message.content === 'string' && message.role !== 'tool') {
    inspector.append(node('p', message.content, 'message'));
  }
  if (event.kind === 'model') inspector.append(panel('助手消息', pretty(message ?? other), true));
  if (event.kind === 'tool') {
    inspector.append(panel('工具结果', pretty(result), true), panel('回传消息', pretty(message)));
  }
  if (request) inspector.append(panel('请求上下文 · messages / tools', pretty(request)));
  if (['approval', 'human', 'stop'].includes(event.kind)) inspector.append(panel('事件数据', pretty(other), true));
}

function renderApproval(pending, files) {
  approval.replaceChildren();
  approval.hidden = !pending;
  if (!pending) return;
  const changed = files[pending.path] !== pending.current;
  const diff = node('pre', undefined, 'diff');
  diff.append(node('span', '− ' + pending.before, 'removed'), node('span', '+ ' + pending.after, 'added'));
  const actions = node('div', undefined, 'approval-actions');
  const approve = button('批准应用', () => decide(true), 'button primary');
  const simulate = button('模拟手动编辑', () => {
    const updated = files[pending.path].replace('"locale": "zh-CN"', '"locale": "en-US"');
    if (harness.edit(pending.path, updated)) {
      selected = harness.snapshot().events.length - 1;
      render();
      approval.querySelector('.primary').focus();
    }
  });
  simulate.disabled = changed || !files[pending.path].includes('"locale": "zh-CN"');
  actions.append(simulate, button('拒绝', () => decide(false)), approve);
  approval.append(
    node('strong', '待审批 · ' + pending.path),
    node('p', changed ? '文件已被手动修改。批准旧预览会触发冲突检查。' : '批准后，Harness 会核对文件修订号再写入。'),
    diff,
    actions,
  );
}

function decide(approved) {
  harness.decide(approved);
  selected = harness.snapshot().events.length - 1;
  render();
  next.focus();
}

function render(follow = true) {
  const snapshot = harness.snapshot();
  const events = visibleEvents();
  const finishedReplay = replay && replay.cursor === replay.trace.events.length - 1;
  const canAdvance = replay ? !finishedReplay : snapshot.state === 'ready';
  byId('scenario-title').textContent = replay?.trace.title ?? scenario.title;
  const recordedPrompt = events[0].detail.message?.content;
  byId('prompt').textContent = replay
    ? typeof recordedPrompt === 'string' ? recordedPrompt : '已记录的运行轨迹'
    : scenario.prompt;
  byId('hint').textContent = replay ? '查看已记录的事件与文件快照。重置可返回交互实验。' : scenario.hint;
  byId('state').textContent = replay ? finishedReplay ? '回放结束' : '回放中' : status[snapshot.state];
  next.disabled = !canAdvance || advancing || playing;
  auto.disabled = !playing && (!canAdvance || advancing);
  auto.textContent = playing ? '暂停' : '自动运行';
  byId('counts').textContent = replay
    ? (replay.cursor + 1) + ' / ' + replay.trace.events.length + ' 个事件'
    : snapshot.rounds + ' 轮模型请求 · ' + snapshot.calls + ' 次工具调用';
  byId('replay').disabled = events.length < 2 && !replay;
  scenarioButtons.forEach((element, index) => element.setAttribute('aria-pressed', String(!replay && scenario === scenarios[index])));

  const previousScroll = timeline.scrollTop;
  timeline.replaceChildren();
  events.forEach((event, index) => {
    const item = node('li');
    const row = button('', () => {
      selected = index;
      for (const entry of timeline.querySelectorAll('button')) entry.removeAttribute('aria-current');
      row.setAttribute('aria-current', 'step');
      renderInspector(event);
    }, 'event ' + event.kind);
    if (index === selected) row.setAttribute('aria-current', 'step');
    row.append(node('span', String(index + 1).padStart(2, '0'), 'event-index'),
      node('span', eventLabels[event.kind], 'event-label'), node('strong', event.title));
    item.append(row);
    timeline.append(item);
  });
  timeline.scrollTop = follow ? timeline.scrollHeight : previousScroll;
  renderInspector(events[selected]);
  renderApproval(replay ? null : snapshot.pending, snapshot.files);
}

async function advance() {
  if (advancing) return;
  const run = generation;
  advancing = true;
  try {
    if (replay) replay.cursor = Math.min(replay.cursor + 1, replay.trace.events.length - 1);
    else await harness.step();
    if (run === generation) selected = visibleEvents().length - 1;
  } finally {
    advancing = false;
    const canAdvance = replay ? replay.cursor < replay.trace.events.length - 1 : harness.snapshot().state === 'ready';
    if (!canAdvance) pause();
    render();
    if (playing) timer = setTimeout(advance, 460);
  }
}

function startReplay(trace) {
  pause();
  generation++;
  replay = { trace, cursor: 0 };
  selected = 0;
  showNotice();
  render();
}

next.addEventListener('click', advance);
auto.addEventListener('click', () => {
  if (playing) {
    pause();
    render(false);
    return;
  }
  playing = true;
  advance();
});
reset.addEventListener('click', () => begin(scenario));
byId('replay').addEventListener('click', () => startReplay(replay?.trace ?? makeTrace(scenario.title, visibleEvents())));
byId('export').addEventListener('click', () => {
  const trace = replay?.trace ?? makeTrace(scenario.title, visibleEvents());
  const url = URL.createObjectURL(new Blob([pretty(trace)], { type: 'application/json' }));
  const link = node('a');
  link.href = url;
  link.download = 'agent-harness-trace.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showNotice('已生成轨迹文件。');
});
const traceFile = byId('trace-file');
byId('import').addEventListener('click', () => traceFile.click());
traceFile.addEventListener('change', async () => {
  const file = traceFile.files[0];
  traceFile.value = '';
  if (!file) return;
  const run = generation;
  try {
    if (file.size > traceLimit) throw new Error('轨迹文件超过 8 MB');
    const trace = parseTrace(await file.text());
    if (run === generation) startReplay(trace);
  } catch (failure) {
    if (run === generation) showNotice('导入失败 · ' + failure.message);
  }
});

render();
