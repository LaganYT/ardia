#ifndef ARDIA_MAC_AC_MAC_SHELL_HOST_H_
#define ARDIA_MAC_AC_MAC_SHELL_HOST_H_

#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/scoped_observation.h"
#include "base/values.h"
#include "ardia/mac/ac_mac_glass_layout.h"
#include "ardia/mac/ac_mac_menu.h"
#include "ardia/mac/ac_mac_shell_policy.h"
#include "chrome/browser/ui/tabs/tab_strip_model_observer.h"
#include "content/public/browser/weak_document_ptr.h"
#include "content/public/browser/web_contents_delegate.h"
#include "content/public/browser/web_contents_observer.h"
#include "ui/base/accelerators/accelerator.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/gfx/geometry/point.h"
#include "ui/gfx/geometry/rect.h"
#include "ui/gfx/native_ui_types.h"
#include "ui/views/controls/webview/unhandled_keyboard_event_handler.h"
#include "ui/views/view.h"
#include "ui/views/view_observer.h"

class BrowserView;
class BrowserWindowInterface;
class GURL;
class Profile;

namespace content {
class WebContents;
class WebUI;
}

namespace views {
class FocusManager;
class WebView;
}

namespace ardia_mac {

class GlassRegions;
class PopoverHost;
class ShellBridge;
class ShellHostView;

std::string Text(const base::DictValue& value, std::string_view key);
const base::ListValue* Arguments(const base::DictValue& value);
base::Value Failure(std::string_view code, std::string_view message);
std::optional<gfx::Rect> RectFrom(const base::DictValue* rect);
std::optional<glass::Rect> GlassRectFrom(const base::DictValue* rect);
std::optional<GURL> AllowedPageUrl(const std::string& requested);
int TabId(const content::WebContents* contents);
void WithProfile(std::string_view name,
                 base::OnceCallback<void(Profile*)> callback);
std::string ProfileName(const Profile* profile);
base::FilePath DataDirectory();
base::FilePath AssetDirectory();
std::vector<ShellHostView*>& Hosts();
ShellHostView* HostForShell(content::WebContents* contents);
ShellHostView* HostForPopover(content::WebContents* contents);
MenuCommandHandler MainMenuHandler();
bool BackgroundInstance();
std::optional<std::string> BootstrapScript(const std::string& bootstrap_json,
                                           const char* host_bootstrap);
void Trace(const std::string& line);

class PageBinding : public content::WebContentsObserver {
 public:
  PageBinding(ShellHostView* owner,
              content::WebContents* contents,
              std::string key,
              std::string profile);
  PageBinding(const PageBinding&) = delete;
  PageBinding& operator=(const PageBinding&) = delete;
  ~PageBinding() override;

  int id() const { return id_; }
  const std::string& key() const { return key_; }
  const std::string& profile() const { return profile_; }
  content::WebContents* contents() const { return web_contents(); }

  std::string claim;
  uint64_t renderer_generation = 0;
  uint64_t sequence = 1;
  raw_ptr<views::WebView> viewport = nullptr;
  bool visible = false;
  bool presented = false;

  base::DictValue NavigationEvent() const;
  base::DictValue Envelope(std::string_view type);
  void ReportNavigation();
  void ReportClosed();

 private:
  void DidFinishNavigation(content::NavigationHandle* handle) override;
  void TitleWasSet(content::NavigationEntry* entry) override;
  void DidStartLoading() override;
  void DidStopLoading() override;
  void WebContentsDestroyed() override;

