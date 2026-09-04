export type HttpMethod = string;

export const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export interface CurlHeader {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface CurlRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: CurlHeader[];
  body: string;
  followRedirects: boolean;
  verifySsl: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CurlResponse {
  status: number;
  statusText: string;
  headers: string;
  body: string;
  timeMs: number;
  size: number;
  timestamp: string;
  error?: string;
}

export interface CurlSavedItem {
  request: CurlRequest;
  lastResponse: CurlResponse | null;
}

export const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `curl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const createHeader = (key = '', value = ''): CurlHeader => ({
  id: createId(),
  key,
  value,
  enabled: true,
});

export const createRequest = (timestamp = new Date().toISOString()): CurlRequest => ({
  id: createId(),
  name: '',
  method: 'GET',
  url: '',
  headers: [],
  body: '',
  followRedirects: true,
  verifySsl: true,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const touchRequest = (request: CurlRequest, timestamp = new Date().toISOString()): CurlRequest => ({
  ...request,
  updatedAt: timestamp,
});

export const getRequestDisplayName = (
  request: Pick<CurlRequest, 'name' | 'method' | 'url'>,
  fallback: string,
): string => request.name.trim() || request.url.trim() || `${request.method} ${fallback}`;

export const getActiveHeaders = (request: CurlRequest): CurlHeader[] =>
  request.headers.filter((h) => h.enabled && h.key.trim());

const isQuote = (ch: string): boolean => ch === '"' || ch === "'" || ch === '`';

const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export const isHttpMethod = (value: string): boolean => HTTP_TOKEN.test(value.trim());

const toHttpMethod = (value: string): HttpMethod | undefined => {
  const method = value.trim();
  if (!isHttpMethod(method)) return undefined;

  const standardMethod = method.toUpperCase();
  return HTTP_METHODS.includes(standardMethod) ? standardMethod : method;
};

const normalizeCurlContinuations = (input: string): string => input
  .replace(/\\\r?\n[ \t]*/g, ' ')
  .replace(/\^\r?\n[ \t]*/g, ' ');

const decodeAnsiCQuotedString = (source: string, start: number): { value: string; end: number } => {
  let index = start + 2;
  let value = '';
  while (index < source.length) {
    const current = source[index++];
    if (current === "'") return { value, end: index };
    if (current !== '\\' || index >= source.length) {
      value += current;
      continue;
    }

    const escaped = source[index++];
    const escapes: Record<string, string> = { a: '\x07', b: '\b', e: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
    if (escaped in escapes) value += escapes[escaped];
    else if (escaped === 'x' && /^[0-9a-fA-F]{2}$/.test(source.slice(index, index + 2))) {
      value += String.fromCharCode(Number.parseInt(source.slice(index, index + 2), 16));
      index += 2;
    } else if (escaped === 'u' && /^[0-9a-fA-F]{4}$/.test(source.slice(index, index + 4))) {
      value += String.fromCharCode(Number.parseInt(source.slice(index, index + 4), 16));
      index += 4;
    } else {
      // Bash ANSI-C quotes leave an unrecognized escape as its escaped character.
      value += escaped;
    }
  }
  return { value, end: index };
};

/** Tokenizes Chrome's bash and cmd cURL variants without ever invoking a shell. */
const tokenizeCurl = (input: string): string[] => {
  const cmdStyle = /\^"|\^\r?\n/.test(input);
  const text = normalizeCurlContinuations(input);
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;

    let value = '';
    let quote = '';
    while (i < text.length) {
      const ch = text[i];
      if (!quote && /\s/.test(ch)) break;

      if (!cmdStyle && !quote && ch === '$' && text[i + 1] === "'") {
        const parsed = decodeAnsiCQuotedString(text, i);
        value += parsed.value;
        i = parsed.end;
        continue;
      }

      if (cmdStyle && ch === '^' && i + 1 < text.length) {
        // DevTools cmd output wraps arguments in ^"...^" and emits ^\^" for JSON quotes.
        if (text.startsWith('^\\^"', i)) {
          value += '"';
          i += 4;
          continue;
        }
        if (text[i + 1] === '"') {
          const closesArgument = quote === '"' && (i + 2 >= text.length || /\s/.test(text[i + 2]));
          if (!quote) quote = '"';
          else if (closesArgument) quote = '';
          else value += '"';
          i += 2;
          continue;
        }
        value += text[i + 1];
        i += 2;
        continue;
      }

      if (!cmdStyle && ch === '^' && i + 1 < text.length) {
        value += text[i + 1];
        i += 2;
        continue;
      }

      if (!cmdStyle && ch === '\\' && i + 1 < text.length && quote !== "'") {
        value += text[i + 1];
        i += 2;
        continue;
      }

      if (isQuote(ch)) {
        if (!quote) {
          quote = ch;
          i++;
          continue;
        }
        if (quote === ch) {
          quote = '';
          i++;
          continue;
        }
      }

      value += ch;
      i++;
    }
    tokens.push(value);
  }

  return tokens;
};

const buildParsedRequest = (
  method: HttpMethod,
  url: string,
  headers: CurlHeader[],
  body: string | undefined,
  followRedirects = true,
  verifySsl = true,
  includeGetMethod = false,
): Partial<CurlRequest> => {
  const result: Partial<CurlRequest> = {
    headers,
    body: body ?? '',
    followRedirects,
    verifySsl,
  };
  if (includeGetMethod || method !== 'GET') result.method = method;
  if (url) result.url = url;
  if (body !== undefined) result.body = body;
  if (headers.length > 0) result.headers = headers;
  return result;
};

const addHeader = (headers: CurlHeader[], rawHeader: string): void => {
  const colonIndex = rawHeader.indexOf(':');
  if (colonIndex > 0) {
    headers.push(createHeader(rawHeader.slice(0, colonIndex).trim(), rawHeader.slice(colonIndex + 1).trim()));
  } else if (rawHeader.endsWith(';') && rawHeader.length > 1) {
    // cURL uses a trailing semicolon to send a header without a value.
    headers.push(createHeader(rawHeader.slice(0, -1).trim(), ''));
  }
};

/**
 * Parses a cURL command copied from Chrome DevTools (bash or Windows cmd).
 * This exported legacy API deliberately remains cURL-focused; use
 * parseRequestCommand when the input can also be fetch or PowerShell.
 */
export const parseCurlCommand = (input: string): Partial<CurlRequest> => {
  const trimmed = input.trim();
  if (!trimmed) return {};

  const tokens = tokenizeCurl(trimmed);
  if (tokens[0]?.toLowerCase() === 'curl' || tokens[0]?.toLowerCase() === 'curl.exe') {
    tokens.shift();
  }

  let method: HttpMethod = 'GET';
  let url = '';
  let body: string | undefined;
  let followRedirects = true;
  let verifySsl = true;
  let invalidMethod = false;
  const headers: CurlHeader[] = [];
  const flagsWithValues = new Set([
    '-K', '--config', '-o', '--output', '-u', '--user', '--referer', '-e',
    '--connect-timeout', '--max-time', '--proxy', '-x', '--cacert', '--cert', '--key',
  ]);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const equalsIndex = token.indexOf('=');
    const flag = equalsIndex > 0 && token.startsWith('--') ? token.slice(0, equalsIndex) : token;
    const inlineValue = equalsIndex > 0 && token.startsWith('--') ? token.slice(equalsIndex + 1) : undefined;
    const nextValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = tokens[i + 1];
      if (next !== undefined) i++;
      return next;
    };

    if (flag === '-X' || flag === '--request') {
      const requestedMethod = nextValue();
      const parsedMethod = requestedMethod ? toHttpMethod(requestedMethod) : undefined;
      if (!parsedMethod) invalidMethod = true;
      else method = parsedMethod;
    } else if (flag.startsWith('-X') && flag.length > 2) {
      const parsedMethod = toHttpMethod(flag.slice(2));
      if (!parsedMethod) invalidMethod = true;
      else method = parsedMethod;
    } else if (flag === '-H' || flag === '--header') {
      const header = nextValue();
      if (header !== undefined) addHeader(headers, header);
    } else if (flag.startsWith('-H') && flag.length > 2) {
      addHeader(headers, flag.slice(2));
    } else if (
      flag === '-d' || flag === '--data' || flag === '--data-raw' || flag === '--data-binary' ||
      flag === '--data-ascii' || flag === '--data-urlencode'
    ) {
      body = nextValue();
      if (method === 'GET') method = 'POST';
    } else if (flag.startsWith('-d') && flag.length > 2) {
      body = flag.slice(2);
      if (method === 'GET') method = 'POST';
    } else if (flag === '-b' || flag === '--cookie') {
      const cookie = nextValue();
      if (cookie !== undefined) headers.push(createHeader('Cookie', cookie));
    } else if (flag.startsWith('-b') && flag.length > 2) {
      headers.push(createHeader('Cookie', flag.slice(2)));
    } else if (flag === '--url') {
      url = nextValue() ?? url;
    } else if (flag === '-L' || flag === '--location') {
      followRedirects = true;
    } else if (flag === '--no-location') {
      followRedirects = false;
    } else if (flag === '-k' || flag === '--insecure') {
      verifySsl = false;
    } else if (flagsWithValues.has(flag)) {
      nextValue();
    } else if (!flag.startsWith('-') && !url) {
      url = token;
    }
  }

  if (invalidMethod) return {};
  return buildParsedRequest(method, url, headers, body, followRedirects, verifySsl);
};

