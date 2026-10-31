import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import prettier from '@vue/eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['out/**', 'release/**', 'node_modules/**', 'dist/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser
      }
    },
    rules: {
      // typescript-eslint 只对 **/*.ts 关闭 no-undef,.vue 落在覆盖范围外,
      // 于是 window / console 这些浏览器全局会被当成未定义变量。
      // TS 本身已经查得出未定义标识符(而且更准),这里直接关掉。
      'no-undef': 'off'
    }
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off'
    }
  },
  prettier
);
