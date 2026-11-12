export function deepSeek({ apiKey, model = 'deepseek-flash', fetcher = fetch }) {
  if (!apiKey) throw new Error('运行真实模型前，请设置 DEEPSEEK_API_KEY。');
  return async ({ messages, tools }) => {
    const response = await fetcher('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({ model, messages, tools, thinking: { type: 'disabled' }, max_tokens: 1200 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error('DeepSeek API 返回 HTTP ' + response.status);
    const body = await response.json();
    const choice = body.choices?.[0];
    if (!['stop', 'tool_calls'].includes(choice?.finish_reason)) {
      throw new Error('DeepSeek 未返回完整响应 · ' + (choice?.finish_reason ?? 'unknown'));
    }
    return { message: choice.message, usage: body.usage };
  };
}