type SafeJsValue = string | number | boolean | null | SafeJsObject | SafeJsValue[];
interface SafeJsObject {
  [key: string]: SafeJsValue;
}

const isSafeJsObject = (value: unknown): value is SafeJsObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A deliberately small JS literal parser for DevTools snippets; it never evaluates input. */
class SafeJsLiteralParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): SafeJsValue {
    const value = this.parseValue();
    this.skipTrivia();
    if (this.index !== this.source.length) throw new Error('Unexpected JavaScript input');
    return value;
  }

  private skipTrivia(): void {
    while (this.index < this.source.length) {
      if (/\s/.test(this.source[this.index])) {
        this.index++;
      } else if (this.source.startsWith('//', this.index)) {
        const newline = this.source.indexOf('\n', this.index + 2);
        this.index = newline === -1 ? this.source.length : newline + 1;
      } else if (this.source.startsWith('/*', this.index)) {
        const end = this.source.indexOf('*/', this.index + 2);
        if (end === -1) throw new Error('Unterminated comment');
        this.index = end + 2;
      } else {
        break;
      }
    }
  }

  private parseValue(): SafeJsValue {
    this.skipTrivia();
    const current = this.source[this.index];
    if (isQuote(current)) return this.parseString();
    if (current === '{') return this.parseObject();
    if (current === '[') return this.parseArray();
    if (current === '-' || /\d/.test(current)) return this.parseNumber();

    const identifier = this.parseIdentifier();
    if (identifier === 'true') return true;
    if (identifier === 'false') return false;
    if (identifier === 'null') return null;
    if (identifier === 'JSON' && this.consume('.')) {
      const method = this.parseIdentifier();
      if (method !== 'stringify' || !this.consume('(')) throw new Error('Unsupported JavaScript expression');
      const value = this.parseValue();
      this.skipTrivia();
      if (!this.consume(')')) throw new Error('Unterminated JSON.stringify');
      return JSON.stringify(value);
    }
    throw new Error('Unsupported JavaScript expression');
  }

  private parseObject(): SafeJsObject {
    this.index++;
    const object: SafeJsObject = {};
    this.skipTrivia();
    while (this.source[this.index] !== '}') {
      const key = isQuote(this.source[this.index]) ? this.parseString() : this.parseIdentifier();
      this.skipTrivia();
      if (!this.consume(':')) throw new Error('Expected object colon');
      object[key] = this.parseValue();
      this.skipTrivia();
      if (this.consume(',')) {
        this.skipTrivia();
        continue;
      }
      if (this.source[this.index] !== '}') throw new Error('Expected object separator');
    }
    this.index++;
    return object;
  }

  private parseArray(): SafeJsValue[] {
    this.index++;
    const values: SafeJsValue[] = [];
    this.skipTrivia();
    while (this.source[this.index] !== ']') {
      values.push(this.parseValue());
      this.skipTrivia();
      if (this.consume(',')) {
        this.skipTrivia();
        continue;
      }
      if (this.source[this.index] !== ']') throw new Error('Expected array separator');
    }
    this.index++;
    return values;
  }

  private parseString(): string {
    const quote = this.source[this.index++];
    let value = '';
    while (this.index < this.source.length) {
      const current = this.source[this.index++];
      if (current === quote) return value;
      if (quote === '`' && current === '$' && this.source[this.index] === '{') {
        throw new Error('Template interpolation is unsupported');
      }
      if (current !== '\\') {
        value += current;
        continue;
      }

      const escaped = this.source[this.index++];
      const escapeMap: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', 0: '\0' };
      if (escaped in escapeMap) value += escapeMap[escaped];
      else if (escaped === 'x') value += String.fromCharCode(parseInt(this.takeHex(2), 16));
      else if (escaped === 'u') {
        if (this.source[this.index] === '{') {
          this.index++;
          const close = this.source.indexOf('}', this.index);
          if (close === -1) throw new Error('Invalid Unicode escape');
          const codePoint = Number.parseInt(this.source.slice(this.index, close), 16);
          if (!Number.isFinite(codePoint)) throw new Error('Invalid Unicode escape');
          value += String.fromCodePoint(codePoint);
          this.index = close + 1;
        } else {
          value += String.fromCharCode(parseInt(this.takeHex(4), 16));
        }
      } else if (escaped === '\r' && this.source[this.index] === '\n') this.index++;
      else if (escaped === '\n') {
        // JavaScript permits escaped physical newlines in string literals.
      } else value += escaped;
    }
    throw new Error('Unterminated string');
  }

  private takeHex(length: number): string {
    const value = this.source.slice(this.index, this.index + length);
    if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value)) throw new Error('Invalid hexadecimal escape');
    this.index += length;
    return value;
  }

  private parseNumber(): number {
    const match = this.source.slice(this.index).match(/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!match) throw new Error('Invalid number');
    this.index += match[0].length;
    return Number(match[0]);
  }

  private parseIdentifier(): string {
    this.skipTrivia();
    const match = this.source.slice(this.index).match(/^[A-Za-z_$][\w$]*/);
    if (!match) throw new Error('Expected identifier');
    this.index += match[0].length;
    return match[0];
  }

  private consume(character: string): boolean {
    this.skipTrivia();
    if (this.source[this.index] !== character) return false;
    this.index++;
    return true;
  }
}

