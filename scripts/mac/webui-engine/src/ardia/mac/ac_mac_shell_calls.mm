#import <AppKit/AppKit.h>

#include <dlfcn.h>

#include <optional>
#include <string>
#include <string_view>
#include <utility>

#include "ardia/mac/ac_mac_shell_bridge.h"
#include "ardia/mac/ac_mac_shell_host.h"
#include "ardia/mac/ac_mac_popover_policy.h"
#include "ardia/mac/ac_mac_shell_policy.h"
#include "ardia/mac/generated/ac_desktop_routes.h"
#include "base/files/file_enumerator.h"
#include "base/files/file_util.h"
#include "base/files/important_file_writer.h"
#include "base/functional/bind.h"
#include "base/json/json_reader.h"
#include "base/json/json_writer.h"
#include "base/no_destructor.h"
#include "base/strings/string_util.h"
#include "base/strings/string_number_conversions.h"
#include "base/strings/utf_string_conversions.h"
#include "base/system/sys_info.h"
#include "base/task/sequenced_task_runner.h"
#include "base/task/task_traits.h"
#include "base/task/thread_pool.h"
#include "chrome/browser/lifetime/application_lifetime.h"
#include "chrome/browser/browser_process.h"
#include "chrome/browser/profiles/profile.h"
#include "chrome/browser/profiles/profile_manager.h"
#include "chrome/browser/ui/browser_window/public/browser_window_interface.h"
#include "chrome/browser/ui/views/frame/browser_view.h"
#include "components/version_info/version_info.h"
#include "ui/base/clipboard/clipboard.h"
#include "ui/base/clipboard/clipboard_buffer.h"
#include "ui/base/clipboard/scoped_clipboard_writer.h"
#include "ui/base/base_window.h"
#include "ui/views/widget/widget.h"

