import { TerminalSquare } from 'lucide-vue-next';
import { isGlobalFetchCommand, isHttpMethod } from './curl-model';
import type { Tool } from '../interface';

export const curlRunnerTool: Tool = {
  metadata: {
    id: 'curl-runner',
    name: 'tools.curl_runner.name',
    description: 'tools.curl_runner.description',
    icon: TerminalSquare,
    keywords: ['curl', 'http', 'request', 'api', 'postman', '接口', '请求', '调试', 'post', 'get'],
  },
  component: () => import('./CurlRunner.vue'),
  match: (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    if (/^curl(?:\.exe)?\s+/i.test(trimmed)) {
      return { toolId: 'curl-runner', score: 95, matchedData: trimmed };
    }

    if (isGlobalFetchCommand(trimmed) || /\b(?:Invoke-WebRequest|iwr)\b/i.test(trimmed)) {
      return { toolId: 'curl-runner', score: 93, matchedData: trimmed };
    }

    const methodUrlMatch = trimmed.match(/^(\S+)\s+https?:\/\/\S+\s*$/);
    if (methodUrlMatch && isHttpMethod(methodUrlMatch[1])) {
      return { toolId: 'curl-runner', score: 88, matchedData: trimmed };
    }

    if (/https?:\/\/\S+/i.test(trimmed) && /api|request|http|接口|请求/i.test(trimmed)) {
      return { toolId: 'curl-runner', score: 70 };
    }

    if (/postman|curl|http\s+request|接口调试/i.test(trimmed)) {
      return { toolId: 'curl-runner', score: 65 };
    }

    return null;
  },
};