const parseSafeJsLiteral = (source: string): SafeJsValue | undefined => {
  try {
    return new SafeJsLiteralParser(source.trim()).parse();
  } catch {
    return undefined;
  }
};

const findMatchingParenthesis = (source: string, openIndex: number): number => {
  let depth = 0;
  let quote = '';
  for (let index = openIndex; index < source.length; index++) {
    const current = source[index];
    if (quote) {
      if (current === '\\') {
        index++;
      } else if (current === quote) {
        quote = '';
      }
      continue;
    }
    if (isQuote(current)) quote = current;
    else if (current === '(') depth++;
    else if (current === ')' && --depth === 0) return index;
  }
  return -1;
};

const splitTopLevelArguments = (source: string): string[] => {
  const args: string[] = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  for (let index = 0; index < source.length; index++) {
    const current = source[index];
    if (quote) {
      if (current === '\\') index++;
      else if (current === quote) quote = '';
      continue;
    }
    if (isQuote(current)) quote = current;
    else if ('({['.includes(current)) depth++;
    else if (')}]'.includes(current)) depth--;
    else if (current === ',' && depth === 0) {
      args.push(source.slice(start, index));
      start = index + 1;
    }
  }
  args.push(source.slice(start));
  return args;
};

const getObjectString = (object: SafeJsObject, key: string): string | undefined =>
  typeof object[key] === 'string' ? object[key] : undefined;

