# Contributing

Bug reports, pet artwork, translations, and focused pull requests are welcome.
For a larger change, open an issue first so we can agree on scope.

Use Node.js 22.12 or later and Python 3. On macOS Apple Silicon:

```sh
npm ci
npm test
npm run smoke
```

The smoke suite opens this app's own test windows with isolated settings. It does
not operate Codex or Claude windows or submit prompts to models.

Keep session identity explicit. Do not infer completion from assistant prose,
clear unanswered questions on a click, or transmit conversations to a server.
Check failure recovery as well as the happy path when changing integrations.
Changes to supported platforms need evidence on those platforms.

Include the problem, resulting behavior, and checks actually run in a pull
request. Do not include credentials, personal conversations, local runtime
files, or screenshots of private sessions. Contributions are provided under
the project's MIT license. Attribute third-party assets and verify their license.
