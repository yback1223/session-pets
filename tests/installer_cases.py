"""Exercise the real installer/helper using temporary homes and fixture app bundles."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts/install-integrations.py"
HELPER = ROOT / "scripts/pet.py"


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


installer = load_module(INSTALLER, "session_pets_installer")


def bundle(path, version="one", identifier="local.sessionpets"):
    contents = path / "Contents"
    contents.mkdir(parents=True, exist_ok=True)
    (contents / "Info.plist").write_bytes(plistlib.dumps({
        "CFBundleIdentifier": identifier,
        "CFBundleExecutable": "Session Pets",
        "CFBundleVersion": version,
    }))
    (contents / "version.txt").write_text(version, encoding="utf-8")
    return path


def snapshot(root):
    result = {}

    def visit(directory):
        for child in sorted(directory.iterdir()):
            if child.name == installer.LOCK_NAME:
                continue
            key = child.relative_to(root).as_posix()
            info = child.lstat()
            mode = stat.S_IMODE(info.st_mode)
            if child.is_symlink():
                result[key] = ("link", os.readlink(child), mode)
            elif child.is_dir():
                result[key] = ("dir", mode)
                visit(child)
            else:
                result[key] = ("file", child.read_bytes(), mode)
    visit(root)
    return result


class InstallerCases(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="session-pets-installer-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.home = self.base / "home"
        self.home.mkdir()
        self.app = bundle(self.base / "download/Session Pets.app")
        framework = self.app / "Contents/Frameworks/Test.framework"
        (framework / "Versions/A").mkdir(parents=True)
        (framework / "Versions/A/Test").write_text("framework data", encoding="utf-8")
        (framework / "Versions/Current").symlink_to("A")
        (framework / "Test").symlink_to("Versions/Current/Test")
        self.destination = self.home / "Applications/Session Pets.app"
        self.skills = [self.home / host / "skills/Session-Pets" for host in (".agents", ".claude")]
        # Any accidental default home use also remains confined to this test.
        self.environment = mock.patch.dict(os.environ, {"HOME": str(self.home), "PYTHONDONTWRITEBYTECODE": "1"})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def cli(self, *extra, install_app=True, app=None):
        args = [sys.executable, "-B", str(INSTALLER), "--app", str(self.app if app is None else app), "--home", str(self.home)]
        if install_app:
            args.append("--install-app")
        return subprocess.run(args + list(extra), capture_output=True, text=True, timeout=15)

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def assert_no_temporary_trees(self):
        self.assertFalse([path for path in self.home.rglob("*") if path.name.startswith((".session-pets-stage-", ".session-pets-backup-"))])

    def assert_runtime(self, expected):
        for index, skill in enumerate(self.skills):
            source = ROOT / ("integrations/codex/Session-Pets" if index == 0 else "plugins/claude-session-pets/skills/Session-Pets")
            self.assertEqual((skill / "SKILL.md").read_bytes(), (source / "SKILL.md").read_bytes())
            self.assertEqual((skill / "scripts/pet.py").read_bytes(), HELPER.read_bytes())
            runtime = skill / "scripts/runtime.json"
            self.assertEqual(json.loads(runtime.read_text()), {"owner": "session-pets", "app_path": str(expected)})
            self.assertEqual(stat.S_IMODE(runtime.stat().st_mode), 0o600)
            helper = load_module(skill / "scripts/pet.py", "installed_helper")
            self.assertEqual(helper.application_path(None), expected)

    def legacy(self, index, owned=True):
        path = self.skills[index].with_name("pet")
        path.mkdir(parents=True, exist_ok=True)
        (path / "original.txt").write_text(f"legacy {index}", encoding="utf-8")
        if owned:
            (path / ".session-pets.json").write_text(json.dumps({"owner": "session-pets"}), encoding="utf-8")
        return path

    def test_explicit_app_installs_stable_paths_and_preserves_framework_symlinks(self):
        settings = self.home / ".claude/settings.json"
        settings.parent.mkdir()
        settings.write_text('{"unrelated": true}', encoding="utf-8")
        auth = self.home / ".codex/auth.json"
        auth.parent.mkdir()
        auth.write_text("fixture-auth-unchanged", encoding="utf-8")
        self.assert_success(self.cli())
        self.assertTrue(self.destination.is_dir())
        self.assert_runtime(self.destination)
        self.assertEqual((self.destination / "Contents/Frameworks/Test.framework/Versions/Current").readlink(), Path("A"))
        self.assertEqual((self.destination / "Contents/Frameworks/Test.framework/Test").read_text(), "framework data")
        self.assertEqual(settings.read_text(), '{"unrelated": true}')
        self.assertEqual(auth.read_text(), "fixture-auth-unchanged")
        shutil.rmtree(self.app.parent)
        self.assert_runtime(self.destination)
        self.assert_no_temporary_trees()

    def test_repeat_install_updates_all_owned_destinations(self):
        self.assert_success(self.cli())
        lock_inode = (self.home / installer.LOCK_NAME).stat().st_ino
        bundle(self.app, "two")
        for skill in self.skills:
            (skill / "old-only.txt").write_text("remove during update", encoding="utf-8")
        self.assert_success(self.cli())
        self.assertEqual((self.destination / "Contents/version.txt").read_text(), "two")
        for skill in self.skills:
            self.assertFalse((skill / "old-only.txt").exists())
        self.assert_runtime(self.destination)
        self.assertEqual((self.home / installer.LOCK_NAME).stat().st_ino, lock_inode)
        self.assert_no_temporary_trees()

    def test_registration_without_copy_uses_explicit_source_app(self):
        self.assert_success(self.cli(install_app=False))
        self.assertFalse(self.destination.exists())
        self.assert_runtime(self.app)

    def test_default_development_bundle_is_registered_by_unmodified_source(self):
        # Relocation supplies an isolated development bundle, not a mocked installer.
        source = self.base / "source"
        for relative in ("scripts", "integrations/codex/Session-Pets", "plugins/claude-session-pets/skills/Session-Pets"):
            if relative == "scripts":
                (source / relative).mkdir(parents=True)
                shutil.copy2(INSTALLER, source / relative / INSTALLER.name)
                shutil.copy2(HELPER, source / relative / HELPER.name)
            else:
                shutil.copytree(ROOT / relative, source / relative)
        default = source / "dist/열두 일꾼-darwin-arm64/열두 일꾼.app"
        bundle(default)
        result = subprocess.run([sys.executable, "-B", str(source / "scripts/install-integrations.py"), "--home", str(self.home)], capture_output=True, text=True, timeout=15)
        self.assert_success(result)
        self.assertFalse(self.destination.exists())
        self.assert_runtime(default)

    def test_foreign_last_skill_leaves_every_destination_unchanged(self):
        self.assert_success(self.cli())
        marker = self.skills[1] / ".session-pets.json"
        marker.write_text('{"owner":"another-tool"}', encoding="utf-8")
        bundle(self.app, "two")
        before = snapshot(self.home)
        result = self.cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unrelated", result.stderr)
        self.assertEqual(snapshot(self.home), before)

    def test_foreign_or_malformed_app_leaves_skills_and_app_unchanged(self):
        for contents in (plistlib.dumps({"CFBundleIdentifier": "another.app"}), b"not a plist", b'<?xml version="1.0"?><plist><dict>'):
            with self.subTest(contents=contents):
                bundle(self.destination)
                (self.destination / "Contents/Info.plist").write_bytes(contents)
                before = snapshot(self.home)
                result = self.cli()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("bundle ID", result.stderr)
                self.assertEqual(snapshot(self.home), before)

    def test_owned_legacy_is_migrated_and_unrelated_legacy_is_preserved(self):
        old_codex = self.legacy(0)
        old_claude = self.legacy(1, owned=False)
        old_contents = snapshot(old_claude)
        self.assert_success(self.cli())
        self.assertFalse(old_codex.exists())
        self.assertEqual(snapshot(old_claude), old_contents)
        self.assert_runtime(self.destination)
        self.assert_no_temporary_trees()

    def test_unrelated_legacy_symlink_is_not_followed_or_removed(self):
        unrelated = self.base / "other-skill"
        unrelated.mkdir()
        (unrelated / ".session-pets.json").write_text('{"owner":"session-pets"}', encoding="utf-8")
        legacy = self.skills[0].with_name("pet")
        legacy.parent.mkdir(parents=True)
        legacy.symlink_to(unrelated, target_is_directory=True)
        before = snapshot(unrelated)
        self.assert_success(self.cli())
        self.assertTrue(legacy.is_symlink())
        self.assertEqual(snapshot(unrelated), before)

    def test_symlink_destinations_and_ancestors_are_refused(self):
        for relative in (".agents", ".agents/skills", ".agents/skills/Session-Pets", "Applications", "Applications/Session Pets.app"):
            with self.subTest(relative=relative):
                alternate_home = self.base / ("case-" + relative.replace("/", "_"))
                alternate_home.mkdir()
                outside = self.base / ("outside-" + relative.replace("/", "_"))
                outside.mkdir()
                link = alternate_home / relative
                link.parent.mkdir(parents=True, exist_ok=True)
                link.symlink_to(outside, target_is_directory=True)
                before_home, before_outside = snapshot(alternate_home), snapshot(outside)
                result = self.cli("--home", str(alternate_home))
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("symlink", result.stderr)
                self.assertEqual(snapshot(alternate_home), before_home)
                self.assertEqual(snapshot(outside), before_outside)

    def test_symlink_home_and_ownership_marker_are_refused(self):
        link = self.base / "linked-home"
        link.symlink_to(self.home, target_is_directory=True)
        result = self.cli("--home", str(link))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.home / installer.LOCK_NAME).exists())
        skill = self.skills[0]
        skill.mkdir(parents=True)
        marker = self.base / "outside-marker.json"
        marker.write_text('{"owner":"session-pets"}', encoding="utf-8")
        (skill / ".session-pets.json").symlink_to(marker)
        before = snapshot(self.home)
        result = self.cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(snapshot(self.home), before)
        self.assertEqual(marker.read_text(), '{"owner":"session-pets"}')

    def test_source_destination_identity_is_refused_without_changes(self):
        self.assert_success(self.cli())
        before = snapshot(self.home)
        result = self.cli(app=self.destination)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("overlap", result.stderr)
        self.assertEqual(snapshot(self.home), before)

    def test_running_destination_is_refused_using_a_real_process(self):
        self.assert_success(self.cli())
        executable = self.destination / "Contents/MacOS/Session Pets"
        executable.parent.mkdir()
        shutil.copyfile("/bin/sleep", executable)
        executable.chmod(0o755)
        process = subprocess.Popen([str(executable), "30"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.assertIsNone(process.poll())
            before = snapshot(self.home)
            result = self.cli()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Close Session Pets", result.stderr)
            self.assertEqual(snapshot(self.home), before)
        finally:
            process.terminate()
            process.wait(timeout=5)

    def test_partial_replacement_and_legacy_rename_failure_roll_back_everything(self):
        self.assert_success(self.cli())
        old_codex, old_claude = self.legacy(0), self.legacy(1)
        bundle(self.app, "two")
        before = snapshot(self.home)
        inode = (self.home / installer.LOCK_NAME).stat().st_ino
        original_rename = Path.rename
        for failure in ("second-skill", "last-legacy"):
            with self.subTest(failure=failure):
                triggered = []

                def fail_once(path, target):
                    if not triggered and ((failure == "second-skill" and path.name.startswith(".session-pets-stage-") and target == self.skills[1]) or (failure == "last-legacy" and path == old_claude)):
                        triggered.append(True)
                        raise OSError("injected rename failure")
                    return original_rename(path, target)

                with mock.patch.object(Path, "rename", new=fail_once):
                    with self.assertRaisesRegex(installer.InstallError, "injected rename failure"):
                        installer.install(self.app, self.home, True)
                self.assertEqual(triggered, [True])
                self.assertEqual(snapshot(self.home), before)
                self.assertTrue(old_codex.is_dir())
                self.assertTrue(old_claude.is_dir())
                self.assert_no_temporary_trees()
                with installer.installation_lock(self.home):
                    self.assertEqual((self.home / installer.LOCK_NAME).stat().st_ino, inode)
        self.assert_success(self.cli())
        self.assertFalse(old_codex.exists())
        self.assertFalse(old_claude.exists())
        self.assertEqual((self.destination / "Contents/version.txt").read_text(), "two")

    def test_staging_failure_has_no_committed_changes_and_unlocks(self):
        before = snapshot(self.home)
        original_copytree = shutil.copytree

        def fail_last(source, destination, *args, **kwargs):
            if Path(source) == ROOT / "plugins/claude-session-pets/skills/Session-Pets":
                raise OSError("injected copy failure")
            return original_copytree(source, destination, *args, **kwargs)

        with mock.patch.object(shutil, "copytree", new=fail_last):
            with self.assertRaisesRegex(installer.InstallError, "injected copy failure"):
                installer.install(self.app, self.home, True)
        self.assertEqual(snapshot(self.home), before)
        self.assert_success(self.cli())
        self.assert_no_temporary_trees()

    def test_concurrent_invocation_is_rejected_without_mutation_and_lock_is_reused(self):
        with installer.installation_lock(self.home):
            inode = (self.home / installer.LOCK_NAME).stat().st_ino
            before = snapshot(self.home)
            result = self.cli()
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Another Session Pets installation", result.stderr)
            self.assertEqual(snapshot(self.home), before)
        self.assertEqual((self.home / installer.LOCK_NAME).stat().st_ino, inode)
        self.assert_success(self.cli())
        self.assertEqual((self.home / installer.LOCK_NAME).stat().st_ino, inode)
        self.assertEqual(stat.S_IMODE((self.home / installer.LOCK_NAME).stat().st_mode), 0o600)

    def test_symlink_hardlink_and_nonprivate_lock_files_are_refused(self):
        outside = self.base / "outside-lock"
        outside.write_text("do not touch", encoding="utf-8")
        outside.chmod(0o600)
        lock = self.home / installer.LOCK_NAME
        for kind in ("symlink", "hardlink", "nonprivate"):
            with self.subTest(kind=kind):
                if kind == "symlink":
                    lock.symlink_to(outside)
                elif kind == "hardlink":
                    os.link(outside, lock)
                else:
                    lock.write_text("existing lock", encoding="utf-8")
                    lock.chmod(0o644)
                before = snapshot(self.home)
                result = self.cli()
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(snapshot(self.home), before)
                self.assertEqual(outside.read_text(), "do not touch")
                lock.unlink()


class HelperCases(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="session-pets-helper-")
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name).resolve()
        self.home = self.base / "home"
        self.home.mkdir()
        self.environment = mock.patch.dict(os.environ, {"HOME": str(self.home)})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.system = self.base / "Applications"
        self.system.mkdir()

    def helper(self, directory=None):
        directory = directory or self.base / "standalone/scripts"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / "pet.py"
        shutil.copy2(HELPER, path)
        helper = load_module(path, "standalone_helper")
        # Redirect only the system Applications mount; execute the real lookup code.
        helper.SYSTEM_APPLICATIONS = self.system
        return helper, path

    def test_home_and_system_fallback_require_the_expected_bundle_id(self):
        helper, _ = self.helper()
        home_app = bundle(self.home / "Applications/Session Pets.app")
        system_app = bundle(self.system / "Session Pets.app")
        self.assertEqual(helper.application_path(None), home_app)
        bundle(home_app, identifier="unrelated.app")
        self.assertEqual(helper.application_path(None), system_app)
        (system_app / "Contents/Info.plist").write_bytes(b"invalid plist")
        with self.assertRaises(ValueError):
            helper.application_path(None)
        (system_app / "Contents/Info.plist").write_bytes(b'<?xml version="1.0"?><plist><dict>')
        with self.assertRaises(ValueError):
            helper.application_path(None)

    def test_explicit_runtime_and_development_paths_keep_their_priority(self):
        project = self.base / "project"
        helper, path = self.helper(project / "scripts")
        home_app = bundle(self.home / "Applications/Session Pets.app")
        development = bundle(project / "dist/열두 일꾼-darwin-arm64/열두 일꾼.app")
        self.assertEqual(helper.application_path(None), development)
        runtime_app = bundle(self.base / "runtime/Session Pets.app")
        path.with_name("runtime.json").write_text(json.dumps({"owner": "session-pets", "app_path": str(runtime_app)}), encoding="utf-8")
        self.assertEqual(helper.application_path(None), runtime_app)
        self.assertEqual(helper.application_path(str(home_app)), home_app)
        bundle_helper, _ = self.helper(runtime_app / "Contents/Resources/app/scripts")
        self.assertEqual(bundle_helper.application_path(None), runtime_app)


if __name__ == "__main__":
    unittest.main(verbosity=2)
