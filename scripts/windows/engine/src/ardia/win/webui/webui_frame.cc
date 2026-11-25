#include "ardia/win/webui/webui_frame.h"

#include <windows.h>

#include <cmath>
#include <memory>
#include <optional>
#include <utility>

#include "chrome/browser/ui/views/frame/browser_view.h"
#include "chrome/browser/ui/views/frame/browser_widget.h"
#include "ui/base/hit_test.h"
#include "ui/base/metadata/metadata_impl_macros.h"
#include "ui/base/win/hwnd_metrics.h"
#include "ui/display/win/screen_win.h"
#include "ui/gfx/geometry/insets.h"
#include "ui/views/view_utils.h"
#include "ui/views/widget/widget.h"
#include "ui/views/widget/widget_delegate.h"
#include "ui/views/win/hwnd_util.h"

namespace ardia_win::webui {

namespace {

bool IsSizingHit(WPARAM hit) {
  return hit == HTLEFT || hit == HTRIGHT || hit == HTTOP || hit == HTBOTTOM ||
         hit == HTTOPLEFT || hit == HTTOPRIGHT || hit == HTBOTTOMLEFT ||
         hit == HTBOTTOMRIGHT;
}

WPARAM SizeCommand(WPARAM hit) {
  switch (hit) {
    case HTLEFT:
      return SC_SIZE | WMSZ_LEFT;
    case HTRIGHT:
      return SC_SIZE | WMSZ_RIGHT;
    case HTTOP:
      return SC_SIZE | WMSZ_TOP;
    case HTBOTTOM:
      return SC_SIZE | WMSZ_BOTTOM;
    case HTTOPLEFT:
      return SC_SIZE | WMSZ_TOPLEFT;
    case HTTOPRIGHT:
      return SC_SIZE | WMSZ_TOPRIGHT;
    case HTBOTTOMLEFT:
      return SC_SIZE | WMSZ_BOTTOMLEFT;
    default:
      return SC_SIZE | WMSZ_BOTTOMRIGHT;
  }
}

const wchar_t* SizeCursor(WPARAM hit) {
  switch (hit) {
    case HTLEFT:
    case HTRIGHT:
      return IDC_SIZEWE;
    case HTTOP:
    case HTBOTTOM:
      return IDC_SIZENS;
    case HTTOPLEFT:
    case HTBOTTOMRIGHT:
      return IDC_SIZENWSE;
    default:
      return IDC_SIZENESW;
  }
}

bool ResetsMaximizeState(UINT message, WPARAM w_param) {
  return message == WM_NCMOUSELEAVE || message == WM_CAPTURECHANGED ||
         message == WM_CANCELMODE ||
         (message == WM_ACTIVATE && LOWORD(w_param) == WA_INACTIVE);
}

}

ShellBrowserFrameView::ShellBrowserFrameView(BrowserWidget* widget,
                                             BrowserView* browser_view)
    : BrowserFrameView(widget, browser_view) {}

ShellBrowserFrameView::~ShellBrowserFrameView() = default;

void ShellBrowserFrameView::SetMaximizeButton(std::optional<gfx::Rect> rect) {
  maximize_button_ = rect;
}

int ShellBrowserFrameView::GetTopInset(bool restored) const {
  return 0;
}

void ShellBrowserFrameView::UpdateThrobber(bool running) {}

gfx::Rect ShellBrowserFrameView::GetBoundsForClientView() const {
  return bounds();
}

gfx::Rect ShellBrowserFrameView::GetWindowBoundsForClientBounds(
    const gfx::Rect& client_bounds) const {
  return client_bounds;
}

int ShellBrowserFrameView::NonClientHitTest(const gfx::Point& point) {
  views::Widget* widget = GetWidget();
  if (!widget || !bounds().Contains(point)) {
    return HTNOWHERE;
  }
  if (widget->IsFullscreen()) {
    return HTCLIENT;
  }
  if (!widget->IsMaximized()) {
    const int top = TopResizeThickness();
    const int component = GetHTComponentForFrame(
        point, gfx::Insets::TLBR(top, 0, 0, 0), top, kResizeCornerWidth,
        widget->widget_delegate()->CanResize());
    if (component != HTNOWHERE) {
      return component;
    }
  }
  if (maximize_button_ && maximize_button_->Contains(point)) {
    return HTMAXBUTTON;
  }
  return HTCLIENT;
}

int ShellBrowserFrameView::TopResizeThickness() const {
  HWND hwnd = views::HWNDForWidget(GetWidget());
  if (!hwnd) {
    return 0;
  }
  const float scale = display::win::GetScreenWin()->GetScaleFactorForHWND(hwnd);
  return static_cast<int>(std::floor(
      ui::GetFrameThicknessFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) / scale));
}

BEGIN_METADATA(ShellBrowserFrameView)
END_METADATA

std::unique_ptr<BrowserFrameView> CreateShellFrameView(
    BrowserWidget* widget,
    BrowserView* browser_view) {
  return std::make_unique<ShellBrowserFrameView>(widget, browser_view);
}

ShellBrowserFrameView* ShellFrameOf(BrowserView* browser_view) {
  if (!browser_view || !browser_view->browser_widget()) {
    return nullptr;
  }
  return views::AsViewClass<ShellBrowserFrameView>(
      browser_view->browser_widget()->GetFrameView());
}

CaptionInput::CaptionInput(StateChanged changed,
                           base::RepeatingClosure toggle_maximize,
                           base::RepeatingCallback<bool()> intercept_close)
    : changed_(std::move(changed)),
      toggle_maximize_(std::move(toggle_maximize)),
      intercept_close_(std::move(intercept_close)) {}

CaptionInput::~CaptionInput() {
  Detach();
}

