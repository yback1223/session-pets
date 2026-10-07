# Session-Pets for Codex

Give your current local Codex session a floating gorilla, tiger, or custom pet.
Click the pet to return to that session, drag it around, or double-click to dance.
Supported questions stay visible until answered; a green badge marks an observed
Codex turn ending. Ordinary work has no persistent status badge.

**Requires the separate [Session Pets desktop app](https://github.com/yback1223/session-pets/releases/latest),
macOS 13 or later on Apple Silicon, Python 3, and a local Codex session with shell
access.** Installing this plugin does not install the app. Web and mobile chats
cannot launch a local desktop pet. Automatic Codex subagent discovery and
cross-session links are not supported.

## Use

Install the desktop app, open it, then invoke **Session-Pets** from the intended
Codex session. The desktop installer also provides the standalone `$Session-Pets`
skill. Use one copy of the skill in a session to avoid duplicate suggestions.

- **Session-Pets**: show the remembered pet, or open the character picker.
- **Session-Pets choose**: browse characters or import a custom PNG/sprite.
- **Session-Pets hide**: hide the current session's pet.
- **Session-Pets status**: inspect the observed state.

The name stays `Session-Pets` in every language. The interface follows the host's
language, with English and Korean included. For other locales, your current
assistant translates the UI strings and saves a local catalog.

## What runs

When explicitly invoked, the skill runs its bundled Python helper. The helper
uses the current Codex session ID to contact a user-only local Unix socket. It
can open the already installed Session Pets app if it is not running. It does
not download or install software. The desktop app reads the linked session's
local execution records and stores preferences, imported artwork, and UI
translations on the Mac. It does not send session data to yback or run an AI
model of its own. No extra account or API key is required.

This package contains a skill and helper only; it has no MCP server, app binding,
or lifecycle hooks. The macOS app is not Developer ID signed or notarized.
Completion indicates an observed Codex turn ended, not that a whole project
succeeded. Host accounts, usage limits, and execution permissions still apply.

Free, independent software by [yback](https://github.com/yback1223), under [MIT](LICENSE).
[Installation and usage](https://github.com/yback1223/session-pets/blob/main/docs/usage.md)
· [Support](https://github.com/yback1223/session-pets/blob/main/docs/SUPPORT.md)
· [Privacy](https://github.com/yback1223/session-pets/blob/main/docs/PRIVACY.md)
· [Terms](https://github.com/yback1223/session-pets/blob/main/docs/TERMS.md)