const headersFromJsObject = (value: SafeJsValue | undefined): CurlHeader[] => {
  if (!value || !isSafeJsObject(value)) return [];
  return Object.entries(value)
    .filter((entry): entry is [string, string | number | boolean] =>
      typeof entry[1] === 'string' || typeof entry[1] === 'number' || typeof entry[1] === 'boolean')
    .map(([key, headerValue]) => createHeader(key, String(headerValue)));
};

const findGlobalFetchCall = (source: string): number | undefined => {
  let quote = '';
  for (let index = 0; index < source.length; index++) {
    const current = source[index];
    if (quote) {
      if (current === '\\') index++;
      else if (current === quote) quote = '';
      continue;
    }
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index + 2);
      index = newline === -1 ? source.length : newline;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      index = close === -1 ? source.length : close + 1;
      continue;
    }
    if (isQuote(current)) {
      quote = current;
      continue;
    }
    if (!source.startsWith('fetch', index) || /[\w$]/.test(source[index - 1] ?? '') || /[\w$]/.test(source[index + 5] ?? '')) {
      continue;
    }

    let afterName = index + 5;
    while (/\s/.test(source[afterName] ?? '')) afterName++;
    if (source[afterName] !== '(') continue;

    const prefix = source.slice(0, index).trimEnd();
    const validStatementPrefix = /(?:^|[;{}])\s*(?:(?:(?:const|let|var)\s+)?[\w$]+\s*=\s*)?(?:await\s*)?$/;
    if (validStatementPrefix.test(prefix)) return index;
  }
  return undefined;
};

