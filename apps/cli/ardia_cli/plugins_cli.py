import ctypes
import errno
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

from ardia_cli import config_files, control
from ardia_cli.control import MethodError, Unreachable
from ardia_cli.endpoint import DATA_DIR_HELP
from ardia_cli.printable import complain, say, shown

MANIFEST = "plugin.json"
SCHEMA = "plugin.schema.json"
SHIPPED_SCHEMA = Path(__file__).resolve().parent / "schemas" / SCHEMA
NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
MAX_MANIFEST = 1 << 20
MAX_COPY = 200 << 20
CALL_TIMEOUT = 320.0

DESCRIPTION = """\
Install, list and manage Ardia plugins. A plugin is a folder with a plugin.json; it lives in the plugins folder
of the config folder ({folder}, or <data dir>/config/plugins with --data-dir or $ARDIA_DATA_DIR). Ardia sees
a plugin the moment its folder appears, and every plugin starts off: turning one on shows what it gets, in Ardia.
See docs/plugins.md.

Commands:
  list       the plugins, whether they're on and what they add
  install    copy a plugin folder (or a lone plugin.json) into the plugins folder
  check      check plugin manifests against plugin.schema.json
  remove     remove a plugin (through Ardia when it's running)
  enable     ask Ardia to show a plugin's consent sheet
  disable    turn a plugin off
  call       call one of a plugin's tools and print its result as JSON
  path       print the plugins folder
"""


def add_parsers(commands, formatter):
    group = commands.add_parser("plugins", help="install, list and manage plugins", description=DESCRIPTION.format(folder=config_files.default_folder() / "plugins"), formatter_class=formatter)
    sub = group.add_subparsers(dest="plugins_command", metavar="<command>")

    def data_dir(parser):
        parser.add_argument("--data-dir", metavar="DIR", help=DATA_DIR_HELP)
        return parser

    listing = data_dir(sub.add_parser("list", help="list the plugins"))
    listing.add_argument("--json", action="store_true", help="print JSON")
    install = data_dir(sub.add_parser("install", help="install a plugin from a folder or plugin.json"))
    install.add_argument("source", metavar="PATH", help="a plugin's folder, or its plugin.json")
    install.add_argument("--force", action="store_true", help="replace a plugin with the same name")
    check = data_dir(sub.add_parser("check", help="check plugin manifests"))
    check.add_argument("target", nargs="?", metavar="NAME|PATH", help="an installed plugin's name or a path (default: every installed plugin)")
    check.add_argument("--json", action="store_true", help="print JSON")
    for verb, text in (("remove", "remove a plugin"), ("enable", "show a plugin's consent sheet in Ardia"), ("disable", "turn a plugin off")):
        data_dir(sub.add_parser(verb, help=text)).add_argument("name", metavar="NAME")
    call = data_dir(sub.add_parser("call", help="call a plugin's tool"))
    call.add_argument("name", metavar="NAME")
    call.add_argument("tool", metavar="TOOL")
    call.add_argument("input", nargs="?", metavar="JSON", help="the tool's input, a JSON object (default {})")
    data_dir(sub.add_parser("path", help="print the plugins folder"))


def plugins_folder(args) -> Path:
    return config_files.places(args.data_dir).folder / "plugins"


def read_manifest(path: Path):
    if path.is_dir():
        path = path / MANIFEST
    if path.is_symlink():
        raise config_files.ConfigError(f"{path} is a link; a plugin's {MANIFEST} must be a file in its folder")
    if not path.is_file():
        raise config_files.ConfigError(f"{path} isn't a plugin: it has no {MANIFEST}")
    if path.stat().st_size > MAX_MANIFEST:
        raise config_files.ConfigError(f"{path} is over 1 MB")
    return config_files.read_object(path, str(path))


SIDES = ("left", "right", "top", "bottom")