namespace ardia_mac {

namespace {

constexpr size_t kDocumentLimit = 8 * 1024 * 1024;

typedef void (*EngineReply)(void* context, const char* json);
typedef void (*EngineFunction)(const char* profile_dir,
                               const char* args_json,
                               EngineReply reply,
                               void* context);

constexpr std::string_view kPopoverCapabilities[] = {
    "shell.popover.open",
    "shell.popover.update",
    "shell.popover.close",
    "shell.popover.beyondWindow",
};

constexpr std::string_view kCapabilities[] = {
    "shell.inputRegions",
    "shell.glassRegions",
    "shell.backdropRegions",
    "shell.showContextMenu",
    "shell.trafficLights",
    "ArdiaShell.setMainMenu",
    "ArdiaShell.windowIdentity",
    "ArdiaShell.copyText",
    "ArdiaShell.readText",
    "ArdiaShell.quit",
    "ArdiaShell.startWindowMove",
    "ArdiaShell.captionDoubleClick",
};

scoped_refptr<base::SequencedTaskRunner> FileRunner() {
  static base::NoDestructor<scoped_refptr<base::SequencedTaskRunner>> runner(
      base::ThreadPool::CreateSequencedTaskRunner(
          {base::MayBlock(), base::TaskPriority::USER_BLOCKING,
           base::TaskShutdownBehavior::BLOCK_SHUTDOWN}));
  return *runner;
}

base::FilePath DocumentDirectory() {
  return DataDirectory();
}

constexpr size_t kBootstrapDocumentLimit = 1024 * 1024;
constexpr size_t kBootstrapBudget = 8 * 1024 * 1024;

bool ValidDocumentName(const std::string& name) {
  return shell_policy::ValidDocumentName(name);
}

std::optional<base::DictValue> ReadSessionFile() {
  std::string text;
  if (!base::ReadFileToStringWithMaxSize(
          DataDirectory().Append("session.json"), &text,
          shell_policy::kSessionLimit)) {
    return std::nullopt;
  }
  std::optional<base::Value> parsed =
      base::JSONReader::Read(text, base::JSON_PARSE_RFC);
  if (!parsed || !parsed->is_dict()) {
    return std::nullopt;
  }
  return std::move(parsed->GetDict());
}

bool WriteSessionFile(base::DictValue session) {
  std::optional<std::string> json = base::WriteJson(base::Value(std::move(session)));
  if (!json || !shell_policy::SessionFits(json->size())) {
    return false;
  }
  return base::ImportantFileWriter::WriteFileAtomically(
      DataDirectory().Append("session.json"), *json);
}

base::DictValue ReadDocuments() {
  base::DictValue documents;
  base::FileEnumerator files(DocumentDirectory(), false,
                             base::FileEnumerator::FILES);
  size_t budget = kBootstrapBudget;
  for (base::FilePath path = files.Next(); !path.empty(); path = files.Next()) {
    std::string text;
    const std::string name = path.BaseName().value();
    if (ValidDocumentName(name) && name.ends_with(".json") &&
        !name.starts_with("session-backup") &&
        files.GetInfo().GetSize() <= static_cast<int64_t>(kBootstrapDocumentLimit) &&
        static_cast<size_t>(files.GetInfo().GetSize()) <= budget &&
        base::ReadFileToStringWithMaxSize(path, &text, kBootstrapDocumentLimit)) {
      budget -= text.size();
      documents.Set(name, std::move(text));
    }
  }
  return documents;
}

void Reply(ShellHostView::Done done, base::Value value) {
  std::move(done).Run(true, std::move(value));
}

void* EngineImage() {
  static void* image = [] {
    Dl_info info;
    if (!dladdr(reinterpret_cast<void*>(&EngineImage), &info) || !info.dli_fname) {
      return static_cast<void*>(nullptr);
    }
    return dlopen(info.dli_fname, RTLD_LAZY | RTLD_NOLOAD);
  }();
  return image;
}

}

std::string ShellHostView::BootstrapJson() const {
  base::DictValue info;
  info.Set("appName", "Ardia");
  info.Set("appVersion", std::string(version_info::GetVersionNumber()));
  info.Set("appBuild", "mac-webui");
  info.Set("bundleId", "dev.ardia.mac.webui");
  info.Set("configuration", "Release");
  info.Set("osVersion", base::SysInfo::OperatingSystemVersion());
  info.Set("osBuild", "macOS");
  info.Set("arch", base::SysInfo::OperatingSystemArchitecture());
  info.Set("model", base::SysInfo::HardwareModelName());
  info.Set("memoryGB", base::SysInfo::AmountOfTotalPhysicalMemory().InBytes() /
                           (1024.0 * 1024 * 1024));
  info.Set("locale", "en-US");
  info.Set("updates", false);
  info.Set("isolatedInstance", true);
  base::ListValue capabilities;
  for (std::string_view capability : kCapabilities) {
    capabilities.Append(capability);
  }
  if (popover::kPopoverRendererShipped) {
    for (std::string_view capability : kPopoverCapabilities) {
      capabilities.Append(capability);
    }
  }
  for (const auto& route : ardia::desktop_routes::kRoutes) {
    capabilities.Append(route.name);
  }
  base::DictValue bootstrap;
  bootstrap.Set("windowId", window_id_);
  bootstrap.Set("startup", true);
  bootstrap.Set("profileId", "default");
  bootstrap.Set("nativeModules",
                base::DictValue().Set(
                    "ArdiaApp", base::DictValue().Set("systemInfo", std::move(info))));
  bootstrap.Set("capabilities", std::move(capabilities));
  bootstrap.Set("glassPanels", true);
  bootstrap.Set("pageProfile", "");
  bootstrap.Set("windowKind", "browser");
  bootstrap.Set("shellZoom", 1.0);
  return base::WriteJson(bootstrap).value_or("{}");
}

std::optional<std::string> BootstrapScript(const std::string& bootstrap_json,
                                           const char* host_bootstrap) {
  std::optional<base::Value> bootstrap =
      base::JSONReader::Read(bootstrap_json, base::JSON_PARSE_RFC);
  if (!bootstrap || !bootstrap->is_dict()) {
    return std::nullopt;
  }
  if (std::optional<base::DictValue> session = ReadSessionFile()) {
    bootstrap->GetDict().Set("session", std::move(*session));
  }
  bootstrap->GetDict().Set("documents", ReadDocuments());
  std::optional<std::string> json = base::WriteJson(*bootstrap);
  std::optional<std::string> literal = json ? base::WriteJson(base::Value(*json))
                                            : std::nullopt;
  if (!literal) {
    return std::nullopt;
  }
  return "globalThis.__ardiaBootstrap=JSON.parse(" + *literal + ");\n" +
         host_bootstrap;
}

void ShellHostView::Invoke(const std::string& method,
                           const base::DictValue& args,
                           Done done) {
  const base::ListValue* values = Arguments(args);
  const auto first_string = [values]() -> std::string {
    return values && !values->empty() && (*values)[0].is_string()
               ? (*values)[0].GetString()
               : std::string();
  };
  if (method == "tab.create") {
    return CreateTab(args, std::move(done));
  }
  if (method == "tab.viewport") {
    return SetViewport(args, std::move(done));
  }
  if (method == "tab.command") {
    return TabCommand(args, std::move(done));
  }
  if (method == "tab.release") {
    return ReleaseTab(args, std::move(done));
  }
  if (method == "tab.close") {
    return CloseTab(args, std::move(done));
  }
  if (method == "tab.presentations") {
    return SetPresentations(args, std::move(done));
  }
  if (method == "shell.inputRegions") {
    return SetInputRegions(args, std::move(done));
  }
  if (method == "shell.glassRegions") {
    return SetGlassRegions(args, std::move(done));
  }
  if (method == "shell.backdropRegions") {
    return SetBackdropRegions(args, std::move(done));
  }
  if (method == "shell.popover.open" || method == "shell.popover.update" ||
      method == "shell.popover.close") {
    return PopoverCall(method, args, std::move(done));
  }
  if (method == "shell.showContextMenu") {
    return ShowShellContextMenu(args, std::move(done));
  }
  if (method == "shell.trafficLights") {
    return SetTrafficLights(args, std::move(done));
  }
  if (method == "ArdiaShell.setMainMenu") {
    return SetMainMenu(args, std::move(done));
  }
  if (method == "ArdiaShell.setMenuState" ||
      method == "ArdiaShell.setMenuBookmarks") {
    return std::move(done).Run(true, base::Value());
  }
  if (method == "ArdiaShell.setKeyboardShortcuts") {
    return SetKeyboardShortcuts(values, std::move(done));
  }
  if (method == "ArdiaShell.captionDoubleClick") {
    return CaptionDoubleClick(std::move(done));
  }
  if (method == "ArdiaShell.startWindowMove") {
    return StartWindowMove(std::move(done));
  }
  if (method == "ArdiaTabs.unclaimedTabs") {
    return ListUnclaimedTabs(std::move(done));
  }
  if (method == "session.read") {
    FileRunner()->PostTaskAndReplyWithResult(
        FROM_HERE, base::BindOnce(&ReadSessionFile),
        base::BindOnce(
            [](Done done, std::optional<base::DictValue> session) {
              std::move(done).Run(true, session ? base::Value(std::move(*session))
                                                : base::Value());
            },
            std::move(done)));
    return;
  }
  if (method == "session.write") {
    const base::DictValue* session = args.FindDict("session");
    if (!session) {
      return std::move(done).Run(false, base::Value("A session is required"));
    }
    base::DictValue copy = session->Clone();
    FileRunner()->PostTaskAndReplyWithResult(
        FROM_HERE, base::BindOnce(&WriteSessionFile, session->Clone()),
        base::BindOnce(
            [](Done done, base::DictValue session, bool ok) {
              if (!ok) {
                return std::move(done).Run(
                    false, base::Value("The session could not be saved"));
              }
              std::move(done).Run(true, base::Value(std::move(session)));
            },
            std::move(done), std::move(copy)));
    return;
  }
  if (method == "ArdiaShell.readDocument") {
    const std::string name = first_string();
    if (!ValidDocumentName(name)) {
      return std::move(done).Run(
          false, Failure("ERR_DOCUMENT_NAME", "Invalid document name"));
    }
    FileRunner()->PostTaskAndReplyWithResult(
        FROM_HERE,
        base::BindOnce(
            [](base::FilePath path) -> std::optional<std::string> {
              std::string text;
              if (!base::ReadFileToStringWithMaxSize(path, &text, kDocumentLimit)) {
                return std::nullopt;
              }
              return text;
            },
            DocumentDirectory().Append(name)),
        base::BindOnce(
            [](Done done, std::optional<std::string> text) {
              std::move(done).Run(true, text ? base::Value(std::move(*text))
                                             : base::Value());
            },
            std::move(done)));
    return;
  }
  if (method == "ArdiaShell.writeDocument" ||
      method == "ArdiaShell.saveDocument") {
    const std::string name = first_string();
    if (!ValidDocumentName(name) || !values || values->size() != 2 ||
        !(*values)[1].is_string() ||
        (*values)[1].GetString().size() > kDocumentLimit) {
      return std::move(done).Run(
          false, Failure("ERR_DOCUMENT_REQUEST", "Invalid document write"));
    }
    FileRunner()->PostTaskAndReplyWithResult(
        FROM_HERE,
        base::BindOnce(
            [](base::FilePath directory, std::string name, std::string text) {
              return base::CreateDirectory(directory) &&
                     base::ImportantFileWriter::WriteFileAtomically(
                         directory.Append(name), text);
            },
            DocumentDirectory(), name, (*values)[1].GetString()),
        base::BindOnce(
            [](Done done, bool ok) {
              if (!ok) {
                return std::move(done).Run(
                    false, Failure("ERR_DOCUMENT_WRITE", "Could not save"));
              }
              std::move(done).Run(true, base::Value());
            },
            std::move(done)));
    return;
  }
  if (method == "ArdiaShell.removeDocument") {
    const std::string name = first_string();
    if (!ValidDocumentName(name)) {
      return std::move(done).Run(
          false, Failure("ERR_DOCUMENT_NAME", "Invalid document name"));
    }
    FileRunner()->PostTask(
        FROM_HERE, base::BindOnce(base::IgnoreResult(&base::DeleteFile),
                                  DocumentDirectory().Append(name)));
    return Reply(std::move(done), base::Value());
  }
  if (method == "ArdiaShell.windowIdentity") {
    return Reply(std::move(done),
                 base::Value(base::DictValue()
                                 .Set("windowId", window_id_)
                                 .Set("rendererGeneration",
                                      base::NumberToString(renderer_generation_))));
  }
  if (method == "ArdiaShell.windowIds") {
    return Reply(std::move(done), base::Value(base::ListValue().Append(window_id_)));
  }
  if (method == "ArdiaShell.windowFrame") {
    const gfx::Rect bounds = browser_ ? browser_->GetWindow()->GetBounds()
                                      : gfx::Rect();
    return Reply(std::move(done), base::Value(base::ListValue()
                                                  .Append(bounds.x())
                                                  .Append(bounds.y())
                                                  .Append(bounds.width())
                                                  .Append(bounds.height())));
  }
  if (method == "ArdiaShell.windowState") {
    return Reply(std::move(done),
                 base::Value(base::DictValue()
                                 .Set("windowId", window_id_)
                                 .Set("maximized", false)
                                 .Set("tiled", false)
                                 .Set("fullScreen", false)));
  }
  if (method == "ArdiaShell.windowButtonLayout") {
    return Reply(std::move(done),
                 base::Value(base::DictValue()
                                 .Set("layout", "close,minimize,maximize:")
                                 .Set("desktop", "macos")));
  }
  if (method == "ArdiaShell.isDarkAppearance") {
    NSAppearanceName name = [NSApp.effectiveAppearance
        bestMatchFromAppearancesWithNames:@[ NSAppearanceNameAqua,
                                             NSAppearanceNameDarkAqua ]];
    return Reply(std::move(done),
                 base::Value([name isEqualToString:NSAppearanceNameDarkAqua]));
  }
  if (method == "ArdiaShell.shellPainted") {
    if (!painted_) {
      painted_ = true;
      Note("shell painted in window " + window_id_);
    }
    return Reply(std::move(done), base::Value());
  }
  if (method == "ArdiaShell.copyText") {
    const std::string text = first_string();
    {
      ui::ScopedClipboardWriter writer(ui::ClipboardBuffer::kCopyPaste);
      writer.WriteText(base::UTF8ToUTF16(text));
    }
    return Reply(std::move(done), base::Value());
  }
  if (method == "ArdiaShell.readText") {
    ui::Clipboard* clipboard = ui::Clipboard::GetForCurrentThread();
    if (!clipboard) {
      return Reply(std::move(done), base::Value(""));
    }
    clipboard->ReadText(
        ui::ClipboardBuffer::kCopyPaste, std::nullopt,
        base::BindOnce(
            [](Done done, std::u16string text) {
              std::move(done).Run(true, base::Value(base::UTF16ToUTF8(text)));
            },
            std::move(done)));
    return;
  }
  if (method == "ArdiaShell.focusWindow") {
    if (browser_ && !BackgroundInstance()) {
      browser_->GetWindow()->Activate();
    }
    return Reply(std::move(done), base::Value(true));
  }
  if (method == "ArdiaShell.setActiveProfile") {
    const std::string requested = first_string();
    if (requested.empty() || requested == "default") {
      return Reply(std::move(done), base::Value(true));
    }
    WithProfile(requested,
                base::BindOnce(
                    [](base::WeakPtr<ShellHostView> host, Done done,
                       Profile* profile) {
                      std::move(done).Run(
                          true, base::Value(host && profile &&
                                            host->EnsureMember(profile)));
                    },
                    GetWeakPtr(), std::move(done)));
    return;
  }
  if (method == "ArdiaShell.quit" || method == "ArdiaShell.closeWindow") {
    Reply(std::move(done), base::Value());
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(&chrome::AttemptExit));
    return;
  }
  if (method.starts_with("ArdiaTelemetry.") || method.starts_with("ArdiaUpdates.") ||
      method == "ArdiaShell.fetchBangList") {
    return std::move(done).Run(
        false, Failure("ERR_UNAVAILABLE", "The Mac WebUI spike sends nothing"));
  }
  if (method == "engine.info") {
    return Reply(std::move(done),
                 base::Value(base::DictValue()
                                 .Set("version",
                                      std::string(version_info::GetVersionNumber()))
                                 .Set("shell", "mac-webui")));
  }
  NoteUnhandled(method);
  std::move(done).Run(true, base::Value());
}

