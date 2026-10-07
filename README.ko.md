# Session-Pets

[English](README.md) · [사용 가이드](docs/usage.ko.md)

<img src="assets/session-pets-icon.png" alt="Session-Pets 고릴라와 호랑이" width="128">

**Codex·Claude Code 세션마다 곁에 두는 투명한 데스크톱 펫.**

세션에 고릴라, 호랑이, 또는 직접 만든 캐릭터를 붙여 보세요. 바탕화면에 머물다가 답변이 필요하면 알려주고, 클릭하면 연결된 원래 세션으로 돌아갑니다. Codex 턴의 완료가 확인되면 초록 배지가 나타납니다.

**[macOS · Apple Silicon 다운로드](https://github.com/yback1223/session-pets/releases/latest)**

Apple Silicon Mac과 macOS 13 이상이 필요합니다. [yback](https://github.com/yback1223)이 만든 무료 독립 프로젝트입니다.

| 평소에는 작은 펫 | 답변이 필요할 때 | Codex 턴이 끝났을 때 |
|:---:|:---:|:---:|
| <img src="docs/images/pet.png" alt="바탕화면에 떠 있는 세션 펫" width="240"> | <img src="docs/images/question.png" alt="답변 필요 배지가 나타난 펫" width="240"> | <img src="docs/images/completed.png" alt="초록 작업 완료 배지가 나타난 펫" width="240"> |

## 설치

1. [Releases](https://github.com/yback1223/session-pets/releases/latest)에서 **`Session-Pets-v0.2.1-macos-arm64.zip`**을 내려받아 압축을 풉니다.
2. **`Install Session Pets.command`**를 더블클릭합니다. 앱은 `~/Applications`에, 소환 스킬은 Codex와 Claude Code의 사용자 스킬 폴더에 설치됩니다. **Python 3가 필요하며**, ZIP 사용에는 Node.js가 필요하지 않습니다.
3. **`Session Pets.app`**을 연 다음, 연결할 세션에서 펫을 소환합니다.

| 호스트 | 소환 | 다른 펫 고르기 | 이 펫 숨기기 |
|---|---|---|---|
| Codex | `$Session-Pets` | `$Session-Pets choose` | `$Session-Pets hide` |
| Claude Code | `/Session-Pets` | `/Session-Pets choose` | `/Session-Pets hide` |

첫 호출에서는 화살표로 캐릭터를 넘기고, 클릭하거나 **Enter**로 고릅니다. 선택은 그 세션에 기억됩니다. 명령이 보이지 않으면 호스트의 스킬 목록을 새로 불러오거나 호스트를 다시 여세요.

**macOS 첫 실행:** 이 앱은 Developer ID 서명과 Apple 공증을 받지 않았습니다. 신뢰하는 항목을 macOS가 차단하면 한 번 열기를 시도한 뒤 **시스템 설정 → 개인정보 보호 및 보안 → 확인 없이 열기**에서 확인합니다. [Apple 공식 안내](https://support.apple.com/ko-kr/102445)를 따르세요. 설치기는 macOS 보안 검사를 해제하지 않습니다.

### Claude Code 상태 연동

로컬 스킬은 펫을 소환합니다. Claude의 질문·승인·하위 에이전트 상태를 받으려면 해당 Claude Code 세션에서 플러그인도 활성화해야 합니다.

```text
/plugin marketplace add yback1223/session-pets
/plugin install session-pets@session-pets
```

플러그인에서는 `/session-pets:Session-Pets`도 사용할 수 있습니다. 로컬 설치와 세션 이동의 제한은 [Claude 설정 안내](docs/usage.ko.md#claude-code-플러그인)를 참고하세요.

### 배포 상태

앱과 플러그인 파일은 [GitHub Releases](https://github.com/yback1223/session-pets/releases/latest)에서 받을 수 있습니다. 위 명령은 yback의 공개 Claude 마켓플레이스에서 설치합니다. OpenAI·Anthropic 공식 디렉터리는 **아직 제출·승인되지 않았습니다**. 릴리스에는 제출용 OpenAI 형식 플러그인 ZIP도 포함되어 있습니다. [배포·제출 안내](docs/DISTRIBUTION.md)를 참고하세요.

## 펫 사용하기

- **고릴대장과 호들갑** — 고릴라와 호랑이 두 종류, 각각 16개 포즈가 있습니다. 투명 PNG나 애니메이션 스프라이트를 가져와 나만의 펫을 쓸 수도 있습니다.
- **클릭하면 세션으로, 드래그하면 원하는 자리로.** 더블클릭하면 춤추고, 휠을 돌리면 표정이 바뀝니다.
- **조작은 호버나 키보드 초점이 있을 때 표시합니다.** 이름·설명·변경·숨기기 버튼은 평소에 숨기며, 작업 중 배지를 계속 띄우지 않습니다.
- **답변·승인 요청은 호버 없이 표시합니다.** Codex의 완료가 확인되면 초록 배지가 나타나고, 확인하거나 다음 턴을 시작하면 사라집니다.
- **연결한 앱의 표시 언어를 따릅니다.** 한국어·영어가 내장되어 있고, 다른 언어는 처음 호출할 때 기존 Codex·Claude 세션이 번역해 로컬에 저장합니다. 명령 이름은 모든 언어에서 `Session-Pets`입니다.

## 호스트별 지원 범위

| 기능 | Codex | Claude Code |
|---|---|---|
| 세션별 펫·사용자 이미지·원래 세션 열기 | 지원 | 지원. CLI에서 Desktop으로 이동할 때 호스트 제한 있음 |
| 답변 필요 배지 | 비동기 질문을 포함한 구조화된 질문. 동작 검증됨 | 플러그인 훅 연결. 로컬 입력 자료로 검증 |
| 승인 필요 배지 | 별도의 자동 승인 감지 미지원 | 계획·권한 요청을 플러그인 훅으로 연결 |
| 확정 완료 배지 | 명시적인 턴 종료 기록 사용. 동작 검증됨 | `Stop`·`SubagentStop`만으로 완료를 확정하지 않음 |
| 작은 하위 에이전트 펫 자동 생성 | 미지원 | 명시적인 시작 훅 사용. 부모 펫 연결 필요 |

**작업 완료는 관찰한 Codex 턴이 끝났다는 뜻**이며, 프로젝트의 모든 요구가 충족됐다는 판정은 아닙니다. Claude의 실제 모델 질문 전체 흐름과 최종 완료는 검증되지 않았으며, 응답 후에도 완료 미확인 상태일 수 있습니다. Codex 세션 간 자동 연결도 지원하지 않습니다. [상태 표시의 정확한 의미](docs/usage.ko.md#상태와-지원-범위)를 확인하세요.

## 로컬 데이터와 권한

앱은 로컬 파일과 Unix 소켓을 사용하며, 텔레메트리·분석 클라이언트나 별도 API 키가 없습니다. 연결된 Codex 실행 기록과 일부 호스트 설정을 읽습니다. Claude 훅은 최근 AI 응답을 앱 메모리로 전달할 수 있습니다. 설정·가져온 펫·번역은 로컬에 저장됩니다. [정확한 데이터 범위](docs/usage.ko.md#로컬-데이터와-권한)를 확인하세요.

기존 호스트의 계정·모델 사용량·실행 권한은 그대로 적용됩니다. Session-Pets가 승인을 대신하거나 호스트의 승인 정책을 변경하지 않습니다.

## 소스에서 실행

macOS, **Node.js 22.12 이상**, npm, **Python 3**가 필요합니다. 프로젝트 폴더에서 실행합니다.

```sh
npm ci
npm start
```

앱을 빌드하고 세션 스킬을 설치하려면:

```sh
npm run pack
npm run install:integrations
```

[커스텀 펫 규격·문제 해결·개발 검사 →](docs/usage.ko.md)

## 라이선스

[MIT](LICENSE) · Copyright 2026 yback. 기본 캐릭터 이미지는 이 프로젝트를 위해 생성했습니다. Session-Pets는 OpenAI·Anthropic과 제휴하거나 해당 회사의 보증을 받는 프로젝트가 아닙니다.

[지원](docs/SUPPORT.md) · [개인정보](docs/PRIVACY.md) · [이용 조건](docs/TERMS.md)
