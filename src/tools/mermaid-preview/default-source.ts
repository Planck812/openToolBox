import i18n from '@/i18n';

export const DEFAULT_MERMAID_SOURCE = `flowchart TD
    A[${i18n.global.t('tools.mermaid_preview.default_source.start')}] --> B{${i18n.global.t('tools.mermaid_preview.default_source.needs_review')}}
    B -->|${i18n.global.t('tools.mermaid_preview.default_source.yes')}| C[${i18n.global.t('tools.mermaid_preview.default_source.manual_confirm')}]
    B -->|${i18n.global.t('tools.mermaid_preview.default_source.no')}| D[${i18n.global.t('tools.mermaid_preview.default_source.auto_publish')}]
    C --> E[${i18n.global.t('tools.mermaid_preview.default_source.done')}]
    D --> E[${i18n.global.t('tools.mermaid_preview.default_source.done')}]`;
