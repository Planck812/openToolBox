import { describe, expect, it } from 'vitest';
import { buildCurlArgs, buildCurlCommand, createRequest, parseCurlCommand, parseRequestCommand } from '../curl-model';

const headerValue = (headers: ReturnType<typeof parseRequestCommand>['headers'] | undefined, key: string): string | undefined =>
  headers?.find((header) => header.key.toLowerCase() === key.toLowerCase())?.value;

describe('parseRequestCommand', () => {
  it('imports Chrome Copy as cURL (bash), including --url, cookies, empty headers, and ANSI-C body strings', () => {
    const request = parseRequestCommand(`curl --url 'https://api.example.com/v1/users?active=true' \\
  -X 'POST' \\
  -H 'accept: application/json' \\
  -H 'X-Empty;' \\
  -b 'session=abc=def' \\
  --data-raw $'{"message":"Hello!\\nAda"}'`);

    expect(request.url).toBe('https://api.example.com/v1/users?active=true');
    expect(request.method).toBe('POST');
    expect(headerValue(request.headers, 'accept')).toBe('application/json');
    expect(headerValue(request.headers, 'X-Empty')).toBe('');
    expect(headerValue(request.headers, 'Cookie')).toBe('session=abc=def');
    expect(request.body).toBe('{"message":"Hello!\nAda"}');
  });

  it('imports Chrome Copy as cURL (cmd) with official caret quoting', () => {
    const request = parseRequestCommand(`curl --url ^"https://api.example.com/v1/users^" ^
  -X ^"POST^" ^
  -H ^"Content-Type: application/json^" ^
  --data-raw ^"{^\\^"name^\\^":^\\^"Ada^\\^"}^"`);

    expect(request.url).toBe('https://api.example.com/v1/users');
    expect(request.method).toBe('POST');
    expect(headerValue(request.headers, 'Content-Type')).toBe('application/json');
    expect(request.body).toBe('{"name":"Ada"}');
  });

  it('imports Chrome Copy as fetch with a JSON.stringify object body', () => {
    const request = parseRequestCommand(`fetch("https://api.example.com/v1/users", {
  "headers": {
    "accept": "application/json",
    "content-type": "application/json"
  },
  "body": JSON.stringify({"name":"Ada"}),
  "method": "POST",
  "mode": "cors",
  "credentials": "include",
  "referrer": "https://example.com/"
});`);

    expect(request.url).toBe('https://api.example.com/v1/users');
    expect(request.method).toBe('POST');
    expect(headerValue(request.headers, 'accept')).toBe('application/json');
    expect(headerValue(request.headers, 'content-type')).toBe('application/json');
    expect(request.body).toBe('{"name":"Ada"}');
  });

  it('imports Chrome Copy as Node.js fetch with Cookie and Referer headers', () => {
    const request = parseRequestCommand(`const response = await fetch("https://api.example.com/v1/users", {
  headers: {
    "accept": "application/json",
    "Cookie": "sid=abc123; theme=dark",
    "Referer": "https://example.com/app"
  },
  body: JSON.stringify({"name":"Ada"}),
  method: "POST"
});`);

    expect(request.url).toBe('https://api.example.com/v1/users');
    expect(request.method).toBe('POST');
    expect(headerValue(request.headers, 'accept')).toBe('application/json');
    expect(headerValue(request.headers, 'Cookie')).toBe('sid=abc123; theme=dark');
    expect(headerValue(request.headers, 'Referer')).toBe('https://example.com/app');
    expect(request.body).toBe('{"name":"Ada"}');
  });

  it('imports Chrome Copy as PowerShell including WebSession and UTF-8 byte body output', () => {
    const request = parseRequestCommand([
      '$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession',
      '$session.UserAgent = "UA-$([char]20320)-`$([char]65)"',
      '$session.Cookies.Add((New-Object System.Net.Cookie("sid$([char]20320)", "abc`$([char]65)", "/", "api.example.com")))',
      'Invoke-WebRequest -UseBasicParsing -Uri "https://api.example.com/v1/$([char]20320)" `',
      '  -Method "POST" `',
      '  -WebSession $session `',
      '  -Headers @{',
      '    "Accept"="application/json"',
      '    "X-Trace"="trace-123"',
      '    "X-$([char]20320)"="你-$([char]20320)-`$([char]65)"',
      '  } `',
      '  -ContentType "application/$([char]20320)-`$([char]65)" `',
      '  -Body ([System.Text.Encoding]::UTF8.GetBytes("{`"message`":`"$([char]20320)-`$([char]65)`"}"))',
    ].join('\n'));

    expect(request.url).toBe('https://api.example.com/v1/你');
    expect(request.method).toBe('POST');
    expect(headerValue(request.headers, 'Accept')).toBe('application/json');
    expect(headerValue(request.headers, 'X-Trace')).toBe('trace-123');
    expect(headerValue(request.headers, 'X-你')).toBe('你-你-$([char]65)');
    expect(headerValue(request.headers, 'Content-Type')).toBe('application/你-$([char]65)');
    expect(headerValue(request.headers, 'User-Agent')).toBe('UA-你-$([char]65)');
    expect(headerValue(request.headers, 'Cookie')).toBe('sid你=abc$([char]65)');
    expect(request.body).toBe('{"message":"你-$([char]65)"}');
  });

  it('uses curl-supported compression and skips Chrome transport headers when sending PowerShell imports', () => {
    const parsed = parseRequestCommand([
      'Invoke-WebRequest -UseBasicParsing -Uri "https://api.example.com/v1/users" `',
      '  -Method "POST" `',
      '  -Headers @{',
      '    "Accept-Encoding"="gzip, deflate, br, zstd"',
      '    "authority"="api.example.com"',
      '    "method"="POST"',
      '    "path"="/v1/users"',
      '    "scheme"="https"',
      '    "version"="HTTP/2"',
      '    "protocol"="h2"',
      '    "Host"="tenant.example.com"',
      '    "content-length"="17"',
      '    "x-api-id"="demo-api"',
      '    "x-auth-token"="test-token"',
      '    "Content-Type"="application/json"',
      '    "Cookie"="session=fake-session"',
      '  } `',
      '  -Body "{`"name`":`"Ada`"}"',
    ].join('\n'));
    const request = { ...createRequest('2026-01-01T00:00:00.000Z'), ...parsed };
    const args = buildCurlArgs(request);
    const command = buildCurlCommand(request);
    // 多请求头合并进单个 `-H` 参数（CRLF 分隔），curl 会拆成多 header 发送。
    const headerArg = args.find((_arg, index) => args[index - 1] === '-H');

    expect(args).toContain('--compressed');
    expect(headerArg?.split('\r\n')).toEqual([
      'Host: tenant.example.com',
      'x-api-id: demo-api',
      'x-auth-token: test-token',
      'Content-Type: application/json',
      'Cookie: session=fake-session',
    ]);
    expect(command).toContain('--compressed');
    expect(command).toContain('x-api-id: demo-api');
    expect(command).toContain('x-auth-token: test-token');
    expect(command).toContain('Content-Type: application/json');
    expect(command).toContain('Cookie: session=fake-session');
    expect(command).toContain('Host: tenant.example.com');
    expect(command).not.toMatch(/Accept-Encoding|authority|method:|path:|scheme:|version:|protocol:|content-length/i);
  });

  it('keeps METHOD URL input compatible', () => {
    const request = parseRequestCommand('PATCH https://api.example.com/v1/users/42');

    expect(request).toMatchObject({
      method: 'PATCH',
      url: 'https://api.example.com/v1/users/42',
      followRedirects: true,
      verifySsl: true,
    });
  });

  it('accepts valid custom HTTP token methods from cURL, fetch, and PowerShell', () => {
    const curlRequest = parseRequestCommand('curl --request=PROPFIND --url https://api.example.com/v1/collection');
    const fetchRequest = parseRequestCommand('fetch("https://api.example.com/v1/collection", { method: "MKCOL" })');
    const powerShellRequest = parseRequestCommand('Invoke-WebRequest -Uri "https://api.example.com/v1/collection" -Method "CUSTOM-METHOD"');
    const curlPreviewRequest = { ...createRequest('2026-01-01T00:00:00.000Z'), ...curlRequest };

    expect(curlRequest.method).toBe('PROPFIND');
    expect(fetchRequest.method).toBe('MKCOL');
    expect(powerShellRequest.method).toBe('CUSTOM-METHOD');
    expect(buildCurlCommand(curlPreviewRequest)).toContain('-X PROPFIND');
    expect(buildCurlArgs(curlPreviewRequest)).toEqual(expect.arrayContaining(['-X', 'PROPFIND']));
  });

  it('rejects invalid HTTP method tokens', () => {
    expect(parseRequestCommand('fetch("https://api.example.com/v1/users", { method: "POST; --insecure" })')).toEqual({});
  });

  it('clears headers and body for complete requests that omit them or use null body', () => {
    const curlRequest = parseRequestCommand('curl --url https://api.example.com/v1/health');
    const fetchWithoutBody = parseRequestCommand('fetch("https://api.example.com/v1/health", { method: "GET" })');
    const fetchWithNullBody = parseRequestCommand('fetch("https://api.example.com/v1/health", { headers: {}, body: null, method: "POST" })');

    expect(curlRequest).toMatchObject({ headers: [], body: '' });
    expect(fetchWithoutBody).toMatchObject({ headers: [], body: '' });
    expect(fetchWithNullBody).toMatchObject({ headers: [], body: '' });
  });

  it('rejects property, string, and comment fetch occurrences', () => {
    expect(parseRequestCommand('apiClient.fetch("https://api.example.com/v1/users")')).toEqual({});
    expect(parseRequestCommand('"fetch(\\"https://api.example.com/v1/users\\")"')).toEqual({});
    expect(parseRequestCommand('// fetch("https://api.example.com/v1/users")')).toEqual({});
  });

  it('keeps the legacy parseCurlCommand API compatible', () => {
    const request = parseCurlCommand('curl --request=PUT --header="X-Token: token-1" --data-raw="{\\"active\\":true}" https://api.example.com/v1/users/42');

    expect(request.url).toBe('https://api.example.com/v1/users/42');
    expect(request.method).toBe('PUT');
    expect(headerValue(request.headers, 'X-Token')).toBe('token-1');
    expect(request.body).toBe('{"active":true}');
  });

  it('rejects ordinary text instead of treating it as a request URL', () => {
    expect(parseRequestCommand('a note copied from the clipboard')).toEqual({});
  });
});
