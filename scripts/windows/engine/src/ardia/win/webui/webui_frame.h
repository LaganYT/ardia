#ifndef ARDIA_WIN_WEBUI_WEBUI_FRAME_H_
#define ARDIA_WIN_WEBUI_WEBUI_FRAME_H_

#include <windows.h>

#include <memory>
#include <optional>

#include "ardia/win/webui/webui_policy.h"
#include "base/functional/callback.h"
#include "chrome/browser/ui/views/frame/browser_frame_view.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/base/win/hwnd_subclass.h"
#include "ui/gfx/geometry/rect.h"

class BrowserView;
class BrowserWidget;

namespace views {
class Widget;
}

namespace ardia_win::webui {

inline constexpr int kResizeCornerWidth = 16;
inline constexpr DWORD kMaximizeClickLimitMs = 5000;

class ShellBrowserFrameView : public BrowserFrameView {
  METADATA_HEADER(ShellBrowserFrameView, BrowserFrameView)

 public:
  ShellBrowserFrameView(BrowserWidget* widget, BrowserView* browser_view);
  ShellBrowserFrameView(const ShellBrowserFrameView&) = delete;
  ShellBrowserFrameView& operator=(const ShellBrowserFrameView&) = delete;
  ~ShellBrowserFrameView() override;

  void SetMaximizeButton(std::optional<gfx::Rect> rect);

  int GetTopInset(bool restored) const override;
  void UpdateThrobber(bool running) override;
  gfx::Rect GetBoundsForClientView() const override;
  gfx::Rect GetWindowBoundsForClientBounds(
      const gfx::Rect& client_bounds) const override;
  int NonClientHitTest(const gfx::Point& point) override;

 private:
  int TopResizeThickness() const;

  std::optional<gfx::Rect> maximize_button_;
};

std::unique_ptr<BrowserFrameView> CreateShellFrameView(
    BrowserWidget* widget,
    BrowserView* browser_view);

ShellBrowserFrameView* ShellFrameOf(BrowserView* browser_view);

class CaptionInput : public ui::HWNDMessageFilter {
 public:
  using StateChanged =
      base::RepeatingCallback<void(const MaximizeButtonVisualState&)>;

  CaptionInput(StateChanged changed,
               base::RepeatingClosure toggle_maximize,
               base::RepeatingCallback<bool()> intercept_close);
  CaptionInput(const CaptionInput&) = delete;
  CaptionInput& operator=(const CaptionInput&) = delete;
  ~CaptionInput() override;

  void Attach(HWND root);
  void Detach();
  void Reset();
  bool PreTranslate(const MSG& msg);
  HWND root() const { return root_; }

  bool FilterMessage(HWND hwnd,
                     UINT message,
                     WPARAM w_param,
                     LPARAM l_param,
                     LRESULT* l_result) override;

 private:
  void Emit();
  void ArmNonClientLeave(HWND target);

  HWND root_ = nullptr;
  HWND nc_leave_tracked_hwnd_ = nullptr;
  DWORD maximize_pressed_at_ = 0;
  MaximizeButtonStateMachine state_;
  StateChanged changed_;
  base::RepeatingClosure toggle_maximize_;
  base::RepeatingCallback<bool()> intercept_close_;
};

}

#endif
