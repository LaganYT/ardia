import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ardia_cli import cli, control, plugins_cli

FIXTURES = Path(__file__).resolve().parent / "fixtures"
EXAMPLE = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "plugins" / "example"
LEGACY = {
    "name": "compact-command-bar",
    "title": "Compact command bar",
    "description": "Fewer tabs before you type.",
    "requires": "0.2.46-nightly.4",
    "settings": {"commandBarStart": {"openTabs": {"limit": 5}}},
    "reset": {"commandBarStart": {}},
}


def exchange_supported(where: Path) -> bool:
    first, second = where / "swap-probe-a", where / "swap-probe-b"
    first.mkdir()
    second.mkdir()
    try:
        plugins_cli.rename_exchange(first, second)
        return True
    except (NotImplementedError, OSError):
        return False
    finally:
        first.rmdir()
        second.rmdir()


class PluginsCliTest(unittest.TestCase):
    def setUp(self):
        self.data = Path(tempfile.mkdtemp(prefix="ardia-plugins-"))
        schema_dir = self.data / "config-schema"
        schema_dir.mkdir()
        shutil.copy(plugins_cli.SHIPPED_SCHEMA, schema_dir / "plugin.schema.json")
        settings = {"type": "object", "properties": {"commandBarStart": {"type": "object"}}, "additionalProperties": False}
        (schema_dir / "config.schema.json").write_text(json.dumps({"type": "object", "properties": {"settings": settings}}))
        self.unreachable = mock.patch.object(control, "call", side_effect=control.unreachable("test"))
        self.unreachable.start()

    def tearDown(self):
        self.unreachable.stop()
        shutil.rmtree(self.data, ignore_errors=True)

    def ardia(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            status = cli.run(["plugins", *args, "--data-dir", str(self.data)])
        return status, out.getvalue(), err.getvalue()

    def test_install_copies_the_example_and_refuses_a_second_copy(self):
        status, out, _ = self.ardia("install", str(EXAMPLE))
        self.assertEqual(status, 0)
        self.assertIn("It's off", out)
        installed = self.data / "config" / "plugins" / "example"
        self.assertTrue((installed / "plugin.json").is_file())
        self.assertTrue((installed / "page" / "index.html").is_file())
        self.assertEqual(self.ardia("install", str(EXAMPLE))[0], 1)
        self.assertEqual(self.ardia("install", str(EXAMPLE), "--force")[0], 0)

    def test_a_settings_only_plugin_installs_from_its_plugin_json(self):
        source = self.data / "legacy.json"
        source.write_text(json.dumps(LEGACY))
        self.assertEqual(self.ardia("install", str(source))[0], 0)
        self.assertEqual(json.loads((self.data / "config" / "plugins" / "compact-command-bar" / "plugin.json").read_text()), LEGACY)

    def test_check_reports_schema_problems_with_their_path(self):
        bad = self.data / "bad"
        bad.mkdir()
        manifest = json.loads((EXAMPLE / "plugin.json").read_text())
        manifest["process"]["memoryMB"] = 1
        manifest["typo"] = True
        (bad / "plugin.json").write_text(json.dumps(manifest))
        status, out, _ = self.ardia("check", str(bad) + "/")
        self.assertEqual(status, 1)
        self.assertIn("process.memoryMB", out)
        self.assertIn("typo", out)
        status, _, err = self.ardia("install", str(bad))
        self.assertEqual(status, 1)
        self.assertIn("memoryMB", err)

    def test_check_refuses_every_manifest_the_app_refuses(self):
        cases = json.loads((EXAMPLE.parent / "rejected-manifests.json").read_text())
        for case in cases:
            folder = self.data / "cases" / str(cases.index(case))
            folder.mkdir(parents=True)
            (folder / "plugin.json").write_text(json.dumps(case["manifest"]))
            status, out, _ = self.ardia("check", str(folder) + "/")
            self.assertEqual(status, 1, f"{case['why']}: {out}")
        self.assertEqual(self.ardia("check", str(EXAMPLE) + "/")[0], 0)

    def test_install_checks_the_copy_it_publishes(self):
        source = self.data / "changing"
        shutil.copytree(EXAMPLE, source)
        real_copy = plugins_cli.copy_tree

        def swap_while_copying(src, dst):
            real_copy(src, dst)
            manifest = json.loads((dst / "plugin.json").read_text())
            manifest["permissions"] = ["fullUrls"]
            (dst / "plugin.json").write_text(json.dumps(manifest))

        with mock.patch.object(plugins_cli, "copy_tree", side_effect=swap_while_copying):
            status, _, err = self.ardia("install", str(source))
        self.assertEqual(status, 1)
        self.assertIn("fullUrls needs tabs", err)
        self.assertFalse((self.data / "config" / "plugins" / "example").exists())

    def test_install_never_replaces_a_plugin_that_appears_while_it_copies(self):
        target = self.data / "config" / "plugins" / "example"
        real_copy = plugins_cli.copy_tree

        def another_install_lands_first(src, dst):
            real_copy(src, dst)
            target.mkdir(parents=True)
            (target / "plugin.json").write_text('{"name": "example", "title": "Theirs"}')

        with mock.patch.object(plugins_cli, "copy_tree", side_effect=another_install_lands_first):
            status, _, err = self.ardia("install", str(EXAMPLE))
        self.assertEqual(status, 1)
        self.assertIn("already installed", err)
        self.assertEqual(json.loads((target / "plugin.json").read_text())["title"], "Theirs")

    def test_a_forced_replace_that_fails_keeps_the_old_install(self):
        self.assertEqual(self.ardia("install", str(EXAMPLE))[0], 0)
        target = self.data / "config" / "plugins" / "example"
        before = (target / "plugin.json").read_text()
        real = plugins_cli.rename_no_replace
        calls = []

        def fails_once(src, dst):
            calls.append(src)
            if len(calls) == 1:
                raise OSError("disk full")
            real(src, dst)

        with mock.patch.object(plugins_cli, "rename_exchange", side_effect=NotImplementedError), mock.patch.object(plugins_cli, "rename_no_replace", side_effect=fails_once):
            status, _, _ = self.ardia("install", str(EXAMPLE), "--force")
        self.assertEqual(status, 1)
        self.assertEqual((target / "plugin.json").read_text(), before, "the old install is still there")
        self.assertEqual(sorted(p.name for p in target.parent.iterdir()), ["example"], "and nothing is left beside it")

    def test_a_forced_install_that_fails_its_checks_leaves_the_installed_plugin_on(self):
        self.assertEqual(self.ardia("install", str(EXAMPLE))[0], 0)
        broken = self.data / "broken"
        shutil.copytree(EXAMPLE, broken)
        manifest = json.loads((broken / "plugin.json").read_text())
        manifest["permissions"] = ["fullUrls"]
        (broken / "plugin.json").write_text(json.dumps(manifest))
        real_copy = plugins_cli.copy_tree
        self.unreachable.stop()
        with mock.patch.object(control, "call", return_value={}) as call, mock.patch.object(plugins_cli, "manifest_problems", side_effect=[[], ["broken"]]), mock.patch.object(plugins_cli, "copy_tree", side_effect=real_copy):
            status, _, _ = self.ardia("install", str(broken), "--force")
        self.unreachable.start()
        self.assertEqual(status, 1)
        self.assertNotIn("plugins.disable", [c.args[1] for c in call.call_args_list], "nothing is turned off before the new copy passes")

    def test_check_reports_an_installed_folder_whose_name_differs_from_its_manifest(self):
        folder = self.data / "config" / "plugins" / "renamed"
        shutil.copytree(EXAMPLE, folder)
        status, out, _ = self.ardia("check", "renamed")
        self.assertEqual(status, 1)
        self.assertIn("but its folder is renamed", out)

    def test_check_uses_the_schema_it_ships_when_ardia_has_written_none(self):
        (self.data / "config-schema" / "plugin.schema.json").unlink()
        (self.data / "config-schema" / "config.schema.json").unlink()
        folder = self.data / "typo"
        shutil.copytree(EXAMPLE, folder)
        manifest = json.loads((folder / "plugin.json").read_text())
        manifest["typo"] = True
        (folder / "plugin.json").write_text(json.dumps(manifest))
        status, out, _ = self.ardia("check", str(folder) + "/")
        self.assertEqual(status, 1)
        self.assertIn("typo", out)
        status, out, _ = self.ardia("check", str(EXAMPLE) + "/")
        self.assertEqual(status, 1, "settings defaults can't be checked without Ardia's config schema")
        self.assertIn("config.schema.json", out)

    def test_a_null_manifest_version_and_wrongly_typed_names_are_problems_not_crashes(self):
        for manifest in ({"name": "x", "manifest": None}, {"manifest": 1, "name": "x", "tools": [{"name": ["a"], "title": "T"}], "process": {"run": ["/bin/sh"]}}, {"manifest": 1, "name": "x", "settings": {"rows": [{"key": "k", "title": "K", "type": "choice", "default": "a", "choices": [{"value": ["a"], "title": "A"}, {"value": "b", "title": "B"}]}]}}):
            folder = self.data / "typed" / str(len(list((self.data).glob("typed/*"))))
            folder.mkdir(parents=True)
            (folder / "plugin.json").write_text(json.dumps(manifest))
            status, out, err = self.ardia("check", str(folder) + "/")
            self.assertEqual(status, 1, out + err)
            self.assertNotIn("Traceback", err)

    def test_a_forced_replace_keeps_the_old_install_when_something_blocks_putting_it_back(self):
        self.assertEqual(self.ardia("install", str(EXAMPLE))[0], 0)
        target = self.data / "config" / "plugins" / "example"
        before = (target / "plugin.json").read_text()

        def another_folder_lands(staged, dst):
            dst.mkdir()
            (dst / "plugin.json").write_text('{"name": "example", "title": "Theirs"}')
            raise FileExistsError(dst)

        with mock.patch.object(plugins_cli, "rename_exchange", side_effect=NotImplementedError), mock.patch.object(plugins_cli, "rename_no_replace", side_effect=another_folder_lands):
            status, _, err = self.ardia("install", str(EXAMPLE), "--force")
        self.assertEqual(status, 1)
        kept = [p for p in target.parent.glob(".example.*/previous/plugin.json")]
        self.assertEqual([p.read_text() for p in kept], [before], f"the old install is kept beside it: {err}")

    def test_a_forced_replace_swaps_the_folders_in_one_step(self):
        if not exchange_supported(self.data):
            self.skipTest("this system can't swap two folders in one step; the fallback is tested separately")
        self.assertEqual(self.ardia("install", str(EXAMPLE))[0], 0)
        target = self.data / "config" / "plugins" / "example"
        (target / "old-marker").write_text("old")
        with mock.patch.object(plugins_cli, "rename_no_replace", side_effect=AssertionError("no gap: the target is never empty")):
            status, _, err = self.ardia("install", str(EXAMPLE), "--force")
        self.assertEqual(status, 0, err)
        self.assertFalse((target / "old-marker").exists())
        self.assertEqual(sorted(p.name for p in target.parent.iterdir()), ["example"])

    def test_a_path_with_a_lone_surrogate_is_a_problem_not_a_crash(self):
        for patch in ({"page": {"title": "P", "file": "page/a\ud800.html"}}, {"process": {"run": ["bin/\udc00helper"]}}):
            manifest = json.loads((EXAMPLE / "plugin.json").read_text())
            manifest.update(patch)
            folder = self.data / "surrogate" / str(len(list(self.data.glob("surrogate/*"))))
            folder.mkdir(parents=True)
            (folder / "plugin.json").write_text(json.dumps(manifest))
            status, out, err = self.ardia("check", str(folder) + "/")
            self.assertEqual(status, 1, out + err)
            self.assertNotIn("Traceback", err)

    def test_list_and_remove_work_from_the_files_when_ardia_is_away(self):
        self.ardia("install", str(EXAMPLE))
        status, out, _ = self.ardia("list", "--json")
        self.assertEqual(status, 0)
        listed = json.loads(out)
        self.assertEqual([p["name"] for p in listed], ["example"])
        self.assertEqual(listed[0]["problems"], [])
        self.assertEqual(self.ardia("remove", "example")[0], 0)
        self.assertFalse((self.data / "config" / "plugins" / "example").exists())
        self.assertEqual(self.ardia("remove", "example")[0], 1)

    def test_links_inside_a_plugin_are_refused(self):
        source = self.data / "linked"
        shutil.copytree(EXAMPLE, source)
        (source / "escape").symlink_to(Path.home())
        status, _, err = self.ardia("install", str(source))
        self.assertEqual(status, 1)
        self.assertIn("is a link", err)

    def test_enable_and_call_need_ardia(self):
        self.assertEqual(self.ardia("enable", "example")[0], 2)
        self.assertEqual(self.ardia("call", "example", "hello")[0], 2)

    def test_call_sends_the_tool_and_prints_its_result(self):
        self.unreachable.stop()
        with mock.patch.object(control, "call", return_value={"text": "Hello"}) as call:
            status, out, _ = self.ardia("call", "example", "hello", '{"who": "you"}')
        self.unreachable.start()
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(out), {"text": "Hello"})
        self.assertEqual(call.call_args.args[1:3], ("plugins.call", {"plugin": "example", "tool": "hello", "input": {"who": "you"}}))
        self.assertGreaterEqual(call.call_args.args[3], 300)

    def test_remove_leaves_the_files_when_ardia_got_the_request_but_never_answered(self):
        self.ardia("install", str(EXAMPLE))
        lost = control.unreachable("timed out")
        lost.sent = True
        self.unreachable.stop()
        with mock.patch.object(control, "call", side_effect=lost):
            status, _, err = self.ardia("remove", "example")
        self.unreachable.start()
        self.assertEqual(status, 2)
        self.assertIn("left as it is", err)
        self.assertTrue((self.data / "config" / "plugins" / "example" / "plugin.json").exists(), "the app may still be stopping its helper")

    def test_call_input_that_cant_be_sent_as_utf8_is_a_problem_not_a_crash(self):
        self.unreachable.stop()
        with mock.patch.object(control, "call", side_effect=UnicodeEncodeError("utf-8", "\ud800", 0, 1, "surrogates not allowed")):
            status, _, err = self.ardia("call", "example", "hello", '{"text": "\\ud800"}')
        self.unreachable.start()
        self.assertEqual(status, 1)
        self.assertIn("can't be sent as UTF-8", err)

    def test_a_page_command_path_that_almost_matches_is_refused_at_once(self):
        import time
        source = self.data / "slow"
        shutil.copytree(EXAMPLE, source)
        manifest = json.loads((source / "plugin.json").read_text())
        opener = next(c for c in manifest["commands"] if "open" in c)
        opener["path"] = "/" * 34 + "#"
        (source / "plugin.json").write_text(json.dumps(manifest))
        started = time.monotonic()
        status, _, _ = self.ardia("check", str(source))
        self.assertEqual(status, 1)
        self.assertLess(time.monotonic() - started, 2, "the path pattern has no nested repetition to backtrack through")


if __name__ == "__main__":
    unittest.main()
