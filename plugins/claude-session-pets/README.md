# Session-Pets for Claude Code

A small desktop companion for the session you are working in. Pick the gorilla
or tiger, let it react to your cursor, and click it to return to the original chat.
Question and approval alerts stay visible when your input is needed. Connected
subagents can appear as smaller companions.

**Requires the [Session Pets desktop app](https://github.com/yback1223/session-pets/releases/latest),
macOS Apple Silicon, Python 3, and Claude Code.** Installing this plugin alone does
not install the desktop app. It does not add a hosted AI service or require an
additional API key.

## Install

Install the desktop app and its local skills first, then run in Claude Code:

```text
/plugin marketplace add yback1223/session-pets
/plugin install session-pets@session-pets
```

Reload plugins or restart Claude Code after installation. This enables the hooks
that observe the current session; existing sessions do not gain past events.

## Use

The desktop installer provides the short command **`/Session-Pets`**. This plugin
also provides the fully qualified command **`/session-pets:Session-Pets`**.
The name stays the same in every language.

| Request | Result |
| --- | --- |
| `/Session-Pets` | Show this session's pet, or open the picker on first use |
| `/Session-Pets choose` | Pick a different character or import your own pet |
| `/Session-Pets hide` | Hide this session's pet |
| `/Session-Pets status` | Inspect the observed state |

Hover to reveal controls. Drag to move. Double-click to dance. Questions and
approvals get a visible alert; ordinary work does not get a status badge.
Prompts, model selection, and attachments remain in Claude Code.

## What the hooks establish

The plugin observes question, approval, session, and subagent events through a
private local socket. It does not answer questions or approve tools. A Claude
Stop event is treated as a reply observed, **not verified task completion**.
Automatic subagent retirement has the same completion limitation.

No session content is sent to the developer. The most recent assistant reply
may be passed locally and retained in app memory; see the full
[data-use guide](https://github.com/yback1223/session-pets/blob/main/docs/PRIVACY.md).

Free, independent software by **yback**, under the MIT license. Not affiliated
with Anthropic or OpenAI. [Help and issues](https://github.com/yback1223/session-pets/issues).