void ShellHostView::EngineCall(const std::string& name,
                               const std::string& profile,
                               const base::Value* args,
                               Done done) {
  if (name == "profiles.loaded") {
    base::ListValue loaded;
    for (Profile* loaded_profile :
         g_browser_process->profile_manager()->GetLoadedProfiles()) {
      if (!loaded_profile->IsOffTheRecord()) {
        loaded.Append(ProfileName(loaded_profile));
      }
    }
    return std::move(done).Run(
        true, base::Value(base::WriteJson(base::DictValue().Set(
                                              "profiles", std::move(loaded)))
                              .value_or("{}")));
  }
  const auto* route = ardia::desktop_routes::FindRoute(name);
  EngineFunction call =
      route ? reinterpret_cast<EngineFunction>(
                  dlsym(EngineImage() ? EngineImage() : RTLD_DEFAULT,
                        std::string(route->service).c_str()))
            : nullptr;
  if (!call) {
    NoteUnhandled("engine.call " + name);
    return std::move(done).Run(
        false, Failure("ERR_UNKNOWN_CALL",
                       "This engine call is not in the Mac WebUI shell"));
  }
  std::string json = args && args->is_string() ? args->GetString() : "{}";
  struct Pending {
    Done done;
    std::string field;
  };
  WithProfile(
      profile,
      base::BindOnce(
          [](EngineFunction call, std::string json, std::string field,
             Done done, Profile* resolved) {
            if (!resolved) {
              return std::move(done).Run(
                  false, Failure("ERR_PROFILE", "profile not loaded"));
            }
            const std::string path =
                resolved->GetOriginalProfile()->GetPath().value();
            auto* pending = new Pending{std::move(done), std::move(field)};
            call(
                path.c_str(), json.c_str(),
                [](void* context, const char* reply) {
                  std::unique_ptr<Pending> owned(static_cast<Pending*>(context));
                  std::optional<base::Value> value =
                      reply ? base::JSONReader::Read(reply, base::JSON_PARSE_RFC)
                            : std::nullopt;
                  if (!value) {
                    return std::move(owned->done).Run(
                        false, base::Value("The engine reply is not JSON"));
                  }
                  if (value->is_dict() && value->GetDict().Find("error")) {
                    return std::move(owned->done).Run(true, base::Value(reply));
                  }
                  if (owned->field == "null") {
                    value = base::Value();
                  } else if (!owned->field.empty()) {
                    const base::Value* field =
                        value->is_dict() ? value->GetDict().Find(owned->field)
                                         : nullptr;
                    value = field ? field->Clone() : base::Value();
                  }
                  std::move(owned->done)
                      .Run(true, base::Value(
                                     base::WriteJson(*value).value_or("null")));
                },
                pending);
          },
          call, std::move(json), std::string(route->field), std::move(done)));
}

}