/** Returns true only for a bare, statement-position global fetch call. */
export const isGlobalFetchCommand = (input: string): boolean => findGlobalFetchCall(input) !== undefined;

const parseFetchCommand = (input: string): Partial<CurlRequest> => {
  const fetchIndex = findGlobalFetchCall(input);
  if (fetchIndex === undefined) return {};
  const openIndex = input.indexOf('(', fetchIndex + 'fetch'.length);
  const closeIndex = findMatchingParenthesis(input, openIndex);
  if (closeIndex === -1) return {};

  const args = splitTopLevelArguments(input.slice(openIndex + 1, closeIndex));
  const url = parseSafeJsLiteral(args[0] ?? '');
  const options = parseSafeJsLiteral(args[1] ?? '{}');
  if (typeof url !== 'string' || !isSafeJsObject(options)) return {};

  const requestedMethod = options.method;
  if (requestedMethod !== undefined && typeof requestedMethod !== 'string') return {};
  const method = toHttpMethod(requestedMethod ?? 'GET');
  if (!method) return {};
  const body = getObjectString(options, 'body');
  const headers = headersFromJsObject(options.headers);
  return buildParsedRequest(method, url, headers, body, true, true, true);
};

const normalizePowerShellContinuations = (input: string): string => input.replace(/`\r?\n[ \t]*/g, ' ');

const parsePowerShellCharExpression = (source: string, start: number): { value: string; end: number } | undefined => {
  const match = source.slice(start).match(/^\$\(\[char\](\d{1,7})\)/);
  if (!match) return undefined;

  const codePoint = Number.parseInt(match[1], 10);
  if (codePoint > 0x10ffff) return undefined;
  return { value: String.fromCodePoint(codePoint), end: start + match[0].length };
};

const parsePowerShellString = (source: string): string | undefined => {
  const text = source.trim();
  const quote = text[0];
  if ((quote !== '"' && quote !== "'") || text.length < 2 || text[text.length - 1] !== quote) return undefined;

  let value = '';
  for (let index = 1; index < text.length - 1; index++) {
    const current = text[index];
    if (quote === "'" && current === "'" && text[index + 1] === "'") {
      value += "'";
      index++;
    } else if (quote === '"' && current === '`' && index + 1 < text.length - 1) {
      const next = text[++index];
      const escapes: Record<string, string> = { '0': '\0', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
      value += escapes[next.toLowerCase()] ?? next;
    } else if (quote === '"' && current === '$') {
      const parsedChar = parsePowerShellCharExpression(text, index);
      if (parsedChar) {
        value += parsedChar.value;
        index = parsedChar.end - 1;
      } else {
        value += current;
      }
    } else {
      value += current;
    }
  }
  return value;
};

