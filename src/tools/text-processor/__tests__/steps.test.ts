// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { applyStep, runPipeline, type PipelineStep, type StepOp, type StepScope } from '../steps';
import { processText, type ProcessType } from '../index';
import { digestText, type HashAlgorithm } from '../../hash-tool/runtime';

const deps = {
  digestText: (algorithm: string, text: string) => digestText(algorithm as HashAlgorithm, text),
};

let seq = 0;
const makeStep = (
  op: StepOp,
  params: Record<string, unknown> = {},
  scope: StepScope = 'whole',
): PipelineStep => {
  seq += 1;
  return { id: `step-${op}-${seq}`, op, scope, params };
};

describe('existing conversions match processText', () => {
  const cases: Array<[ProcessType, string]> = [
    ['upper', 'hello world'],
    ['base64_encode', 'hello 世界'],
    ['remove_escape', '"\\n\\t"'],
    ['lower', 'HELLO WORLD'],
    ['url_encode', 'a b&c'],
    ['full_to_half', '，。ａｂｃ'],
    ['snake_to_camel', 'hello_world'],
  ];

  for (const [op, input] of cases) {
    it(`reuses processText for ${op}`, async () => {
      const result = await runPipeline(input, [makeStep(op)], deps);
      expect(result.text).toBe(processText(input, op));
      expect(result.statsReport).toBeNull();
    });
  }
});

describe('new conversions', () => {
  it('title_case capitalizes each word', async () => {
    const { text } = await runPipeline('hello WORLD foo_bar', [makeStep('title_case')], deps);
    expect(text).toBe('Hello World Foo_Bar');
  });

  it('sentence_case capitalizes only the first letter', async () => {
    const { text } = await runPipeline('  hello world. second.', [makeStep('sentence_case')], deps);
    expect(text).toBe('  Hello world. second.');
  });

  it('html_encode / html_decode handle special chars', async () => {
    const encoded = await runPipeline(
      `<a href="x">a & b 'c'</a>`,
      [makeStep('html_encode')],
      deps,
    );
    expect(encoded.text).toBe('&lt;a href=&quot;x&quot;&gt;a &amp; b &#39;c&#39;&lt;/a&gt;');

    const decoded = await runPipeline('&lt;a&gt;&amp;&quot;&#39;', [makeStep('html_decode')], deps);
    expect(decoded.text).toBe('<a>&"\'');
  });

  it('markdown_to_plain extracts text from code blocks and links', async () => {
    const markdown =
      '# Hello\n\nThis is **bold** [link](https://example.com)\n\n```js\nconst x = 1 < 2\n```';
    const { text } = await runPipeline(markdown, [makeStep('markdown_to_plain')], deps);
    expect(text).toBe('Hello\nThis is bold link\nconst x = 1 < 2\n\n');
  });

  it('reverse applies to whole text vs per line', async () => {
    const whole = await runPipeline('abc\ndef', [makeStep('reverse', {}, 'whole')], deps);
    expect(whole.text).toBe('fed\ncba');

    const line = await runPipeline('abc\ndef', [makeStep('reverse', {}, 'line')], deps);
    expect(line.text).toBe('cba\nfed');
  });

  it('number_format groups thousands and applies decimals', async () => {
    const { text } = await runPipeline(
      'price 1234567.891 and 1234',
      [makeStep('number_format', { decimals: 2 })],
      deps,
    );
    expect(text).toBe('price 1,234,567.89 and 1,234');
  });

  it('camel_to_kebab / kebab_to_camel', async () => {
    const kebab = await runPipeline('helloWorld HTTPResponse', [makeStep('camel_to_kebab')], deps);
    expect(kebab.text).toBe('hello-world http-response');

    const camel = await runPipeline('hello-world --foo-bar', [makeStep('kebab_to_camel')], deps);
    expect(camel.text).toBe('helloWorld FooBar');
  });
});

