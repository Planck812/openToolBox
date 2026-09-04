import type { Component } from 'vue';

export interface ToolMetadata {
  id: string;
  name: string; // i18n key
  description: string; // i18n key
  icon: Component;
  keywords: string[];
}

export interface ToolMatchResult {
  toolId: string;
  score: number; // 0 to 100
  matchedData?: unknown; // The data that triggered the match (e.g. parsed JSON)
}

export interface Tool {
  metadata: ToolMetadata;
  component: () => Promise<Component>; // Lazy load component
  match: (input: string) => ToolMatchResult | null;
}
