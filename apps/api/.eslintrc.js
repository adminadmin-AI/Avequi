/**
 * ESLint da API (NestJS). Config lean de adoção: pega erros reais sem bloquear
 * em estilo pré-existente. O gate forte de tipos é o `nest build` (tsc); aqui
 * focamos em bugs (no-undef, no-case-declarations, unused vars como aviso).
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, jest: true },
  ignorePatterns: ['dist', 'node_modules', 'coverage', 'src/__mocks__', 'prisma'],
  rules: {
    // Codebase usa `any` deliberadamente (DTOs/mocks); o tsc cobre os tipos reais.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-empty-object-type': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    // require() é usado deliberadamente p/ deps nativas/opcionais e mocks de teste.
    '@typescript-eslint/no-require-imports': 'off',
    'no-empty': ['warn', { allowEmptyCatch: true }],
    'no-useless-escape': 'warn',
  },
};