describe('pipeline execution', () => {
  it('runs multi-step pipeline in order', async () => {
    const steps = [makeStep('remove_space'), makeStep('upper'), makeStep('base64_encode')];
    const input = '  hello   world  ';
    const expected = processText(
      processText(processText(input, 'remove_space'), 'upper'),
      'base64_encode',
    );

    const { text } = await runPipeline(input, steps, deps);
    expect(text).toBe(expected);
  });

  it('applies line scope per line', async () => {
    const { text } = await runPipeline('abc\ndef\nghi', [makeStep('upper', {}, 'line')], deps);
    expect(text).toBe('ABC\nDEF\nGHI');
  });

  it('runs batch steps over line arrays', async () => {
    const { text } = await runPipeline(
      'a\nb\nc',
      [makeStep('line_number', { start: 1, padding: 2 })],
      deps,
    );
    expect(text).toBe('01\ta\n02\tb\n03\tc');
  });

  it('deduplicates lines as a batch step', async () => {
    const { text } = await runPipeline(
      'a\nb\na\nc\nb',
      [makeStep('line_dedup')],
      deps,
    );
    expect(text).toBe('a\nb\nc');
  });

  it('line_dedup supports ignoreCase and sortOutput params', async () => {
    const { text } = await runPipeline(
      'banana\napple\nBanana',
      [makeStep('line_dedup', { ignoreCase: true, sortOutput: true })],
      deps,
    );
    expect(text).toBe('apple\nbanana');
  });

  it('joins lines into a single line as a batch step', async () => {
    const { text } = await runPipeline(
      'a\nb\nc',
      [makeStep('line_join', { delimiter: ',' })],
      deps,
    );
    expect(text).toBe('a,b,c');
  });

  it('line_join supports quote wrapping and defaults delimiter to comma', async () => {
    const { text } = await runPipeline(
      'a\nb',
      [makeStep('line_join', { quote: true })],
      deps,
    );
    expect(text).toBe('"a","b"');
  });

  it('splits lines into a single column as a batch step', async () => {
    const { text } = await runPipeline(
      'a,b\nc,d',
      [makeStep('line_split', { delimiter: ',' })],
      deps,
    );
    expect(text).toBe('a\nb\nc\nd');
  });

  it('line_join and line_split round-trip', async () => {
    const { text } = await runPipeline(
      'a,b,c',
      [makeStep('line_split', { delimiter: ',' }), makeStep('line_join', { delimiter: ',' })],
      deps,
    );
    expect(text).toBe('a,b,c');
  });

  it('stats step leaves text unchanged and computes on current state', async () => {
    const { text, statsReport } = await runPipeline(
      'a b',
      [makeStep('remove_space'), makeStep('stats', { topN: 3 })],
      deps,
    );
    expect(text).toBe('ab');
    expect(statsReport).not.toBeNull();
    expect(statsReport!.chars).toBe(2);
    expect(statsReport!.words).toBe(1);
  });

  it('stats alone does not alter text', async () => {
    const { text, statsReport } = await runPipeline('hello world', [makeStep('stats')], deps);
    expect(text).toBe('hello world');
    expect(statsReport!.words).toBe(2);
  });
});

describe('hash steps', () => {
  it('produces MD5 digest matching known vector', async () => {
    const { text } = await runPipeline('abc', [makeStep('hash_md5')], deps);
    expect(text).toBe('900150983cd24fb0d6963f7d28e17f72');
  });

  it('produces SHA-256 digest matching known vector', async () => {
    const { text } = await runPipeline('abc', [makeStep('hash_sha256')], deps);
    expect(text).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches independent digestText result', async () => {
    const result = await runPipeline('hello 世界', [makeStep('hash_sha1')], deps);
    expect(result.text).toBe(await digestText('SHA-1', 'hello 世界'));
  });

  it('hashes each line in line scope', async () => {
    const md5 = await digestText('MD5', 'abc');
    const { text } = await runPipeline('abc\nabc', [makeStep('hash_md5', {}, 'line')], deps);
    expect(text).toBe(`${md5}\n${md5}`);
  });
});

describe('error handling', () => {
  it('throws PipelineStepError with step index and op', async () => {
    await expect(runPipeline('!!!', [makeStep('base64_decode')], deps)).rejects.toThrow(
      'tools.text_processor.pipeline_step_failed',
    );
  });

  it('preserves step index for a later failing step', async () => {
    const steps = [makeStep('upper'), makeStep('base64_decode')];
    await expect(runPipeline('abc\n!!!', steps, deps)).rejects.toThrow(
      'tools.text_processor.pipeline_step_failed',
    );
  });

  it('applyStep delegates a single step', async () => {
    const text = await applyStep('hello', makeStep('upper'), deps);
    expect(text).toBe('HELLO');
  });
});

describe('default builtin pipelines execution', () => {
  const sampleInput = `apple
banana
apple
  orange  

banana`;

  it('runs 快速合并: dedup and join with comma', async () => {
    const { DEFAULT_BUILTIN_PIPELINES } = await import('../pipeline-store');
    const p = DEFAULT_BUILTIN_PIPELINES.find((item) => item.name === '快速合并')!;
    const { text } = await runPipeline(sampleInput, p.steps, deps);
    expect(text).toBe('apple,banana,orange');
  });

  it('runs 引号合并: dedup, single quote, and join with comma', async () => {
    const { DEFAULT_BUILTIN_PIPELINES } = await import('../pipeline-store');
    const p = DEFAULT_BUILTIN_PIPELINES.find((item) => item.name === '引号合并')!;
    const { text } = await runPipeline(sampleInput, p.steps, deps);
    expect(text).toBe("'apple','banana','orange'");
  });
});