  raw_ptr<ShellHostView> owner_;
  int id_ = 0;
  std::string key_;
  std::string profile_;
};

class ShellHostView : public views::View,
                      public views::ViewObserver,
                      public TabStripModelObserver,
                      public content::WebContentsDelegate {
  METADATA_HEADER(ShellHostView, views::View)

 public:
  using Done = base::OnceCallback<void(bool, base::Value)>;

  ShellHostView(BrowserWindowInterface* browser,
                BrowserView* browser_view,
                Profile* app_profile,
                std::string window_id);
  ShellHostView(const ShellHostView&) = delete;
  ShellHostView& operator=(const ShellHostView&) = delete;
  ~ShellHostView() override;

  void Initialize();
  void DetachBrowser();

  const std::string& window_id() const { return window_id_; }
  BrowserWindowInterface* browser() const { return browser_; }
  Profile* app_profile() const { return app_profile_; }
  content::WebContents* shell_contents() const;
  base::WeakPtr<ShellHostView> GetWeakPtr() {
    return weak_factory_.GetWeakPtr();
  }

  std::vector<BrowserWindowInterface*> Members() const;
  BrowserWindowInterface* OwnerOf(const content::WebContents* contents) const;
  bool OwnsCompanion(const BrowserWindowInterface* browser) const;
  PageBinding* BindingForKey(std::string_view key) const;
  PageBinding* BindingForContents(const content::WebContents* contents) const;

  bool Trusted(content::WebUI* ui) const;
  uint64_t SetHandler(ShellBridge* handler, content::WebUI* ui);
  bool OwnsHandler(const ShellBridge* handler, uint64_t generation) const;
  void ClearHandler(ShellBridge* handler);
  void DeliverReply(base::WeakPtr<ShellBridge> handler,
                    uint64_t generation,
                    std::string id,
                    bool success,
                    base::Value response);
  void Emit(std::string_view module, std::string_view event, base::Value payload);
  void NoteRequest(base::WeakPtr<ShellBridge> handler, uint64_t generation);

  std::string BootstrapJson() const;
  std::optional<std::string> PopoverBootstrapJson(
      const content::WebContents* contents) const;
  PopoverHost* popovers() const { return popovers_.get(); }
  void EmitShellEvent(std::string_view name, base::Value data);
  void OnMenuCommand(const std::string& command, const std::string& argument);
  void Invoke(const std::string& method, const base::DictValue& args, Done done);
  void EngineCall(const std::string& name,
                  const std::string& profile,
                  const base::Value* args,
                  Done done);

  void BindingGone(PageBinding* binding);
  BrowserWindowInterface* EnsureMember(Profile* profile);
  bool OwnsShellNativeView(gfx::NativeView view) const;
  bool PassesShellPoint(double x, double y) const;
  gfx::NativeView LiveShellView(const content::WeakDocumentPtr& document,
                                uint64_t generation) const;
  void Note(const std::string& line) const;

  bool AcceleratorPressed(const ui::Accelerator& accelerator) override;
  bool CanHandleAccelerators() const override;
  bool HandleKeyboardEvent(content::WebContents* source,
                           const input::NativeWebKeyboardEvent& event) override;

 private:
  friend class PageBinding;

  void LayoutOverlay();
  void Restack();
  void ReattachViewports();
  void FocusShell();
  void RetireRenderer();
  void NoteUnhandled(const std::string& method);
  void CloseCompanions();

  PageBinding* ClaimedBinding(const base::DictValue& args) const;
  void CreateTab(const base::DictValue& args, Done done);
  void CreateTabIn(base::DictValue args,
                   Done done,
                   base::WeakPtr<ShellBridge> origin,
                   uint64_t generation,
                   Profile* profile);
  base::DictValue Identity(PageBinding* binding) const;
  void SetViewport(const base::DictValue& args, Done done);
  void SetPresentations(const base::DictValue& args, Done done);
  void TabCommand(const base::DictValue& args, Done done);
  void ReleaseTab(const base::DictValue& args, Done done);
  void CloseTab(const base::DictValue& args, Done done);
  void CloseContents(content::WebContents* contents) override;
  void SetInputRegions(const base::DictValue& args, Done done);
  void SetKeyboardShortcuts(const base::ListValue* values, Done done);
  void SetGlassRegions(const base::DictValue& args, Done done);
  void SetBackdropRegions(const base::DictValue& args, Done done);
  void UpdateGlassSurface();
  double ShellZoom() const;
  void PopoverCall(const std::string& method, const base::DictValue& args, Done done);
  void SetMainMenu(const base::DictValue& args, Done done);
  void ShowShellContextMenu(const base::DictValue& args, Done done);
  void SetTrafficLights(const base::DictValue& args, Done done);
  void StartWindowMove(Done done);
  void CaptionDoubleClick(Done done);
  void WatchWindowDrag();
  void StopWatchingWindowDrag();
  void NoteUnclaimedTab(content::WebContents* contents, bool active);
  void AnnounceUnclaimedTab(int id, int tries);
  base::DictValue OfferTab(content::WebContents* contents, bool active);
  void ListUnclaimedTabs(Done done);
  bool BindsContents(const content::WebContents* contents) const;
  content::WebContents* MemberTab(int id, Profile* profile) const;

  void OnViewBoundsChanged(views::View* observed_view) override;
  void OnViewIsDeleting(views::View* observed_view) override;
  void OnTabStripModelChanged(TabStripModel* tab_strip_model,
                              const TabStripModelChange& change,
                              const TabStripSelectionChange& selection) override;

  raw_ptr<BrowserWindowInterface> browser_;
  raw_ptr<BrowserView> browser_view_;
  raw_ptr<Profile> app_profile_;
  std::string window_id_;
  bool closing_ = false;
  bool painted_ = false;
  std::vector<base::WeakPtr<BrowserWindowInterface>> companions_;

  raw_ptr<views::WebView> shell_ = nullptr;
  std::vector<glass::Rect> pass_;
  std::map<int, std::unique_ptr<PageBinding>> bindings_;
  std::unique_ptr<GlassRegions> glass_;
  std::unique_ptr<PopoverHost> popovers_;
  struct WindowDrag;
  std::unique_ptr<WindowDrag> drag_;
  struct PendingTab {
    base::WeakPtr<content::WebContents> contents;
    bool active = false;
  };
  std::map<int, PendingTab> unclaimed_;
  shell_policy::OfferBook<base::WeakPtr<content::WebContents>> offered_;
  std::optional<uint64_t> unclaimed_listener_;

  raw_ptr<ShellBridge> handler_ = nullptr;
  content::WeakDocumentPtr renderer_document_;
  uint64_t renderer_generation_ = 1;
  base::WeakPtr<ShellBridge> request_handler_;
  uint64_t request_generation_ = 0;

  raw_ptr<views::FocusManager> focus_manager_ = nullptr;
  std::map<ui::Accelerator, base::DictValue> shortcuts_;
  views::UnhandledKeyboardEventHandler unhandled_keys_;
  std::vector<std::string> unhandled_;

  base::ScopedObservation<views::View, views::ViewObserver> view_observation_{
      this};
  base::WeakPtrFactory<ShellHostView> weak_factory_{this};
};

}

#endif