def current_manifest(manifest: dict, known: int):
    given = manifest.get("manifest")
    if "manifest" in manifest and (isinstance(given, bool) or not isinstance(given, int) or given < 0):
        return None, ["manifest must be a whole number, the manifest's version"]
    if given is not None and given > known:
        return None, [f"manifest {given} needs a newer Ardia (this one reads up to {known})"]
    if given:
        return manifest, []
    doc = {key: value for key, value in manifest.items() if key not in ("settings", "reset")}
    if "settings" in manifest:
        doc["settings"] = {"defaults": manifest["settings"]}
    doc["manifest"] = known
    return doc, []


def well_formed(value: str) -> bool:
    try:
        value.encode("utf-8")
        return True
    except UnicodeEncodeError:
        return False


def is_plugin_path(value) -> bool:
    if not isinstance(value, str) or not value or not well_formed(value) or len(value.encode()) > 1024 or value.startswith("/") or "\\" in value or "\0" in value:
        return False
    return all(part not in ("", ".", "..") for part in value.split("/"))


def named(items) -> list[dict]:
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []


def duplicates(values) -> list:
    seen, twice = set(), []
    for value in values:
        if isinstance(value, str) and value in seen and value not in twice:
            twice.append(value)
        seen.add(value)
    return twice


def row_problems(rows: list[dict]) -> list[str]:
    problems = []
    for i, row in enumerate(rows):
        at, kind, default = f"settings.rows[{i}]", row.get("type"), row.get("default")
        if kind != "choice" and "choices" in row:
            problems.append(f"{at}.choices only goes with type choice")
        if kind == "toggle" and not isinstance(default, bool):
            problems.append(f"{at}.default must be true or false")
        if kind == "text" and (not isinstance(default, str) or len(default) > 200):
            problems.append(f"{at}.default must be text of at most 200 characters")
        if kind == "choice":
            choices = [c.get("value") for c in named(row.get("choices"))]
            if "choices" not in row:
                problems.append(f"{at}.choices must be a list of 2 to 12 choices")
            if default not in choices:
                problems.append(f"{at}.default must be one of its choices' values")
            problems += [f"{at}.choices has two choices named {v}" for v in duplicates(choices)]
    return problems


def command_problems(commands: list[dict], rows: list[dict], tools: list[dict], page, permissions: list) -> list[str]:
    problems = []
    tool_names = {t.get("name") for t in tools}
    for i, command in enumerate(commands):
        at, has_tool, has_open = f"commands[{i}]", "tool" in command, "open" in command
        if has_tool == has_open:
            problems.append(f'{at} needs either tool (one of the plugin\'s tools) or open ("tab" or "split")')
            continue
        if has_tool:
            problems += [f"{at}.{key} only goes with open" for key in ("context", "side", "sideSetting", "path") if key in command]
            if command["tool"] not in tool_names:
                problems.append(f"{at}.tool: {command['tool']} isn't one of this plugin's tools")
            continue
        if "input" in command:
            problems.append(f"{at}.input only goes with tool")
        if command.get("open") != "split" and ("side" in command or "sideSetting" in command):
            problems.append(f"{at}: side and sideSetting only go with open: split")
        if page is None:
            problems.append(f"{at}.open needs a page")
        if command.get("context") is True and "tabs" not in permissions:
            problems.append(f"{at}.context needs the tabs permission")
        if "sideSetting" in command:
            row = next((r for r in rows if r.get("key") == command["sideSetting"]), None)
            if not row or row.get("type") != "choice" or not all(c.get("value") in SIDES for c in named(row.get("choices"))):
                problems.append(f"{at}.sideSetting must name a choice row whose values are left, right, top or bottom")
    return problems


