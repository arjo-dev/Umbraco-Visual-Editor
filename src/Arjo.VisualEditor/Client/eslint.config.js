import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import lit from 'eslint-plugin-lit';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
	{
		// Generated API client is regenerated from the OpenAPI spec; don't lint it.
		ignores: ['node_modules/', 'src/api/'],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	lit.configs['flat/recommended'],
	{
		languageOptions: {
			globals: { ...globals.browser },
		},
		rules: {
			'@typescript-eslint/consistent-type-imports': 'error',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		},
	},
	{
		files: ['scripts/**/*.js'],
		languageOptions: {
			globals: { ...globals.node },
		},
	},
	prettier,
);