const parsePowerShellBody = (source: string): string | undefined => {
  const directValue = parsePowerShellString(source);
  if (directValue !== undefined) return directValue;

  const utf8Bytes = source.trim().match(
    /^\(\s*\[System\.Text\.Encoding\]::UTF8\.GetBytes\(\s*("(?:`.|[^"])*"|'(?:''|[^'])*')\s*\)\s*\)$/i,
  );
  const encodedValue = utf8Bytes ? parsePowerShellString(utf8Bytes[1]) : undefined;
  return encodedValue;
};

const readPowerShellBalanced = (source: string, start: number): string | undefined => {
  if (!source.startsWith('@{', start)) return undefined;
  let depth = 0;
  let quote = '';
  for (let index = start; index < source.length; index++) {
    const current = source[index];
    if (quote) {
      if (quote === '"' && current === '`') index++;
      else if (current === quote) {
        if (quote === "'" && source[index + 1] === "'") index++;
        else quote = '';
      }
      continue;
    }
    if (current === '"' || current === "'") quote = current;
    else if (current === '{') depth++;
    else if (current === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  return undefined;
};

const tokenizePowerShell = (input: string): string[] => {
  const text = normalizePowerShellContinuations(input);
  const tokens: string[] = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index++;
    if (index >= text.length) break;
    if (text.startsWith('@{', index)) {
      const block = readPowerShellBalanced(text, index);
      if (block) {
        tokens.push(block);
        index += block.length;
        continue;
      }
    }

    const start = index;
    let quote = '';
    while (index < text.length) {
      const current = text[index];
      if (!quote && /\s/.test(current)) break;
      if (!quote && (current === '"' || current === "'")) quote = current;
      else if (quote === '"' && current === '`') index++;
      else if (current === quote) {
        if (quote === "'" && text[index + 1] === "'") index++;
        else quote = '';
      }
      index++;
    }
    tokens.push(text.slice(start, index));
  }
  return tokens;
};

const parsePowerShellHeaders = (block: string): CurlHeader[] => {
  const headers: CurlHeader[] = [];
  const pair = /(?:"((?:`.|[^"])*)"|'((?:''|[^'])*)'|([\w-]+))\s*=\s*("(?:`.|[^"])*"|'(?:''|[^'])*')/g;
  let match: RegExpExecArray | null;
  while ((match = pair.exec(block)) !== null) {
    const key = match[1] !== undefined
      ? parsePowerShellString(`"${match[1]}"`)
      : match[2]?.replace(/''/g, "'") ?? match[3];
    const value = parsePowerShellString(match[4]);
    if (key && value !== undefined) headers.push(createHeader(key, value));
  }
  return headers;
};

const hasHeader = (headers: CurlHeader[], name: string): boolean =>
  headers.some((header) => header.key.toLowerCase() === name.toLowerCase());

const parsePowerShellCommand = (input: string): Partial<CurlRequest> => {
  const text = normalizePowerShellContinuations(input);
  const invocation = /\b(?:Invoke-WebRequest|iwr)\b/i.exec(text);
  if (!invocation) return {};

  const tokens = tokenizePowerShell(text.slice(invocation.index + invocation[0].length));
  let url = '';
  let method: HttpMethod = 'GET';
  let body: string | undefined;
  let contentType = '';
  let invalidMethod = false;
  const headers: CurlHeader[] = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const equalIndex = token.indexOf('=');
    const parameter = (equalIndex > 0 ? token.slice(0, equalIndex) : token).toLowerCase();
    const inlineValue = equalIndex > 0 ? token.slice(equalIndex + 1) : undefined;
    const nextValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = tokens[index + 1];
      if (next !== undefined) index++;
      return next;
    };
    const stringValue = (): string | undefined => {
      const value = nextValue();
      return value === undefined ? undefined : parsePowerShellString(value) ?? value;
    };

    if (parameter === '-uri' || parameter === '-url') {
      url = stringValue() ?? url;
    } else if (parameter === '-method') {
      const requestedMethod = stringValue();
      const parsedMethod = requestedMethod ? toHttpMethod(requestedMethod) : undefined;
      if (!parsedMethod) invalidMethod = true;
      else method = parsedMethod;
    } else if (parameter === '-headers') {
      const value = nextValue();
      if (value?.startsWith('@{')) headers.push(...parsePowerShellHeaders(value));
    } else if (parameter === '-body') {
      const value = nextValue();
      body = value === undefined ? undefined : parsePowerShellBody(value) ?? parsePowerShellString(value) ?? value;
    } else if (parameter === '-websession') {
      nextValue();
    } else if (parameter === '-contenttype') {
      contentType = stringValue() ?? contentType;
    }
  }

  const userAgentMatch = /\$[\w]+\.UserAgent\s*=\s*("(?:`.|[^"])*"|'(?:''|[^'])*')/i.exec(text);
  const userAgent = userAgentMatch ? parsePowerShellString(userAgentMatch[1]) : undefined;
  if (userAgent && !hasHeader(headers, 'User-Agent')) headers.push(createHeader('User-Agent', userAgent));

  const cookies: string[] = [];
  const cookiePattern = /Cookie\(\s*("(?:`.|[^"])*"|'(?:''|[^'])*')\s*,\s*("(?:`.|[^"])*"|'(?:''|[^'])*')/gi;
  let cookieMatch: RegExpExecArray | null;
  while ((cookieMatch = cookiePattern.exec(text)) !== null) {
    const name = parsePowerShellString(cookieMatch[1]);
    const value = parsePowerShellString(cookieMatch[2]);
    if (name !== undefined && value !== undefined) cookies.push(`${name}=${value}`);
  }
  if (cookies.length > 0 && !hasHeader(headers, 'Cookie')) headers.push(createHeader('Cookie', cookies.join('; ')));
  if (contentType && !hasHeader(headers, 'Content-Type')) headers.push(createHeader('Content-Type', contentType));

  if (!url || invalidMethod) return {};
  return buildParsedRequest(method, url, headers, body, true, true, true);
};

const parseMethodUrl = (input: string): Partial<CurlRequest> => {
  const match = input.trim().match(/^(\S+)\s+(https?:\/\/\S+)\s*$/);
  const method = match ? toHttpMethod(match[1]) : undefined;
  if (!match || !method) return {};
  return buildParsedRequest(method, match[2], [], undefined, true, true, true);
};

/**
 * Safely recognizes and imports all request snippets produced by Chrome DevTools:
 * cURL (bash/cmd), browser or Node.js fetch, PowerShell Invoke-WebRequest, and METHOD URL.
 */
export const parseRequestCommand = (input: string): Partial<CurlRequest> => {
  const trimmed = input.trim();
  if (!trimmed) return {};
  if (/\b(?:Invoke-WebRequest|iwr)\b/i.test(trimmed)) return parsePowerShellCommand(trimmed);
  if (isGlobalFetchCommand(trimmed)) return parseFetchCommand(trimmed);
  const methodUrl = parseMethodUrl(trimmed);
  if (methodUrl.url) return methodUrl;
  if (/^curl(?:\.exe)?(?:\s|$)/i.test(trimmed)) {
    const parsed = parseCurlCommand(trimmed);
    return parsed.url ? parsed : {};
  }
  return {};
};

const CURL_MANAGED_HEADERS = new Set([
  'accept-encoding',
  'authority',
  'method',
  'path',
  'scheme',
  'version',
  'protocol',
  'content-length',
]);

const getCurlHeaders = (request: CurlRequest): CurlHeader[] =>
  getActiveHeaders(request).filter((header) => !CURL_MANAGED_HEADERS.has(header.key.trim().toLowerCase()));

/**
 * 归一化 curl URL：无 scheme（无 `://`）时按 curl 默认行为补 `http://`。
 * 这样 capability 白名单（仅放行 http/https）不会阻断用户习惯输入的无 scheme 地址。
 */
const normalizeCurlUrl = (url: string): string => {
  const trimmed = url.trim();
  return trimmed && !trimmed.includes('://') ? `http://${trimmed}` : trimmed;
};

export const buildCurlCommand = (request: CurlRequest): string => {
  const parts: string[] = ['curl', '--compressed'];
  const method = toHttpMethod(request.method) ?? 'GET';

  if (request.followRedirects) parts.push('-L');
  if (!request.verifySsl) parts.push('-k');
  if (method !== 'GET') parts.push('-X', method);

  for (const header of getCurlHeaders(request)) {
    parts.push('-H', `"${header.key}: ${header.value}"`);
  }

  const hasBody = request.body && method !== 'GET' && method !== 'HEAD';
  if (hasBody) {
    parts.push('--data-raw', `"${request.body.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  }

  if (request.url) {
    parts.push(normalizeCurlUrl(request.url));
  }

  return parts.join(' ');
};

/**
 * 构造实际执行的 curl 参数：固定 13 参规范序列，与 capability 白名单逐位对齐。
 *
 * 为什么固定长度：Tauri shell 插件的 args 白名单按位置逐一校验，长度必须恒定。
 * 因此把「可开可关」的选项改成成对占位：
 * - 跟随重定向：`-L` / `--no-location`（后者即默认不跟随，无副作用）；
 * - 跳过证书校验：`-k` / `-q`（`-q` 非首位时是无操作占位，不影响任何行为）；
 * - 请求体：`--data-raw <body>` / `--limit-rate 0`（0 表示不限速，无副作用）。
 * 多个请求头用 `\r\n` 合并进单个 `-H`（curl 支持单参数多 header）；无请求头时
 * 传 `-H ""`，curl 会静默忽略空 header。
 */
export const buildCurlArgs = (request: CurlRequest): string[] => {
  const method = toHttpMethod(request.method) ?? 'GET';
  const hasBody = Boolean(request.body) && method !== 'GET' && method !== 'HEAD';

  return [
    '-s',
    '-S',
    '-i',
    '--compressed',
    request.followRedirects ? '-L' : '--no-location',
    request.verifySsl ? '-q' : '-k',
    '-X',
    method,
    '-H',
    getCurlHeaders(request)
      .map((header) => `${header.key}: ${header.value}`)
      .join('\r\n'),
    hasBody ? '--data-raw' : '--limit-rate',
    hasBody ? request.body : '0',
    normalizeCurlUrl(request.url),
  ];
};

export const parseCurlOutput = (output: string, stderr: string, timeMs: number): CurlResponse => {
  const timestamp = new Date().toISOString();

  if (!output && stderr) {
    return {
      status: 0,
      statusText: '',
      headers: '',
      body: '',
      timeMs,
      size: 0,
      timestamp,
      error: stderr.trim(),
    };
  }

  const httpLineRegex = /HTTP\/[\d.]+\s+\d{3}[^\r\n]*/g;
  let lastStatusMatch: RegExpExecArray | null = null;
  let match: RegExpExecArray | null;
  while ((match = httpLineRegex.exec(output)) !== null) {
    lastStatusMatch = match;
  }

  let headerBlock = '';
  let body: string;

  if (lastStatusMatch) {
    const afterLastStatus = output.slice(lastStatusMatch.index);
    const sepIdx = afterLastStatus.indexOf('\r\n\r\n');
    if (sepIdx >= 0) {
      headerBlock = afterLastStatus.slice(0, sepIdx);
      body = afterLastStatus.slice(sepIdx + 4);
    } else {
      const altIdx = afterLastStatus.indexOf('\n\n');
      if (altIdx >= 0) {
        headerBlock = afterLastStatus.slice(0, altIdx);
        body = afterLastStatus.slice(altIdx + 2);
      } else {
        headerBlock = afterLastStatus;
        body = '';
      }
    }
  } else {
    body = output;
  }

  const headerLines = headerBlock.split(/\r?\n/).filter(Boolean);
  const statusLine = headerLines[0] || '';
  const statusMatch = statusLine.match(/^HTTP\/[\d.]+\s+(\d{3})\s*(.*)$/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
  const statusText = statusMatch?.[2]?.trim() || '';
  const headers = headerLines.slice(1).join('\n');

  return {
    status,
    statusText,
    headers,
    body,
    timeMs,
    size: body.length,
    timestamp,
  };
};

export const formatBytes = (size: number): string => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
};

export const tryFormatJson = (body: string): string => {
  if (!body) return body;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
};

export const isJsonResponse = (headers: string): boolean => /content-type[:\s]*application\/json/i.test(headers);
