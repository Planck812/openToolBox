import { describe, expect, it } from 'vitest';
import { stripMermaidFence } from '../index';

describe('stripMermaidFence', () => {
  it('strips ```mermaid fence from markdown block', () => {
    const fenced = '```mermaid\nflowchart LR\n  A --> B\n```';
    expect(stripMermaidFence(fenced)).toBe('flowchart LR\n  A --> B');
  });

  it('leaves plain mermaid source untouched', () => {
    const plain = 'flowchart LR\n  A --> B';
    expect(stripMermaidFence(plain)).toBe(plain);
  });

  it('keeps source when only the opening fence matches', () => {
    const missingEnd = '```mermaid\nflowchart LR\n  A --> B';
    expect(stripMermaidFence(missingEnd)).toBe(missingEnd);
  });

  it('keeps source when the closing fence is missing', () => {
    const missingClose = '```mermaid\nflowchart LR\n  A --> B\nnot-a-fence';
    expect(stripMermaidFence(missingClose)).toBe(missingClose);
  });

  it('keeps bare code fence without mermaid language tag', () => {
    const bare = '```\nflowchart LR\n  A --> B\n```';
    expect(stripMermaidFence(bare)).toBe(bare);
  });

  it('tolerates leading/trailing whitespace and CRLF line endings', () => {
    const fenced = '```mermaid\r\nflowchart LR\r\n  A --> B\r\n```';
    expect(stripMermaidFence(fenced)).toBe('flowchart LR\n  A --> B');
  });

  it('returns text unchanged for fewer than three lines', () => {
    const twoLines = '```mermaid\n```';
    expect(stripMermaidFence(twoLines)).toBe(twoLines);
  });

  it('strips fence when opening tag has extra attributes', () => {
    const fenced = '```mermaid {.zoom}\nsequenceDiagram\n  A->>B: hi\n```';
    expect(stripMermaidFence(fenced)).toBe('sequenceDiagram\n  A->>B: hi');
  });
});
