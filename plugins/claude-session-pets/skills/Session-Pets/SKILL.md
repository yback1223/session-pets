---
name: Session-Pets
description: Choose, summon, or hide a floating desktop companion for the current Claude Code session. Use only when the user explicitly requests Session-Pets.
disable-model-invocation: true
argument-hint: "[choose | hide | status | pet name]"
---

# Session-Pets

A local companion for the current session. Requires the Session Pets macOS app and Python 3. Keep the command name **Session-Pets** unchanged in every language.

## Host language

Before the requested pet action, run the same helper with `prepare-language` and the same provider/session arguments. This reads the calling app's configured interface locale. Do not infer that locale from the conversation, nationality, or project language.

If `translationReady` is true, continue immediately. Otherwise the response contains `translationRequest` with the exact locale, a local `catalogPath`, and all English UI messages keyed by stable Korean source strings. Use your own language ability to translate **every value** into that locale; keep every key and every `{placeholder}` unchanged. Write a UTF-8 JSON file at the supplied path with only `version: 1`, the exact `locale`, and the full translated `messages` object. These are product UI strings, not session messages. Do not use a remote translation API or ask for an API key. Preserve product names, command IDs, and keyboard shortcuts. Keep small badges and button labels short. The skill name and display name are always Session-Pets; never translate or rename them. Translated descriptions and argument hints must each fit on one line of at most 64 characters.

Run `prepare-language` again to validate the file. If it still reports `translationReady: false`, repair the file once; if validation still fails, explain the language limitation instead of claiming that it was applied. Once ready, run the user's original summon/choose/hide/status request. The app caches this translation locally and reuses it. Installed skill labels update when the host next reloads its skills; the invocation name `Session-Pets` stays the same in all languages. If you cannot write files in the current host, explain that local execution is required.

Use the returned locale for confirmations and errors. The fixed name Session-Pets does not determine the response language.

## Run the requested action

The current session is `${CLAUDE_SESSION_ID}`. User request: $ARGUMENTS. If the skill-directory variable is not expanded, use the actual parent of this SKILL.md. An empty or unexpanded session ID is an error.

Run the helper with arguments passed safely as separate values. Paths can contain spaces.

```sh
python3 "${CLAUDE_SKILL_DIR}/scripts/pet.py" --provider claude --session "${CLAUDE_SESSION_ID}"
```

- No action: show the remembered pet, or open the transparent character picker on first use.
- `choose`: open the picker. The user can change characters or import their own PNG/sprite.
- `hide`: hide this session's pet.
- `status`: report the observed state.
- A specific character: pass its exact name or ID using `--pet`. Built-ins: `gorilla` and `tiger`.

Never guess a session ID from folders, recent history, or another conversation. Do not dump environment variables, credentials, or conversations. Do not turn user text into shell code. Do not execute model requests, send messages, change permissions, or control other sessions.

A `choosing` result means the picker opened, not that the user selected a pet. Report visibility only for `visible`; surface errors accurately. Pet clicks open the original session; input and model selection stay in that app. Double-click dances, scrolling changes expressions, and hovering reveals controls.

The app observes supported session events. Ordinary work has no status badge. Questions, approvals, and verified Codex completion have their own indicators. Do not infer completion yourself. Claude event observation requires the separate session-pets hook plugin to be enabled.
