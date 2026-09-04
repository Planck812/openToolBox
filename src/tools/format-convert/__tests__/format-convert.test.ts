// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { detectFormat } from '../detect';
import {
  flattenToProperties,
  parseProperties,
  stringifyProperties,
} from '../properties';
import { matchFormatConvertInput } from '../index';

// 动态加载 engine：缺依赖时跳过依赖相关用例
const loadConvert = async () => {
  try {
    const mod = await import('../engine');
    // 试探 yaml 是否可用
    await import('yaml');
    await import('smol-toml');
    await import('fast-xml-parser');
    return mod;
  } catch {
    return null;
  }
};

describe('detectFormat', () => {
  it('detects JSON objects and arrays', () => {
    expect(detectFormat('{"a":1}').format).toBe('json');
    expect(detectFormat('[1,2,3]').format).toBe('json');
  });

  it('detects YAML mappings and lists', () => {
    const yaml = ['name: demo', 'items:', '  - a', '  - b'].join('\n');
    expect(detectFormat(yaml).format).toBe('yaml');
  });

  it('detects TOML with table headers', () => {
    const toml = ['[package]', 'name = "demo"', 'version = "1.0.0"'].join('\n');
    expect(detectFormat(toml).format).toBe('toml');
  });

  it('detects XML documents', () => {
    const xml = '<?xml version="1.0"?><root><item id="1">x</item></root>';
    expect(detectFormat(xml).format).toBe('xml');
  });

  it('detects properties key=value lines', () => {
    const props = ['# comment', 'app.name=smart', 'app.port=8080'].join('\n');
    expect(detectFormat(props).format).toBe('properties');
  });

  it('returns null for empty or unknown text', () => {
    expect(detectFormat('').format).toBeNull();
    expect(detectFormat('hello world only').format).toBeNull();
  });
});

describe('properties parser', () => {
  it('parses key=value and key: value with comments', () => {
    const text = ['# head', 'a=1', 'b: two', '! skip', 'c = spaced'].join('\n');
    expect(parseProperties(text)).toEqual({
      a: '1',
      b: 'two',
      c: 'spaced',
    });
  });

  it('supports line continuation with backslash', () => {
    const text = ['msg=hello \\', 'world'].join('\n');
    expect(parseProperties(text).msg).toBe('hello world');
  });

  it('stringifies flat object sorted by key', () => {
    const text = stringifyProperties({ z: '9', a: '1' });
    expect(text).toBe('a=1\nz=9');
  });

  it('flattens nested objects with dotted keys', () => {
    const flat = flattenToProperties({ a: { b: 1, c: true }, list: ['x', 'y'] });
    expect(flat).toEqual({
      'a.b': '1',
      'a.c': 'true',
      'list.0': 'x',
      'list.1': 'y',
    });
  });

  it('round-trips simple properties', () => {
    const source = { 'app.name': 'demo', 'app.debug': 'false' };
    const text = stringifyProperties(source);
    expect(parseProperties(text)).toEqual(source);
  });
});

describe('matchFormatConvertInput', () => {
  it('matches clear JSON input with high score', () => {
    const result = matchFormatConvertInput('{"ok":true}');
    expect(result?.toolId).toBe('format-convert');
    expect(result?.score).toBeGreaterThanOrEqual(90);
  });

  it('matches keyword-only queries', () => {
    const result = matchFormatConvertInput('yaml 转 json');
    expect(result?.toolId).toBe('format-convert');
    expect(result?.score).toBeGreaterThanOrEqual(65);
  });

  it('returns null for empty input', () => {
    expect(matchFormatConvertInput('   ')).toBeNull();
  });
});

describe('convertFormat (requires deps)', () => {
  it('converts JSON to YAML and back when deps available', async () => {
    const engine = await loadConvert();
    if (!engine) {
      // 依赖未安装时跳过，properties/detect 用例已覆盖自写逻辑
      return;
    }

    const json = '{\n  "name": "demo",\n  "count": 2\n}';
    const toYaml = await engine.convertFormat(json, {
      sourceFormat: 'json',
      targetFormat: 'yaml',
    });
    expect(toYaml.ok).toBe(true);
    if (!toYaml.ok) return;
    expect(toYaml.output).toContain('name: demo');
    expect(toYaml.output).toContain('count: 2');

    const back = await engine.convertFormat(toYaml.output, {
      sourceFormat: 'yaml',
      targetFormat: 'json',
    });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(JSON.parse(back.output)).toEqual({ name: 'demo', count: 2 });
  });

  it('converts JSON nested object to properties with degrade flag', async () => {
    const engine = await loadConvert();
    if (!engine) {
      // 无外部依赖时仍可直接测 properties 扁平化路径
      const nested = { server: { host: 'localhost', port: 3000 } };
      const flat = flattenToProperties(nested);
      expect(flat['server.host']).toBe('localhost');
      expect(flat['server.port']).toBe('3000');
      return;
    }

    const json = JSON.stringify({ server: { host: 'localhost', port: 3000 } });
    const result = await engine.convertFormat(json, {
      sourceFormat: 'json',
      targetFormat: 'properties',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degraded).toBe(true);
    expect(result.output).toContain('server.host=localhost');
    expect(result.output).toContain('server.port=3000');
  });

  it('converts basic XML to JSON when deps available', async () => {
    const engine = await loadConvert();
    if (!engine) {
      return;
    }

    const xml = '<root><name>demo</name><count>3</count></root>';
    const result = await engine.convertFormat(xml, {
      sourceFormat: 'xml',
      targetFormat: 'json',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = JSON.parse(result.output);
    expect(parsed.root.name).toBe('demo');
  });

  it('auto-detects source format for properties to json', async () => {
    const engine = await loadConvert();
    if (!engine) {
      const obj = parseProperties('a=1\nb=two');
      expect(obj).toEqual({ a: '1', b: 'two' });
      return;
    }

    const result = await engine.convertFormat('a=1\nb=two', {
      sourceFormat: 'auto',
      targetFormat: 'json',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceFormat).toBe('properties');
    expect(JSON.parse(result.output)).toEqual({ a: '1', b: 'two' });
  });

  it('returns friendly error for invalid JSON', async () => {
    const engine = await loadConvert();
    if (!engine) {
      return;
    }

    const result = await engine.convertFormat('{bad', {
      sourceFormat: 'json',
      targetFormat: 'yaml',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('tools.format_convert.json_parse_fail');
  });
});
