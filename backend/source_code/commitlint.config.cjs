/** Commit message rules. */

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'revert',
        'chore',
        'wip'
      ]
    ],
    'subject-case': [0]
  },

  prompt: {
    messages: {
      type: 'Select the change type:',
      scope: 'Select a scope (optional):',
      customScope: 'Enter a custom scope:',
      subject: 'Enter a concise change description:\n',
      body: 'Enter a detailed description (optional). Use "|" for line breaks:\n',
      breaking: 'List breaking changes (optional). Use "|" for line breaks:\n',
      footerPrefixesSelect: 'Select an issue prefix (optional):',
      customFooterPrefix: 'Enter a custom issue prefix:',
      footer: 'List related issues (optional), for example #31:\n',
      confirmCommit: 'Commit or revise this message?'
    },
    // prettier-ignore
    types: [
      { value: "feat",     name: "feat:     add a feature" },
      { value: "fix",      name: "fix:      fix a defect" },
      { value: "docs",     name: "docs:     update documentation" },
      { value: "style",    name: "style:    change formatting only" },
      { value: "refactor", name: "refactor: restructure code" },
      { value: "perf",     name: "perf:     improve performance" },
      { value: "test",     name: "test:     add or update tests" },
      { value: "build",    name: "build:    change build or dependencies" },
      { value: "ci",       name: "ci:       change CI configuration" },
      { value: "revert",   name: "revert:   revert a change" },
      { value: "chore",    name: "chore:    change maintenance tooling" },
    ],
    useEmoji: true,
    emojiAlign: 'center',
    themeColorCode: '',
    scopes: [],
    allowCustomScopes: true,
    allowEmptyScopes: true,
    customScopesAlign: 'bottom',
    customScopesAlias: 'custom',
    emptyScopesAlias: 'empty',
    upperCaseSubject: false,
    markBreakingChangeMode: false,
    allowBreakingChanges: ['feat', 'fix'],
    breaklineNumber: 100,
    breaklineChar: '|',
    skipQuestions: ['breaking', 'footerPrefix', 'footer'],
    issuePrefixes: [{ value: 'closed', name: 'closed:   ISSUES has been processed' }],
    customIssuePrefixAlign: 'top',
    emptyIssuePrefixAlias: 'skip',
    customIssuePrefixAlias: 'custom',
    allowCustomIssuePrefix: true,
    allowEmptyIssuePrefix: true,
    confirmColorize: true,
    maxHeaderLength: Infinity,
    maxSubjectLength: Infinity,
    minSubjectLength: 0,
    scopeOverrides: undefined,
    defaultBody: '',
    defaultIssues: '',
    defaultScope: '',
    defaultSubject: ''
  }
}
