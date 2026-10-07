# Session-Pets usage guide

[README](../README.md) · [한국어](usage.ko.md)

## Installation and first use

The release ZIP is for **macOS 13 or later on Apple Silicon**. Intel Macs, Windows, and Linux have not been tested as desktop targets. The installer and session helpers need **Python 3**; a prebuilt app does not need Node.js. Check Python with:

```sh
python3 --version
```

Download `Session-Pets-v0.2.2-macos-arm64.zip` from [Releases](https://github.com/yback1223/session-pets/releases/latest), unzip it, and double-click `Install Session Pets.command`.

| Item | Location |
|---|---|
| Desktop app | `~/Applications/Session Pets.app` |
| Codex skill | `~/.agents/skills/Session-Pets` |
| Claude Code skill | `~/.claude/skills/Session-Pets` |
| Settings, imported pets, and translations | `~/Library/Application Support/session-pets/` |

The installer protects unrelated existing skills. It does not install Python, change host approval policies, or enable the Claude hook plugin for existing sessions.

The app is not Developer ID signed or notarized. If macOS blocks an item you trust, attempt to open it once, then use **System Settings → Privacy & Security → Open Anyway**. See [Apple's instructions](https://support.apple.com/en-us/102445). There is no automatic updater; install newer releases manually.

Open the app, then run `$Session-Pets` in Codex or `/Session-Pets` in Claude Code. A local host that can run the Python helper and supply the current session ID is required. The first call opens the transparent character picker. Use **← / →**, click the character or press **Enter** to select, and **Esc** to cancel. Later calls restore that session's chosen pet. Run the command in each session you want to connect: each gets its own pet, and pets from multiple sessions can appear on screen together.

Opening the app by itself shows a default-character picker. This changes the default for future selections; it does not attach a pet to an arbitrary session. Use the **🐾 menu bar icon** to change the default or quit.

## Session commands

| Action | Codex | Claude Code |
|---|---|---|
| Summon or restore | `$Session-Pets` | `/Session-Pets` |
| Open the picker | `$Session-Pets choose` | `/Session-Pets choose` |
| Hide this session's pet | `$Session-Pets hide` | `/Session-Pets hide` |
| Check connection and state | `$Session-Pets status` | `/Session-Pets status` |
| Choose the gorilla directly | `$Session-Pets gorilla` | `/Session-Pets gorilla` |
| Choose the tiger directly | `$Session-Pets tiger` | `/Session-Pets tiger` |

The name **`Session-Pets` is the same in every language**, including capitalization. In Codex, you can also use the skill picker. Reload skills or reopen the host if the command is missing.

The helper uses Codex's current `CODEX_THREAD_ID` / `CODEX_SESSION_ID`, or Claude's supplied session ID. It refuses to guess from recent conversations or folder names. If the app is closed, the helper can start the installed app in the background.

## Pet controls

| Interaction | Result |
|---|---|
| Single click or Enter | Open the original session |
| Drag and release | Move the pet; linked small pets follow their parent |
| Double-click | Dance without opening the session |
| Scroll over the pet | Cycle expressions |
| Right-click or the `‹›` button | Open the character picker |
| `×` button | Hide this pet |
| Hover or keyboard focus | Reveal the name, details, and tools |
| Move the pointer nearby | The pet follows it with a glance |
| Move the pointer quickly nearby | A laugh or an annoyed reaction |

Gorilla Boss and Roary each have 16 poses. The picker previews dancing, laughing, anger, and a playful growl. Expressions do not change the observed task state. macOS **Reduce Motion** stops repeated motion and effects while preserving static reactions. A single mouse click waits 260 ms so a double-click can remain a dance gesture.

## Opening the original session

Codex pets dispatch `codex://threads/<session-id>`. Claude Desktop pets dispatch `claude://code/continue?session=<session-id>`. Small Claude pets open their parent conversation.

For a Claude CLI session, the app runs `claude --desktop --resume <exact-session-id>` in the recorded working directory. This needs a compatible Claude Code CLI, Claude Desktop, and the host's required login. Claude may refuse a session still running in a terminal or background process. Use that terminal, or finish and close the session before trying the handoff again. Session-Pets does not stop it or create a replacement conversation.

A successful dispatch means the operating system or CLI accepted the request; it does not verify the host's final visible screen. Missing apps, unknown session IDs, and failed handoffs produce an error. Summon an older Claude pet again if its launch context is missing.

## Claude Code plugin

The locally installed `/Session-Pets` skill handles summoning, selection, hiding, and state queries. **Claude status and subagent events require the hook plugin to be enabled for the session.**

In Claude Code:

```text
/plugin marketplace add yback1223/session-pets
/plugin install session-pets@session-pets
```

The marketplace and plugin registry ID is lowercase `session-pets`; the skill command is `Session-Pets`. The full plugin command is **`/session-pets:Session-Pets`**. Follow the host's reload instructions after installation. Events from before the plugin was loaded are not replayed.

For local development, start Claude Code with the source plugin directory:

```sh
claude --plugin-dir "/absolute/path/to/session-pets/plugins/claude-session-pets"
```

Or use the plugin included in the installed app:

```sh
claude --plugin-dir "$HOME/Applications/Session Pets.app/Contents/Resources/app/plugins/claude-session-pets"
```

Choose one plugin installation method for a session. Hooks report starts, tool activity, questions, approvals, responses, and explicit subagent starts. If the app is absent, the hook exits quietly. It does not approve requests or change Claude's decisions.

## Status and support boundaries

There is **no persistent working badge**. Question, approval, and unacknowledged completion badges are visible without hovering.

| Display | Meaning |
|---|---|
| Answer needed | A supported structured question is waiting for an answer |
| Approval needed | A supported Claude plan or permission request is waiting |
| Task complete | An explicit Codex end-of-turn record was observed |
| Reply received · completion unconfirmed | A Claude response was observed without proof that work ended |
| Status unknown | The app cannot currently establish the session's state |

Clicking a question badge opens the session and leaves the question pending. The badge clears when a matching answer or failure, a new turn, or an explicit stop resolves the request. Multiple questions remain pending until each is resolved. Finishing an assistant response does not resolve an accepted asynchronous Codex question.

A completion badge clears after Session-Pets successfully dispatches that completed session, when a supported Codex local read-state record shows that result as read, or when a new turn begins. A failed open attempt leaves the badge visible. Reading a result clears its notification; it does not change the recorded completion state.

### Codex

Question and completion flows have been verified on the local macOS test setup. The app watches the specific linked session's execution log and requires matching `task_started` and `task_complete` lifecycle records. Tool completion or the wording of an answer is not sufficient. “Task complete” means the **Codex turn ended**, not that every user requirement passed an independent check.

Structured `request_user_input` and `request_user_input_async` calls are tracked by their identifiers and answers. Separate automatic Codex permission-approval detection, subagent discovery, and links between sessions are not supported.

The reader initially checks the recent 4 MiB of a log and can expand to 16 MiB to find the active turn's start. It then checks appended records about once a second. If no valid update arrives for 90 seconds during an unfinished turn, the state becomes unknown. A long, silent tool run can cause this; a confirmed pending question is exempt. Missing, unreadable, or incompatible records also become unknown and are retried. Host log-format changes may require an integration update.

### Claude Code

The plugin connects `AskUserQuestion`, `ExitPlanMode`, MCP elicitation, and permission notifications to attention badges. Hook transport and resulting UI behavior have been tested with local fixtures. A full live flow with a model-generated Claude question has not been verified.

`Stop` and `SubagentStop` mean a response was observed. Other hooks can keep work running, so these events **do not prove final completion**. Without a matching turn ID, the state remains unknown. A reply does not trigger a completion celebration or automatic removal.

Small pets appear only after explicit subagent-start events and only while their parent pet is connected. Real external subagent completion and automatic removal are not supported. Their completion animation has only been exercised in an isolated managed test. Observed states expire to unknown after 90 seconds without a new event, except while a request is pending; a valid later event restores tracking.

## Language

The pet and its session picker follow the **connected host's display language**, not the conversation language. Codex's `desktop.localeOverride` or Claude Desktop's `locale` takes precedence, followed by the macOS per-app language, then the system language. The default picker follows the system language; the shared menu follows the last active host.

English and Korean are included. On first use in another language, the skill asks your existing Codex or Claude session to translate the UI catalog and save it under `~/Library/Application Support/session-pets/languages/`. There is no separate translation API key. This uses your host's model and local file permissions, and its normal usage terms apply. Catalog keys and placeholders are validated before use; translation quality has not been reviewed for every language.

Without a valid catalog, the UI falls back to English. After changing to a new language, invoke `Session-Pets` again. Installed skill descriptions update when the host reloads them; the command name stays fixed. Session titles and custom pet names remain as supplied. Right-to-left locales use right-to-left layout, while picker arrows retain their physical directions.

## Custom pets

Open the picker and select **＋ Add my pet**. A transparent **PNG** becomes a static pet used in every state. For animation, keep the sprite PNG and a JSON manifest in the same folder, then import the JSON.

For a 1536 × 1024 PNG containing six equal 512 × 512 frames:

```json
{
  "version": 1,
  "name": "My pet",
  "image": "my-pet.png",
  "columns": 3,
  "rows": 2,
  "states": {
    "idle": [0],
    "working": [1],
    "waiting": [2],
    "done": [3],
    "error": [4],
    "sleep": [5]
  }
}
```

Frames start at `0` in the top-left and run left to right. Several frame numbers in a state play in sequence, at approximately seven frames per second. `idle` is required; omitted states reuse it. A `working` sprite is an animation state, not a visible working badge.

Additional states are `unknown`, `observed`, `dance`, `laugh`, `angry`, `threat`, `surprised`, `curious`, `drag`, `blush`, and `greeting`.

| Limit | Maximum |
|---|---|
| PNG file | 12 MiB |
| JSON manifest | 64 KiB |
| Image size | 8192 px per side and 24 million pixels total |
| Sprite grid | 256 frames; image dimensions must divide evenly |
| State sequence | 256 frame entries |
| Pet name | 40 characters |

Image references must stay inside the manifest's directory. Remote URLs and paths outside it are rejected. Invalid imports leave the current pet intact. Successful imports are copied into the app's local data directory.

## Local data and permissions

The runtime uses local Unix sockets, with owner-only `0600` permissions, and contains no telemetry or analytics client. It needs no Session-Pets account or separate API key. Your host retains its own account, network behavior, model charges, and execution permissions.

- **Codex:** the app reads linked session logs, supported local read-state records, and the host's language setting. It does not save a second conversation transcript.
- **Claude:** hooks omit prompt text, tool inputs, and full transcripts. They can send the latest assistant reply, capped at 60,000 characters, which is held in memory and is not persisted in preferences.
- **Saved locally:** session IDs, titles, working directories, pet choices, positions, visibility, completion acknowledgments, imported artwork, and translations. Language metadata is updated only in installed skills marked as owned by Session-Pets.

Question text and answers are not displayed in the pet. The app does not grant approvals, send task prompts, change models, or interrupt sessions. See the [privacy details](PRIVACY.md) for file paths and data handling.

## Troubleshooting

| Problem | What to check |
|---|---|
| Installer reports Python is missing | Make `python3` available, then run it again; Python is not installed automatically |
| A skill already exists | Inspect the named folder; the installer protects unrelated skills |
| Command is missing | Reload skills or restart the host; keep the exact `Session-Pets` capitalization |
| Current session ID is missing | Invoke the skill inside a supported local session, not an unrelated shell |
| App opens but no session pet appears | Summon from the session; the default picker does not establish a connection |
| Claude has no status updates | Enable the hook plugin for that session; the local skill alone is not enough |
| A question is not detected | Only supported structured requests are observed, not ordinary question text |
| State is unknown | Check for compatible local records or hooks; a silent tool may exceed the 90-second observation window |
| Clicking a Claude pet fails | Check Desktop, login, working directory, and active CLI-session restrictions; resummon to refresh an older pet's context |
| A new language stays English | Invoke the skill in that host language and allow its local translation file to be written |

## Development checks

From a source checkout with Node.js 22.12+, npm, and Python 3:

```sh
npm ci
npm start
```

Build the app and install the local session skills:

```sh
npm run pack
npm run install:integrations
```

Available checks:

```sh
npm test
npm run smoke
```

`npm test` runs unit tests. `npm run smoke` runs this app's renderer in an isolated local data directory and writes captures under `work/smoke/`. It does not operate external apps or make live model requests. Smoke mode is source-only; the packaged app does not enter it via `--smoke-test`. Unit and fixture results do not establish all host integrations as live-tested.

## Removal

Quit from the **🐾 menu**, then remove `~/Applications/Session Pets.app`. To remove local commands, remove the `Session-Pets` folders from `~/.agents/skills/` and `~/.claude/skills/`. Uninstall the Claude plugin through Claude Code's plugin manager if you enabled it.

Settings and imported artwork remain in `~/Library/Application Support/session-pets/`. Back up any artwork you want before deleting that directory.
