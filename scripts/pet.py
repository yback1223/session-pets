#!/usr/bin/env python3
"""Summon a local pet for the explicitly identified Codex or Claude session."""
import argparse
import errno
import json
import os
from pathlib import Path
import plistlib
import socket
import stat
import subprocess
import sys
import time
import uuid
from xml.parsers.expat import ExpatError

DEFAULT_SOCKET = Path.home() / "Library/Application Support/session-pets/control.sock"
SYSTEM_APPLICATIONS = Path("/Applications")


def session_id(provider, supplied):
    value = supplied
    if not value and provider == "codex":
        value = os.environ.get("CODEX_THREAD_ID") or os.environ.get("CODEX_SESSION_ID")
    if not value or value.startswith("${"):
        raise ValueError("현재 세션 ID가 없습니다. 해당 Codex/Claude 세션 안에서 Session-Pets를 호출하세요.")
    try:
        result = str(uuid.UUID(value))
    except (ValueError, AttributeError) as error:
        raise ValueError("현재 세션 ID를 확인할 수 없습니다. 다른 세션으로 추측해서 연결하지 않습니다.") from error
    if result != value.lower():
        raise ValueError("현재 세션 ID의 형식이 올바르지 않습니다.")
    return result


def exchange(target, request):
    info = target.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("사용자 전용 열두 일꾼 연결 소켓이 아닙니다.")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(2)
        client.connect(str(target))
        client.sendall((json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8"))
        reply = bytearray()
        while b"\n" not in reply:
            chunk = client.recv(4096)
            if not chunk:
                raise ValueError("앱의 소환 응답을 확인하지 못했습니다.")
            reply.extend(chunk)
            if len(reply) > 262144:
                raise ValueError("앱의 응답이 올바르지 않습니다.")
        result = json.loads(reply.split(b"\n", 1)[0])
        if not isinstance(result, dict) or not isinstance(result.get("ok"), bool):
            raise ValueError("앱의 소환 응답이 올바르지 않습니다.")
        return result


def is_installed_app(candidate):
    try:
        with (candidate / "Contents/Info.plist").open("rb") as stream:
            info = plistlib.load(stream)
        return isinstance(info, dict) and info.get("CFBundleIdentifier") == "local.sessionpets"
    except (OSError, ValueError, plistlib.InvalidFileException, ExpatError):
        return False


def application_path(supplied):
    if supplied:
        return Path(supplied).expanduser().resolve()
    source = Path(__file__).resolve()
    runtime = source.with_name("runtime.json")
    if runtime.is_file():
        data = json.loads(runtime.read_text())
        if data.get("owner") == "session-pets":
            return Path(data["app_path"]).expanduser().resolve()
    for parent in source.parents:
        if parent.suffix == ".app":
            return parent
        candidate = parent / "dist/열두 일꾼-darwin-arm64/열두 일꾼.app"
        if candidate.is_dir():
            return candidate
    for candidate in (Path.home() / "Applications/Session Pets.app", SYSTEM_APPLICATIONS / "Session Pets.app"):
        if is_installed_app(candidate):
            return candidate.resolve()
    raise ValueError("Session Pets 앱을 설치하거나 먼저 빌드한 뒤 Session-Pets 연동 설치를 다시 실행하세요.")


def invoke(args, request):
    target = Path(args.socket).expanduser()
    try:
        return exchange(target, request)
    except OSError as error:
        if error.errno not in (errno.ENOENT, errno.ECONNREFUSED):
            raise
    if args.no_launch or target != DEFAULT_SOCKET:
        raise ValueError("열두 일꾼 앱이 실행 중이지 않습니다.")
    app = application_path(args.app)
    if sys.platform != "darwin" or app.suffix != ".app" or not (app / "Contents/Info.plist").is_file():
        raise ValueError("이 소환기는 macOS용 열두 일꾼 앱이 필요합니다.")
    subprocess.run(["/usr/bin/open", "-g", str(app), "--args", "--background"], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=5)
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        try:
            return exchange(target, request)
        except OSError as error:
            if error.errno not in (errno.ENOENT, errno.ECONNREFUSED):
                raise
            time.sleep(0.1)
    raise ValueError("앱 연결을 기다리다 시간이 지났습니다. 열두 일꾼 앱을 다시 실행하세요.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", nargs="?", default="summon", help="summon / choose / hide / status / prepare-language 또는 펫 이름")
    parser.add_argument("--provider", required=True, choices=("codex", "claude"))
    parser.add_argument("--session", help="호출한 세션의 UUID. Claude에서는 반드시 전달")
    parser.add_argument("--pet", help="선택창을 건너뛸 정확한 펫 이름 또는 ID")
    parser.add_argument("--socket", default=os.environ.get("SESSION_PETS_CONTROL_SOCKET", str(DEFAULT_SOCKET)))
    parser.add_argument("--app", help="앱이 꺼져 있을 때 실행할 .app 경로")
    parser.add_argument("--no-launch", action="store_true")
    args = parser.parse_args()
    try:
        sid = session_id(args.provider, args.session)
        action = args.command if args.command in ("summon", "choose", "hide", "status", "prepare-language") else "summon"
        pet = args.pet or (args.command if action != args.command else None)
        request = {"version": 1, "action": action, "provider": args.provider, "sessionId": sid,
                   "title": (("Codex" if args.provider == "codex" else "Claude") + " · " + Path.cwd().name)[:180]}
        request["cwd"] = str(Path.cwd())
        if args.provider == "claude":
            request["surface"] = "desktop" if os.environ.get("CLAUDE_CODE_ENTRYPOINT") in ("claude-desktop", "claude-desktop-3p") else "cli"
        if pet:
            request["petId"] = pet
        result = invoke(args, request)
        labels = {"choosing": "현재 세션의 펫 선택기를 열었습니다. 화살표로 고르고 캐릭터를 클릭하세요.",
                  "visible": "현재 세션의 펫을 표시했습니다.", "hidden": "현재 세션의 펫이 숨겨져 있습니다."}
        if result.get("ok"):
            result.setdefault("message", labels.get(result.get("status"), "앱의 응답을 확인했습니다."))
        print(json.dumps(result, ensure_ascii=False))
        return 0 if result.get("ok") else 1
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
