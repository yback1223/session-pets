#!/usr/bin/env python3
"""Install Session-Pets skills and optionally a stable, per-user macOS app."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid
from xml.parsers.expat import ExpatError

ROOT = Path(__file__).resolve().parent.parent
OWNER = "session-pets"
BUNDLE_ID = "local.sessionpets"
SKILL_NAME = "Session-Pets"
LOCK_NAME = ".session-pets-install.lock"
DEFAULT_APP = ROOT / "dist/열두 일꾼-darwin-arm64/열두 일꾼.app"


class InstallError(Exception):
    pass


def absolute_path(value):
    # Keep symlinks visible for destination validation, including the home itself.
    return Path(os.path.abspath(os.path.expanduser(str(value))))


def exists(path):
    return os.path.lexists(path)


def check_components(home, target):
    """Reject symlinks and non-directory ancestors within the chosen home."""
    current = home
    parts = target.relative_to(home).parts
    for index in range(len(parts) + 1):
        if exists(current):
            info = current.lstat()
            if stat.S_ISLNK(info.st_mode):
                raise InstallError(f"Refusing a symlink destination: {current}")
            if index < len(parts) and not stat.S_ISDIR(info.st_mode):
                raise InstallError(f"Destination parent is not a directory: {current}")
        if index < len(parts):
            current = current / parts[index]


@contextmanager
def installation_lock(home):
    check_components(home, home)
    if not home.is_dir() or home.stat().st_uid != os.getuid():
        raise InstallError(f"The target home must be an existing directory owned by you: {home}")
    lock = home / LOCK_NAME
    descriptor = None
    locked = False
    try:
        flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC
        descriptor = os.open(lock, flags, 0o600)
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or stat.S_IMODE(info.st_mode) != 0o600 or info.st_nlink != 1):
            raise InstallError(f"The installer lock must be a private, owned regular file: {lock}")
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise InstallError(f"Another Session Pets installation is already using this home: {home}") from error
        locked = True
        named_info = lock.lstat()
        if (named_info.st_dev, named_info.st_ino) != (info.st_dev, info.st_ino):
            raise InstallError(f"The installer lock changed while acquiring it: {lock}")
        yield
    finally:
        if descriptor is not None:
            try:
                if locked:
                    fcntl.flock(descriptor, fcntl.LOCK_UN)
            finally:
                os.close(descriptor)
        # Never unlink: a waiter may still hold an open descriptor for this inode.


def owned_skill(path):
    marker = path / ".session-pets.json"
    if path.is_symlink() or not path.is_dir() or marker.is_symlink() or not marker.is_file():
        return False
    try:
        data = json.loads(marker.read_text(encoding="utf-8"))
        return isinstance(data, dict) and data.get("owner") == OWNER
    except (OSError, ValueError):
        return False


def bundle_identifier(app):
    contents = app / "Contents"
    info = contents / "Info.plist"
    if (app.is_symlink() or not app.is_dir() or contents.is_symlink()
            or info.is_symlink() or not info.is_file()):
        return None
    try:
        with info.open("rb") as stream:
            data = plistlib.load(stream)
        return data.get("CFBundleIdentifier") if isinstance(data, dict) else None
    except (OSError, ValueError, plistlib.InvalidFileException, ExpatError):
        return None


def app_is_running(app):
    try:
        processes = subprocess.run(["/bin/ps", "-axo", "comm=,args="], check=True,
                                   capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError) as error:
        raise InstallError("Could not check running apps; close Session Pets and retry.") from error
    prefixes = {str(app) + "/Contents/", str(app.resolve()) + "/Contents/"}
    return any(prefix in line for line in processes.stdout.splitlines() for prefix in prefixes)


class Change:
    def __init__(self, target, source=None, kind="skill"):
        self.target = target
        self.source = source
        self.kind = kind
        self.stage = None
        self.backup = None
        self.installed = False


def validate_destinations(home, changes):
    for change in changes:
        target = change.target
        check_components(home, target)
        if change.kind == "legacy":
            if not owned_skill(target):
                raise InstallError(f"Legacy skill ownership changed; retry installation: {target}")
        elif exists(target):
            if change.kind == "app":
                if bundle_identifier(target) != BUNDLE_ID:
                    raise InstallError(f"Refusing to replace an app with a different or invalid bundle ID: {target}")
                if app_is_running(target):
                    raise InstallError(f"Close Session Pets before updating this app: {target}")
            elif not owned_skill(target):
                raise InstallError(f"Refusing to replace an unrelated {SKILL_NAME} skill: {target}")


def ensure_parent(home, parent, created):
    current = home
    for part in parent.relative_to(home).parts:
        current = current / part
        if not exists(current):
            current.mkdir(mode=0o700)
            created.append(current)
        check_components(home, current / ".parent-check")


def private_json(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def stage_change(change, app_path):
    change.stage = Path(tempfile.mkdtemp(prefix=".session-pets-stage-", dir=change.target.parent))
    shutil.copytree(change.source, change.stage, dirs_exist_ok=True, symlinks=True)
    if change.kind == "skill":
        scripts = change.stage / "scripts"
        if scripts.is_symlink():
            raise InstallError(f"Skill scripts must not be a symlink: {change.source}")
        scripts.mkdir(exist_ok=True)
        helper = scripts / "pet.py"
        if helper.is_symlink():
            raise InstallError(f"Skill helper must not be a symlink: {change.source}")
        shutil.copy2(ROOT / "scripts/pet.py", helper)
        private_json(scripts / "runtime.json", {"owner": OWNER, "app_path": str(app_path)})
        private_json(change.stage / ".session-pets.json", {"owner": OWNER, "version": 1})


def remove_tree(path):
    if path.is_symlink() or not path.is_dir():
        path.unlink()
    else:
        shutil.rmtree(path)


def rollback(changes):
    failures = []
    for change in reversed(changes):
        try:
            if change.installed:
                remove_tree(change.target)
            if change.backup is not None:
                change.backup.rename(change.target)
                change.backup = None
        except OSError as error:
            failures.append(f"Restore {change.target} from {change.backup}: {error}")
    return failures


def cleanup(changes, field):
    failures = []
    for change in changes:
        path = getattr(change, field)
        if path is not None and exists(path):
            try:
                remove_tree(path)
                setattr(change, field, None)
            except OSError as error:
                failures.append(f"Could not remove {path}: {error}")
    return failures


def install(app=None, home=None, install_app=False):
    home = absolute_path(Path.home() if home is None else home)
    with installation_lock(home):
        source_app = absolute_path(DEFAULT_APP if app is None else app)
        if source_app.suffix != ".app" or bundle_identifier(source_app) != BUNDLE_ID:
            raise InstallError(f"A built Session Pets app ({BUNDLE_ID}) is required. Run npm run pack or use --app: {source_app}")
        source_app = source_app.resolve()
        app_path = home / "Applications/Session Pets.app" if install_app else source_app
        skills = [
            Change(home / ".agents/skills" / SKILL_NAME, ROOT / "integrations/codex" / SKILL_NAME),
            Change(home / ".claude/skills" / SKILL_NAME, ROOT / "plugins/claude-session-pets/skills" / SKILL_NAME),
        ]
        changes = ([Change(app_path, source_app, "app")] if install_app else []) + skills
        for change in changes:
            check_components(home, change.target)
            if not change.source.is_dir() or change.source.is_symlink():
                raise InstallError(f"Installation source is missing or is a symlink: {change.source}")
            source = change.source.resolve()
            target = change.target.resolve()
            if source == target or source in target.parents or target in source.parents:
                raise InstallError(f"Installation source and destination overlap: {change.source} / {change.target}")
        if not (ROOT / "scripts/pet.py").is_file():
            raise InstallError("The Session-Pets helper is missing from the installation source.")
        for skill in skills:
            legacy = skill.target.with_name("pet")
            check_components(home, legacy.parent)
            # An unrelated legacy skill, including a symlink, is never followed or removed.
            if owned_skill(legacy):
                changes.append(Change(legacy, kind="legacy"))
        validate_destinations(home, changes)
        created = []
        try:
            for change in changes:
                if change.kind != "legacy":
                    ensure_parent(home, change.target.parent, created)
                    stage_change(change, app_path)
            # Recheck ownership and running apps after potentially lengthy app copies.
            validate_destinations(home, changes)
            for change in changes:
                if exists(change.target):
                    backup = change.target.with_name(".session-pets-backup-" + uuid.uuid4().hex)
                    change.target.rename(backup)
                    change.backup = backup
                if change.stage is not None:
                    change.stage.rename(change.target)
                    change.stage = None
                    change.installed = True
        except BaseException as error:
            failures = rollback(changes) + cleanup(changes, "stage")
            for directory in reversed(created):
                try:
                    directory.rmdir()
                except OSError:
                    pass  # Preserve directories with recovery files or concurrent contents.
            if failures:
                raise InstallError(f"Installation failed: {error}. Recovery needs attention: " + "; ".join(failures)) from error
            if isinstance(error, (KeyboardInterrupt, SystemExit)):
                raise
            raise InstallError(f"Installation failed; previous files were restored: {error}") from error
        # The transaction is committed. A cleanup warning must not undo it after other
        # backups have already been deleted. Keep any remaining backup for recovery.
        warnings = cleanup(changes, "backup") + cleanup(changes, "stage")
        return {"app_path": app_path, "skills": [skill.target for skill in skills], "warnings": warnings}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, help="Path to a built Session Pets .app (default: the development bundle)")
    parser.add_argument("--install-app", action="store_true", help="Copy the app into ~/Applications/Session Pets.app")
    parser.add_argument("--home", type=Path, help="Target home directory (for isolated installation tests)")
    args = parser.parse_args(argv)
    try:
        result = install(args.app, args.home, args.install_app)
    except (InstallError, OSError) as error:
        print(f"Session Pets installation failed: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Session Pets installation interrupted; previous files were restored.", file=sys.stderr)
        return 130
    print(f"App: {result['app_path']}")
    for host, path in zip(("Codex", "Claude"), result["skills"]):
        print(f"{host} {SKILL_NAME}: {path}")
    for warning in result["warnings"]:
        print(f"Installed successfully; cleanup warning: {warning}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