void CaptionInput::Attach(HWND root) {
  if (root_ == root) {
    return;
  }
  Detach();
  root_ = root;
  if (root_) {
    ui::HWNDSubclass::AddFilterToTarget(root_, this);
  }
}

void CaptionInput::Detach() {
  ui::HWNDSubclass::RemoveFilterFromAllTargets(this);
  root_ = nullptr;
  nc_leave_tracked_hwnd_ = nullptr;
  state_.Reset();
}

void CaptionInput::Reset() {
  nc_leave_tracked_hwnd_ = nullptr;
  if (state_.Reset()) {
    Emit();
  }
}

void CaptionInput::Emit() {
  if (changed_) {
    changed_.Run(state_.state());
  }
}

void CaptionInput::ArmNonClientLeave(HWND target) {
  if (!target || nc_leave_tracked_hwnd_ == target) {
    return;
  }
  TRACKMOUSEEVENT track{};
  track.cbSize = sizeof(track);
  track.dwFlags = TME_NONCLIENT | TME_LEAVE;
  track.hwndTrack = target;
  if (::TrackMouseEvent(&track)) {
    nc_leave_tracked_hwnd_ = target;
  }
}

bool CaptionInput::FilterMessage(HWND hwnd,
                                 UINT message,
                                 WPARAM w_param,
                                 LPARAM l_param,
                                 LRESULT* l_result) {
  if (hwnd != root_) {
    return false;
  }
  if (ResetsMaximizeState(message, w_param)) {
    Reset();
  }
  if (message == WM_CLOSE && intercept_close_ && intercept_close_.Run()) {
    *l_result = 0;
    return true;
  }
  return false;
}

bool CaptionInput::PreTranslate(const MSG& msg) {
  HWND root = root_;
  const bool ours = root && msg.hwnd && ::GetAncestor(msg.hwnd, GA_ROOT) == root;
  if (msg.message == WM_NCMOUSELEAVE &&
      (ours || msg.hwnd == nc_leave_tracked_hwnd_)) {
    nc_leave_tracked_hwnd_ = nullptr;
    if (state_.OnNcMouseLeave()) {
      Emit();
    }
    return false;
  }
  if (msg.message == WM_CAPTURECHANGED || msg.message == WM_CANCELMODE ||
      (msg.message == WM_ACTIVATE && LOWORD(msg.wParam) == WA_INACTIVE)) {
    if (ours) {
      Reset();
    }
    return false;
  }
  const bool button =
      msg.message == WM_LBUTTONDOWN || msg.message == WM_LBUTTONUP ||
      msg.message == WM_RBUTTONDOWN || msg.message == WM_RBUTTONUP ||
      msg.message == WM_MBUTTONDOWN || msg.message == WM_MBUTTONUP ||
      msg.message == WM_XBUTTONDOWN || msg.message == WM_XBUTTONUP ||
      msg.message == WM_NCLBUTTONDOWN || msg.message == WM_NCLBUTTONUP ||
      msg.message == WM_NCRBUTTONDOWN || msg.message == WM_NCRBUTTONUP ||
      msg.message == WM_NCMBUTTONDOWN || msg.message == WM_NCMBUTTONUP ||
      msg.message == WM_NCXBUTTONDOWN || msg.message == WM_NCXBUTTONUP;
  if (button && !(ours && msg.wParam == HTMAXBUTTON &&
                  (msg.message == WM_NCLBUTTONDOWN ||
                   msg.message == WM_NCLBUTTONUP))) {
    Reset();
  }
  if (!ours) {
    return false;
  }
  if (msg.message == WM_MOUSEMOVE || msg.message == WM_MOUSELEAVE) {
    Reset();
    return false;
  }
  const bool child = msg.hwnd != root;
  if (msg.message == WM_NCLBUTTONDOWN || msg.message == WM_NCLBUTTONDBLCLK) {
    if (msg.wParam == HTMAXBUTTON) {
      ArmNonClientLeave(msg.hwnd);
      maximize_pressed_at_ = msg.time;
      if (state_.OnNcLeftButtonDown(true)) {
        Emit();
      }
      return true;
    }
    if (child && IsSizingHit(msg.wParam)) {
      ::ReleaseCapture();
      ::SendMessageW(root, WM_SYSCOMMAND, SizeCommand(msg.wParam), msg.lParam);
      return true;
    }
    if (child && msg.wParam == HTCAPTION) {
      ::ReleaseCapture();
      ::SendMessageW(root,
                     msg.message == WM_NCLBUTTONDBLCLK ? WM_NCLBUTTONDBLCLK
                                                       : WM_SYSCOMMAND,
                     msg.message == WM_NCLBUTTONDBLCLK ? HTCAPTION
                                                       : (SC_MOVE | HTCAPTION),
                     msg.lParam);
      return true;
    }
    return false;
  }
  if (msg.message == WM_NCLBUTTONUP && msg.wParam == HTMAXBUTTON) {
    const bool was_pressed = state_.state().pressed;
    if (state_.OnNcLeftButtonUp(true)) {
      Emit();
    }
    if (was_pressed && msg.time - maximize_pressed_at_ <= kMaximizeClickLimitMs &&
        toggle_maximize_) {
      toggle_maximize_.Run();
    }
    return true;
  }
  if (msg.message == WM_NCMOUSEMOVE) {
    const bool on_max = msg.wParam == HTMAXBUTTON;
    if (on_max) {
      ArmNonClientLeave(msg.hwnd);
    }
    if (state_.OnNcMouseMove(on_max)) {
      Emit();
    }
    if (child && IsSizingHit(msg.wParam)) {
      ::SetCursor(::LoadCursorW(nullptr, SizeCursor(msg.wParam)));
    }
  }
  return false;
}

}