def rule_problems(doc: dict, rules: dict) -> list[str]:
    permissions = doc.get("permissions") if isinstance(doc.get("permissions"), list) else []
    settings = doc.get("settings") if isinstance(doc.get("settings"), dict) else {}
    defaults = settings.get("defaults") if isinstance(settings.get("defaults"), dict) else {}
    rows, tools, commands = named(settings.get("rows")), named(doc.get("tools")), named(doc.get("commands"))
    page = doc.get("page") if isinstance(doc.get("page"), dict) else None
    process = doc.get("process") if isinstance(doc.get("process"), dict) else None
    hooks = doc.get("hooks") if isinstance(doc.get("hooks"), list) else []
    problems = []
    if "fullUrls" in permissions and "tabs" not in permissions:
        problems.append("permissions: fullUrls needs tabs")
    problems += [f"settings.defaults: {key} needs its own approval in Settings, so a plugin can't set it" for key in rules.get("approvedSettings", []) if key in defaults]
    problems += row_problems(rows)
    for where, what, values in (("settings.rows", "rows", [r.get("key") for r in rows]), ("tools", "tools", [t.get("name") for t in tools]), ("commands", "commands", [c.get("name") for c in commands])):
        problems += [f"{where} has two {what} named {v}" for v in duplicates(values)]
    problems += command_problems(commands, rows, tools, page, permissions)
    if page is not None:
        if "served" in page:
            problems.append("page.served is gone: a page is static files from the plugin's folder (page.file), and it talks to its helper with window.ardia.send")
        elif not is_plugin_path(page.get("file")):
            problems.append("page.file must be a path inside the plugin's folder, like page/index.html")
        if doc.get("name") in rules.get("reservedPageNames", []):
            problems.append(f"name: {doc['name']} is one of Ardia's own pages (ardia://{doc['name']}), so a plugin with a page can't use it")
    if process is not None:
        run = process.get("run")
        if isinstance(run, list) and any(isinstance(arg, str) and not well_formed(arg) for arg in run):
            problems.append("process.run has an argument that isn't well-formed Unicode")
        program = run[0] if isinstance(run, list) and run and isinstance(run[0], str) else None
        if program and not program.startswith("/") and "/" in program and not is_plugin_path(program):
            problems.append("process.run[0] must be a file in the plugin's folder, an absolute path or a program name")
    else:
        needs = (("tool commands", any("tool" in c for c in commands)), ("tools", bool(tools)), ("hooks", bool(hooks)))
        problems += [f"{what} needs a process" for what, used in needs if used]
    untabbed = set(rules.get("untabbedEvents", []))
    problems += [f"hooks[{i}]: {hook} needs the tabs permission" for i, hook in enumerate(hooks) if isinstance(hook, str) and hook not in untabbed and "tabs" not in permissions]
    return problems


SAFE_TEXT = re.compile(r"must match \^\(\?=.*\]\{1,(\d+)\}\$$")


def shown_rule(message: str) -> str:
    safe = SAFE_TEXT.search(message)
    return message[: safe.start()] + f"must be text of 1 to {safe.group(1)} characters, without control or direction characters" if safe else message


def schema_problems(where, doc: dict, schema: dict) -> list[str]:
    from ardia_cli.schema_check import validate

    problems = [f"{p.to_dict()['key'] or 'plugin.json'}: {shown_rule(p.message)}" for p in validate(doc, schema)]
    config = config_files.find_schema(where, "config.schema.json").document
    settings_schema = ((config or {}).get("properties") or {}).get("settings")
    defaults = doc["settings"].get("defaults") if isinstance(doc.get("settings"), dict) else None
    if isinstance(defaults, dict) and defaults and not isinstance(settings_schema, dict):
        problems.append("settings.defaults can't be checked: Ardia hasn't written config.schema.json for this data folder yet (open Ardia once)")
    elif isinstance(settings_schema, dict) and isinstance(defaults, dict):
        problems += [f"settings.defaults: {p.message}" for p in validate(defaults, settings_schema)]
    return problems


def plugin_schema(where) -> dict:
    written = config_files.find_schema(where, SCHEMA).document
    return written if written is not None else json.loads(SHIPPED_SCHEMA.read_text(encoding="utf-8"))


