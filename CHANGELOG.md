# Changelog

## 0.2.1 — 2026-10-07

Plugin distribution and directory submission preparation.

- A self-contained OpenAI-format plugin ZIP, containing the Codex skill and
  Python helper, with English and Korean listing text.
- A shared transparent gorilla-and-tiger icon, Claude directory metadata, and
  public support, privacy, and MIT terms pages.
- Release packaging and CI check that copied skills, helpers, artwork, licenses,
  and plugin versions match their canonical sources.
- Explicit platform requirements and a maintainer submission guide. Official
  directory listings still require portal submission, review, and publication.

Desktop behavior and the support boundaries below are unchanged from 0.2.0.

## 0.2.0 — 2026-10-07

First public release for macOS Apple Silicon.

- A floating gorilla or tiger for each connected session, with drag, hover,
  cursor reactions, expressions, and a transparent character picker.
- Click a pet to open its original Codex or Claude session.
- Codex completion and structured question tracking, including partial answers,
  long waits, and reconnect recovery. No badge while ordinary work is in progress.
- Claude Code hook integration for questions, approvals, and subagent discovery.
- Custom PNG/sprite pets and interface language inherited from the host app.
- Downloadable app and installer, Codex skill and Claude plugin archives,
  English/Korean documentation, and a public Claude marketplace entry.

### Scope

Windows and Intel Mac builds are not included. The binary is not Developer ID
signed or notarized. Claude Stop does not establish verified task completion;
Codex automatic subagent discovery and cross-session links are not supported.
