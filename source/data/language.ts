/**
 * Maps a file path onto a highlighter language.
 *
 * The names are the ones the highlighter registers (highlight.js), so passing
 * the result straight through never trips an unknown-language error. Only
 * extensions we can highlight appear here; anything else returns undefined and
 * the diff falls back to plain text.
 */
const byExtension: Readonly<Record<string, string>> = {
	ts: 'typescript',
	mts: 'typescript',
	cts: 'typescript',
	tsx: 'tsx',
	js: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	jsx: 'jsx',
	json: 'json',
	md: 'markdown',
	markdown: 'markdown',
	css: 'css',
	scss: 'scss',
	less: 'less',
	html: 'xml',
	htm: 'xml',
	xml: 'xml',
	svg: 'xml',
	php: 'php',
	py: 'python',
	rb: 'ruby',
	go: 'go',
	rs: 'rust',
	java: 'java',
	c: 'c',
	h: 'c',
	cpp: 'cpp',
	cc: 'cpp',
	cxx: 'cpp',
	hpp: 'cpp',
	cs: 'csharp',
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	yml: 'yaml',
	yaml: 'yaml',
	toml: 'ini',
	ini: 'ini',
	sql: 'sql',
	graphql: 'graphql',
	lua: 'lua',
	swift: 'swift',
	kt: 'kotlin',
	pl: 'perl',
	scala: 'scala',
	dart: 'dart',
};

/** The highlighter language for a path, or undefined when it is unknown. */
export const languageForPath = (path: string): string | undefined => {
	const dot = path.lastIndexOf('.');
	if (dot === -1) {
		return undefined;
	}

	return byExtension[path.slice(dot + 1).toLowerCase()];
};
