# Local data and privacy

Session-Pets is a local desktop companion. Version 0.2.1 has no developer-operated
server, account, analytics, or telemetry endpoint. It does not need an API key.
Your Codex and Claude apps still have their own accounts, network connections,
data handling, and usage charges.

## What the app reads

- **Codex:** the skill supplies the current session ID and working directory.
  For linked sessions, the app reads local session JSONL files to recognize
  explicit start, completion, question, and answer events. Those files can
  contain conversation text; the status reader processes them locally and does
  not copy the transcript into its preferences. Codex's local read-state file
  lets it clear a completion notice when you return to the conversation.
- **Claude Code:** the enabled plugin sends a limited set of hook fields to the
  app through a local Unix socket. These include session and tool/request IDs,
  event types, working directory, agent type, and up to 60,000 characters of the
  last assistant message when Claude includes it. The current app can keep that
  message in memory; it does not persist it in its preferences. User prompts,
  tool arguments, and transcript files are not forwarded by the hook.
- **Language:** the app reads the host's locale setting, with the computer's
  preferred language as a fallback. It does not modify Codex or Claude settings.
- **Custom pets:** images and manifests you explicitly import are read and
  copied into the app's local pet library.

The app does not send prompts, change models, approve requests, or run tasks in
your sessions. Clicking a pet asks the original host to open that session. For
a Claude CLI session, this uses Claude's supported desktop resume command.

## What stays on disk

On macOS, app data lives in:

```text
~/Library/Application Support/session-pets/
```

`preferences.json` stores selected session IDs, titles, working directories,
parent relationships, pet choices, visibility, window positions, and completion
acknowledgements. It does **not** store assistant messages or full transcripts.
Imported pet files and cached UI translations are stored alongside it. The
directory is created with user-only permissions; preferences and the local
control/hook sockets are also restricted to the current user.

Installed skills live in `~/.agents/skills/Session-Pets/` and
`~/.claude/skills/Session-Pets/`. Their `scripts/runtime.json` records the local
app path. The installer also leaves a private `.session-pets-install.lock` in
your home folder to coordinate updates. Claude manages its own plugin cache and
registration when you install the marketplace plugin.
Plugin-manager installations use that host's plugin storage rather than these
standalone skill folders. The OpenAI-format package includes the same local
Codex helper and does not add an external connection.

English and Korean UI strings are bundled. For another language, the invoked
skill asks your existing assistant to translate the product's UI strings and
write a local catalog. That uses the host assistant's normal processing and
usage limits; Session-Pets has no separate translation service. Session text is
not included in the translation catalog.

## Removing your data

Quit Session Pets, uninstall or disable the `session-pets` plugin in Claude, and
remove the Session Pets app and the two Session-Pets skill folders if you no
longer need them. Removing the app-data directory above deletes this app's saved
pet choices, session metadata, imported pets, and translation cache. It does not
delete your Codex or Claude conversations.

GitHub issues and discussions are public. Before attaching logs or screenshots,
remove private session titles, paths, conversations, and credentials. To report
a security issue privately, follow [SECURITY.md](../SECURITY.md).