def manifest_problems(args, manifest: dict) -> list[str]:
    where = config_files.places(args.data_dir)
    schema = plugin_schema(where)
    known = ((schema.get("properties") or {}).get("manifest") or {}).get("maximum", 1)
    doc, problems = current_manifest(manifest, known)
    if doc is None:
        return problems
    problems += schema_problems(where, doc, schema)
    if not problems:
        problems += rule_problems(doc, schema.get("x-ardia-rules") or {})
    name = doc.get("name")
    if not isinstance(name, str) or not NAME.match(name):
        problems.append("name must be 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit")
    return list(dict.fromkeys(problems))


def unreachable_exit(error: Unreachable) -> int:
    error.noted()
    complain(f"ardia: {error}")
    return 2


def ask(args, method: str, params=None, timeout: float = 30.0):
    return control.call(args.data_dir, method, params, timeout)


def files_listing(args) -> list[dict]:
    folder = plugins_folder(args)
    out = []
    for entry in sorted(folder.iterdir()) if folder.is_dir() else []:
        if not NAME.match(entry.name):
            continue
        try:
            manifest = read_manifest(entry)
            problems = manifest_problems(args, manifest)
            if manifest.get("name") != entry.name:
                problems.append(f"name is {manifest.get('name')}, but its folder is {entry.name}")
            out.append({"name": entry.name, "title": manifest.get("title") or entry.name, "version": manifest.get("version"), "enabled": None, "problems": problems})
        except (config_files.ConfigError, OSError) as error:
            out.append({"name": entry.name, "title": entry.name, "version": None, "enabled": None, "problems": [str(error)]})
    return out


def cmd_list(args) -> int:
    try:
        plugins = ask(args, "plugins")
    except (Unreachable, MethodError):
        plugins = files_listing(args)
    if args.json:
        say(json.dumps(plugins, indent=2, ensure_ascii=False))
        return 0
    if not plugins:
        say(f"No plugins in {plugins_folder(args)}")
    for plugin in plugins:
        state = "on" if plugin.get("active") else "changed, review it in Ardia" if plugin.get("needsReview") else "off" if plugin.get("enabled") is not None else "installed (Ardia isn't reachable, so on or off is unknown)"
        running = f", program {plugin['process']}" if plugin.get("process") else ""
        adds = f"  adds {', '.join(plugin['contributes'])}" if plugin.get("contributes") else ""
        version = f" {plugin['version']}" if plugin.get("version") else ""
        say(shown(f"{plugin['name']}{version}  {state}{running}{adds}"))
        for problem in plugin.get("problems") or []:
            say(shown(f"  problem: {problem}"))
    return 0


def copy_tree(source: Path, target: Path) -> None:
    total = 0
    for path in source.rglob("*"):
        if path.is_symlink():
            raise config_files.ConfigError(f"{path} is a link; a plugin's files must be real files")
        if path.is_file():
            total += path.stat().st_size
    if total > MAX_COPY:
        raise config_files.ConfigError(f"{source} is over 200 MB")
    shutil.copytree(source, target, symlinks=True)


RENAME_EXCL = 0x4
RENAME_NOREPLACE = 0x1
RENAME_SWAP = 0x2
RENAME_EXCHANGE = 0x2
AT_FDCWD = -100


class KeptAside(OSError):
    pass


def rename_exchange(first: Path, second: Path) -> None:
    if os.name == "nt":
        raise NotImplementedError
    libc = ctypes.CDLL(None, use_errno=True)
    a, b = os.fsencode(first), os.fsencode(second)
    if sys.platform == "darwin":
        result = libc.renamex_np(a, b, RENAME_SWAP)
    elif hasattr(libc, "renameat2"):
        result = libc.renameat2(AT_FDCWD, a, AT_FDCWD, b, RENAME_EXCHANGE)
    else:
        raise NotImplementedError
    if result != 0:
        code = ctypes.get_errno()
        if code in (errno.ENOTSUP, errno.EINVAL, errno.ENOSYS):
            raise NotImplementedError
        raise OSError(code, os.strerror(code), str(second))


