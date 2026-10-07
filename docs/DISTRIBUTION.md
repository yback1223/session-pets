# Distribution and directory submission

Session-Pets is free software by yback. The app, standalone skills, and Claude
marketplace are publicly distributed through this repository. **Official
OpenAI and Anthropic directory submission, approval, and publication have not
been completed.** A GitHub release is not evidence of a directory listing.

## Release contents

| File | Purpose |
| --- | --- |
| `Session-Pets-v0.2.1-macos-arm64.zip` | Desktop app and local skill installer |
| `Session-Pets-v0.2.1-claude-plugin.zip` | Self-contained Claude Code plugin with hooks |
| `Session-Pets-v0.2.1-codex-skill.zip` | Standalone Codex skill |
| `Session-Pets-v0.2.1-openai-plugin.zip` | OpenAI submission package with a skill and helper |
| `SHA256SUMS.txt` | SHA-256 checksums for the four archives |

Both plugin ZIPs contain one top-level `session-pets/` directory. The OpenAI
package has a portable root `plugin.json`; the Claude package has
`.claude-plugin/plugin.json`. Do not upload the desktop ZIP as a plugin.

## OpenAI submission

The source is [plugins/openai-session-pets](../plugins/openai-session-pets).
The package uses the existing Codex integration. It has no MCP server, app
binding, lifecycle hook, payment flow, or reviewer account. Its local desktop
requirements are prominently stated in the listing.

**Local-execution review comes before requesting public review.** OpenAI's
[migration/submission guide](https://developers.openai.com/plugins/guides/submit-claude-plugin)
asks developers to contact their OpenAI partner before submitting a plugin whose
core value requires local execution or access to desktop applications. This
applies to Session-Pets. Identity verification and a valid ZIP do not establish
that this desktop-only workflow is eligible for public listing. If no partner
contact is available, ask [OpenAI Support](https://help.openai.com/en/articles/6614161-how-can-i-contact-support)
for the appropriate intake route; support contact alone is not approval.

1. The authorized publisher completes individual or business verification in
   [OpenAI organization settings](https://platform.openai.com/settings/organization/general),
   and confirms that the status is approved, not merely that the verification
   flow was completed. Resolve the local-execution review route above.
2. Open [the plugin portal](https://platform.openai.com/plugins) with an eligible
   owner or Apps Management Write role. Upload the OpenAI plugin ZIP.
3. Inspect the imported English/Korean listing, category, icons, public links,
   and target surfaces. The public brand is **yback**. `developerName` is omitted
   from the package because the verified publisher identity must be selected
   and checked in the portal; the package must not assert an unverified name.
4. `publication.countries: []` requests **no country restrictions**. Confirm
   the portal's availability setting; host availability still applies.
5. The publisher reviews and completes the current legal/policy attestations,
   then submits. Record the submission ID and status privately. When approved,
   perform the portal's separate publication step and verify the public link.

Skills-only packages do not require MCP test cases or reviewer credentials.
They still require package and policy review. Portal acceptance and eligibility
of this local-desktop workflow remain unconfirmed. Creating an upload draft
does not satisfy the pre-submission contact requirement.

Session-Pets does not require a separate OpenAI API credit purchase. Publisher
verification and API billing are separate requirements to check against the
actual account flow. If verification redirects to Billing, do not assume a
credit purchase is a free verification step; confirm the displayed requirement
before authorizing a charge.

Reference: [OpenAI plugin submission](https://developers.openai.com/plugins/deploy/submission).

## Anthropic submission

Use [the Claude developer portal](https://claude.ai/directory/manage), choose
**Submit new → Plugin bundle**, and enter:

| Field | Value |
| --- | --- |
| Repository | `https://github.com/yback1223/session-pets` |
| Plugin path | `plugins/claude-session-pets` |
| Branch | `main` |
| Name | `session-pets` |
| Display name | `Session-Pets` |

The publisher needs an eligible paid Claude plan and a GitHub account connected
in the submitting Claude organization with push access to this repository.
Portal validation is separate from `claude plugin validate --strict`.

Validate the current commit, inspect the README/listing, and review the actual
data-handling answers. The app **reads and locally stores some session metadata**;
do not answer that it processes no personal data merely because it has no server.
Use [PRIVACY.md](PRIVACY.md) for the precise fields, retention, and deletion.
The publisher must supply a reachable submission contact email, confirm the
intended audience when asked, and complete compliance acknowledgements.
Those decisions are not encoded as guessed defaults in the package.

The Python hook in a repository subfolder may be **held for a human reviewer**
under the directory's current scanner rules. That is not a local schema error;
do not remove the hook or change the advertised behavior to evade review.
Check the portal's target surfaces: the desktop workflow supports local Claude
Code on the same Mac, regardless of where the skill itself can be loaded.

Use **Scheduled check only** and leave automatic publication off for a manual
reviewed rollout; no repository webhook is needed for that route. After review,
follow the portal's Publish action and verify the public listing. This directory
route is distinct from the curated `claude-plugins-official` marketplace.

References: [submission](https://claude.com/docs/plugins/submit),
[pre-submission checks](https://claude.com/docs/plugins/pre-submission-checklist),
[platform support](https://claude.com/docs/plugins/platform-support).

## Reproduce a release

Update the app and both plugin versions together. Then run on Apple Silicon macOS:

```sh
npm ci
npm run sync:plugins
npm run check:plugins
claude plugin validate --strict plugins/claude-session-pets
npm test
npm run release:mac
```

`sync:plugins` copies the canonical Codex skill, Python helper, icon, and MIT
license into the self-contained plugin folders. CI checks for drift. The release
script excludes private working files and generates checksums for the archives.
Inspect each archive and validate public links before publishing it. Preserve
old versioned releases; a new release is required for changed plugin metadata.
