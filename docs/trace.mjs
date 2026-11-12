export const eventLabels = { task: '用户', model: '模型', tool: '工具', approval: '审批', human: '用户编辑', stop: '停止' };
export const traceLimit = 8 * 1024 * 1024;

export function parseTrace(text) {
  if (text.length > traceLimit) throw new Error('轨迹文件超过大小限制');
  const trace = JSON.parse(text);
  if (trace?.format !== 'agent-harness-lab/v1' || typeof trace.title !== 'string'
    || trace.title.length > 120 || !Array.isArray(trace.events) || trace.events.length < 1 || trace.events.length > 200) {
    throw new Error('轨迹格式无效');
  }
  for (const event of trace.events) {
    if (!Object.hasOwn(eventLabels, event?.kind ?? '') || typeof event.title !== 'string'
      || !event.detail || typeof event.detail !== 'object' || Array.isArray(event.detail)
      || !event.files || typeof event.files !== 'object' || Array.isArray(event.files)
      || Object.entries(event.files).some(([path, content]) => path.length > 160 || typeof content !== 'string')) {
      throw new Error('轨迹包含无效事件');
    }
  }
  return trace;
}

export function makeTrace(title, events) {
  return { format: 'agent-harness-lab/v1', title, events };
}
