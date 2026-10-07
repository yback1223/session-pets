# Session-Pets for Claude Code

![Session-Pets gorilla and tiger](assets/icon.png)

**One desktop pet for each Claude Code session.**

Give every local Claude Code session its own gorilla, tiger, or custom character.
Keep pets from multiple sessions on your desktop at the same time. Click any pet
to return to the session it belongs to. Question and approval alerts stay visible
when that session needs your input. Connected subagents can appear as smaller
companions.

**Requires the [Session Pets desktop app](https://github.com/yback1223/session-pets/releases/latest),
macOS Apple Silicon, Python 3, and Claude Code.** Installing this plugin alone does
not install the desktop app. It does not add a hosted AI service or require an
additional API key.

This is for **local Claude Code sessions on the same Mac as the desktop app**.
A web/mobile chat cannot display a pet on your desktop. Cowork and cloud/remote
execution are not supported targets for this release. The desktop app is not
Developer ID signed or Apple notarized.

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

Run the command in each session you want to connect. Each session remembers its
own pet choice, and the pets can stay on screen together.

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

When Claude emits a supported event, it runs the bundled Python hook, which
sends selected event fields through a user-only local Unix socket. If the app
is absent, the hook exits quietly. An explicit Session-Pets invocation runs the
bundled Python helper, which can open the already installed desktop app and
asks it to show, choose, hide, or inspect a pet. Neither script downloads or
installs software. Other than local app communication, there is no network
service operated by the plugin. Your host's account, usage, and permissions
still apply; the plugin does not send prompts or grant approvals.

No session content is sent to the developer. The most recent assistant reply
may be passed locally and retained in app memory; see the full
[data-use guide](https://github.com/yback1223/session-pets/blob/main/docs/PRIVACY.md).

Free, independent software by **yback**, under the MIT license. Not affiliated
with Anthropic or OpenAI. [Help and issues](https://github.com/yback1223/session-pets/issues).

[Support](https://github.com/yback1223/session-pets/blob/main/docs/SUPPORT.md)
· [Terms](https://github.com/yback1223/session-pets/blob/main/docs/TERMS.md)

## 한국어

각 로컬 Claude Code 세션에 고릴라·호랑이 또는 직접 만든 펫을 하나씩 붙입니다.
세션마다 명령을 호출하면 여러 세션의 펫을 화면에 동시에 띄울 수 있습니다.
원하는 펫을 클릭하면 그 펫의 세션으로 돌아가며, 각 세션의 질문·승인 요청은
해당 펫에 알림으로 표시됩니다. Apple
Silicon Mac, macOS 13 이상, Python 3와 별도 Session Pets 앱 설치가 필요합니다.
명령은 모든 언어에서 `/Session-Pets`이며, 플러그인 전체 이름은
`/session-pets:Session-Pets`입니다. Claude의 응답 종료만으로 작업 완료를 확정하지
않습니다. [한국어 설치 안내](https://github.com/yback1223/session-pets/blob/main/docs/usage.ko.md)를 참고하세요.