def rename_no_replace(source: Path, target: Path) -> None:
    if os.name == "nt":
        os.rename(source, target)
        return
    libc = ctypes.CDLL(None, use_errno=True)
    src, dst = os.fsencode(source), os.fsencode(target)
    if sys.platform == "darwin":
        result = libc.renamex_np(src, dst, RENAME_EXCL)
    elif hasattr(libc, "renameat2"):
        result = libc.renameat2(AT_FDCWD, src, AT_FDCWD, dst, RENAME_NOREPLACE)
    else:
        os.mkdir(target)
        os.rename(source, target)
        return
    if result != 0:
        code = ctypes.get_errno()
        raise FileExistsError(code, os.strerror(code), str(target)) if code == errno.EEXIST else OSError(code, os.strerror(code), str(target))


def publish(staged: Path, target: Path, aside: Path, force: bool) -> bool:
    if force and (target.exists() or target.is_symlink()):
        try:
            rename_exchange(staged, target)
            return True
        except NotImplementedError:
            pass
        except FileNotFoundError:
            rename_no_replace(staged, target)
            return False
        return replace_through_aside(staged, target, aside)
    rename_no_replace(staged, target)
    return False


def replace_through_aside(staged: Path, target: Path, aside: Path) -> bool:
    try:
        os.rename(target, aside)
    except FileNotFoundError:
        rename_no_replace(staged, target)
        return False
    try:
        rename_no_replace(staged, target)
    except BaseException as error:
        try:
            rename_no_replace(aside, target)
        except BaseException:
            raise KeptAside(f"{error}; the plugin that was installed before couldn't be put back and is kept in {aside}") from error
        raise
    return True


def cmd_install(args) -> int:
    source = Path(args.source).expanduser()
    try:
        manifest = read_manifest(source)
    except (config_files.ConfigError, OSError) as error:
        complain(f"ardia plugins install: {error}")
        return 1
    problems = manifest_problems(args, manifest)
    if problems:
        for problem in problems:
            complain(f"ardia plugins install: {problem}")
        return 1
    name = manifest["name"]
    folder = plugins_folder(args)
    target = folder / name
    if (target.exists() or target.is_symlink()) and not args.force:
        complain(f"ardia plugins install: {name} is already installed (--force replaces it)")
        return 1
    replacing = False
    folder.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{name}.", dir=folder))
    try:
        staged = staging / name
        if source.is_dir():
            copy_tree(source, staged)
        else:
            staged.mkdir()
            shutil.copy2(source, staged / MANIFEST)
        copied = read_manifest(staged)
        problems = manifest_problems(args, copied) + ([] if copied.get("name") == name else [f"its name changed to {copied.get('name')} while it was copied"])
        if problems:
            raise config_files.ConfigError("; ".join(problems))
        if args.force and (target.exists() or target.is_symlink()):
            try:
                ask(args, "plugins.disable", {"name": name})
            except (Unreachable, MethodError):
                pass
        replacing = publish(staged, target, staging / "previous", args.force)
    except KeptAside as error:
        complain(f"ardia plugins install: {error}")
        return 1
    except FileExistsError:
        shutil.rmtree(staging, ignore_errors=True)
        complain(f"ardia plugins install: {name} is already installed (--force replaces it)")
        return 1
    except (config_files.ConfigError, OSError) as error:
        shutil.rmtree(staging, ignore_errors=True)
        complain(f"ardia plugins install: {error}")
        return 1
    shutil.rmtree(staging, ignore_errors=True)
    state = "Replaced" if replacing else "Installed"
    say(f"{state} {name} in {target}. It's off: turn it on in Ardia's Settings › Plugins, or with ardia plugins enable {name}.")
    return 0


