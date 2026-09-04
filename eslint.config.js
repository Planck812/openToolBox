// ESLint flat config（ESLint 9+/10）
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src-tauri/**',
      'coverage/**',
      'tests/desktop/artifacts/**',
      'public/**',
      '.trellis/**',
      '*.log',
      'tmp_check.js',
      'testLog.txt',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    // Node 脚本/测试文件（.mjs）需要 Node globals。
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // WebdriverIO 桌面 E2E 脚本使用 WDIO 全局。
    files: ['tests/desktop/**/*.mjs'],
    languageOptions: {
      globals: {
        browser: 'readonly',
        $: 'readonly',
        $$: 'readonly',
        expect: 'readonly',
        driver: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      parser: vue.parser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // 项目当前处于债务清理期：以下规则放宽以避免大规模噪音，后续逐步收紧。
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // TS 文件的未定义检查交给 TypeScript 编译器（tsc strict），no-undef 会误报 DOM 类型名。
      'no-undef': 'off',
      // 与项目现有「捕获后包装/重赋值」的错误处理风格冲突，关闭以避免噪音。
      // （ESLint 10 将 preserve-caught-error 升为 core 规则，两个名字都关。）
      'preserve-caught-error': 'off',
      '@typescript-eslint/preserve-caught-error': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-indent': 'off',
      'vue/attribute-hyphenation': 'off',
    },
  },
  {
    // 全局规则放宽（不分文件类型）：风格性/历史债务类问题不阻塞 lint。
    rules: {
      'preserve-caught-error': 'off',
      '@typescript-eslint/preserve-caught-error': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // 声明文件（.d.ts）中的空对象类型与测试文件中的 triple-slash 指令常见，关闭以避免误报。
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/triple-slash-reference': 'off',
      // E2E 清理逻辑需要在 finally 中抛出以保留原始失败，属有意模式。
      'no-unsafe-finally': 'off',
    },
  },
  {
    // 桌面 E2E 脚本运行在 WebdriverIO 环境，未定义全局较多，不阻塞 lint。
    files: ['tests/desktop/**/*.mjs'],
    rules: {
      'no-undef': 'off',
    },
  },
  prettier,
);