def cmd_check(args) -> int:
    targets = []
    installed = not (args.target and ("/" in args.target or args.target.endswith(".json")))
    if not installed:
        targets = [Path(args.target).expanduser()]
    elif args.target:
        targets = [plugins_folder(args) / args.target]
    else:
        folder = plugins_folder(args)
        targets = sorted(p for p in folder.iterdir() if NAME.match(p.name)) if folder.is_dir() else []
    report = []
    for target in targets:
        try:
            manifest = read_manifest(target)
            problems = manifest_problems(args, manifest)
            if installed and manifest.get("name") != target.name:
                problems.append(f"name is {manifest.get('name')}, but its folder is {target.name}")
        except (config_files.ConfigError, OSError) as error:
            problems = [str(error)]
        report.append({"file": str(target), "problems": problems})
    ok = all(not r["problems"] for r in report)
    if args.json:
        say(json.dumps({"ok": ok, "plugins": report}, indent=2, ensure_ascii=False))
    else:
        for entry in report:
            say(shown(f"{entry['file']}: {'ok' if not entry['problems'] else ''}"))
            for problem in entry["problems"]:
                say(shown(f"  {problem}"))
    return 0 if ok else 1


def cmd_remove(args) -> int:
    try:
        ask(args, "plugins.remove", {"name": args.name})
        say(f"Removed {args.name}.")
        return 0
    except MethodError as error:
        complain(f"ardia plugins remove: {error.message}")
        return 1
    except Unreachable as error:
        if error.sent:
            complain(f"ardia plugins remove: Ardia got the request but didn't answer, so {args.name} is left as it is. Run this again.")
            return unreachable_exit(error)
    target = plugins_folder(args) / args.name
    if not NAME.match(args.name) or not (target.exists() or target.is_symlink()):
        complain(f"ardia plugins remove: there's no plugin {args.name}")
        return 1
    if target.is_symlink():
        target.unlink()
    else:
        shutil.rmtree(target)
    say(f"Removed {args.name}.")
    return 0


def cmd_toggle(args) -> int:
    method = "plugins.enable" if args.plugins_command == "enable" else "plugins.disable"
    try:
        result = ask(args, method, {"name": args.name})
    except Unreachable as error:
        return unreachable_exit(error)
    except MethodError as error:
        complain(f"ardia plugins {args.plugins_command}: {error.message}")
        return 1
    if isinstance(result, dict) and result.get("waiting"):
        say(f"Ardia is showing what {args.name} gets; turn it on there.")
    else:
        say(f"{args.name} is {'on' if args.plugins_command == 'enable' else 'off'}.")
    return 0


def cmd_call(args) -> int:
    try:
        payload = config_files.parse_json(args.input) if args.input is not None else {}
    except ValueError as error:
        complain(f"ardia plugins call: the input isn't JSON ({error})")
        return 1
    try:
        result = ask(args, "plugins.call", {"plugin": args.name, "tool": args.tool, "input": payload}, CALL_TIMEOUT)
    except Unreachable as error:
        return unreachable_exit(error)
    except MethodError as error:
        complain(f"ardia plugins call: {error.message}")
        return 1
    except UnicodeEncodeError as error:
        complain(f"ardia plugins call: the input has text that can't be sent as UTF-8 ({error.reason})")
        return 1
    say(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


def run(args, parser) -> int:
    handlers = {"list": cmd_list, "install": cmd_install, "check": cmd_check, "remove": cmd_remove, "enable": cmd_toggle, "disable": cmd_toggle, "call": cmd_call}
    if args.plugins_command == "path":
        say(str(plugins_folder(args)))
        return 0
    handler = handlers.get(args.plugins_command)
    if handler is None:
        parser.parse_args(["plugins", "--help"])
        return 0
    return handler(args)
