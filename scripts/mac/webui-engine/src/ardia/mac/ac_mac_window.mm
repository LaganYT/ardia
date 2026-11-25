#include "ardia/mac/ac_mac_window.h"

#import <AppKit/AppKit.h>
#import <objc/runtime.h>

#include "third_party/skia/include/core/SkColor.h"
#include "ui/compositor/compositor.h"
#include "ui/compositor/layer.h"
#include "ui/views/view.h"
#include "ui/views/widget/widget.h"

@interface ArdiaMacTitlebarMetrics : NSObject
@property(nonatomic) CGFloat minXInset;
@property(nonatomic) CGFloat height;
@end

@implementation ArdiaMacTitlebarMetrics
@synthesize minXInset = _minXInset;
@synthesize height = _height;
@end

namespace ardia_mac {

namespace {

const void* const kMetricsKey = &kMetricsKey;

ArdiaMacTitlebarMetrics* MetricsOf(NSView* frame) {
  return objc_getAssociatedObject(frame.window, kMetricsKey);
}

void Override(Class frame_class, SEL selector, CGFloat (^pick)(ArdiaMacTitlebarMetrics*)) {
  Method method = class_getInstanceMethod(frame_class, selector);
  if (!method) {
    return;
  }
  using Getter = CGFloat (*)(id, SEL);
  const Getter standard = reinterpret_cast<Getter>(method_getImplementation(method));
  const IMP replacement = imp_implementationWithBlock(^CGFloat(NSView* frame) {
    ArdiaMacTitlebarMetrics* metrics = MetricsOf(frame);
    if (!metrics || (frame.window.styleMask & NSWindowStyleMaskFullScreen)) {
      return standard(frame, selector);
    }
    return pick(metrics);
  });
  if (!class_addMethod(frame_class, selector, replacement, method_getTypeEncoding(method))) {
    method_setImplementation(method, replacement);
  }
}

void InstallMetricsOverrides(Class frame_class) {
  static NSMutableSet<Class>* installed = [NSMutableSet set];
  if (!frame_class || [installed containsObject:frame_class]) {
    return;
  }
  [installed addObject:frame_class];
  Override(frame_class, NSSelectorFromString(@"_titlebarHeight"),
           ^CGFloat(ArdiaMacTitlebarMetrics* metrics) {
             return metrics.height;
           });
  Override(frame_class, NSSelectorFromString(@"_minXTitlebarWidgetInset"),
           ^CGFloat(ArdiaMacTitlebarMetrics* metrics) {
             return metrics.minXInset;
           });
}

}

void ApplyShellWindowStyle(views::Widget* widget) {
  NSWindow* ns_window = widget ? widget->GetNativeWindow().GetNativeNSWindow() : nil;
  if (!ns_window) {
    return;
  }
  const window::Translucency style = window::TranslucencyFor(true);
  ns_window.opaque = style.opaque;
  if (style.clear_background) {
    ns_window.backgroundColor = NSColor.clearColor;
  }
  if (style.full_size_content) {
    ns_window.styleMask |= NSWindowStyleMaskFullSizeContentView;
  }
  ns_window.titlebarAppearsTransparent = style.transparent_titlebar;
  if (style.hide_title) {
    ns_window.titleVisibility = NSWindowTitleHidden;
  }
  if (ui::Compositor* compositor = widget->GetCompositor()) {
    compositor->SetBackgroundColor(SK_ColorTRANSPARENT);
  }
  if (ui::Layer* layer = widget->GetLayer()) {
    layer->SetFillsBoundsOpaquely(false);
  }
  if (views::View* root = widget->GetRootView()) {
    root->SetBackground(nullptr);
  }
  NSView* content = ns_window.contentView;
  content.wantsLayer = YES;
  content.layer.backgroundColor = NSColor.clearColor.CGColor;
  content.layer.opaque = NO;
  ns_window.hasShadow = YES;
  [ns_window invalidateShadow];
}

void SetTrafficLights(views::Widget* widget, const window::Lights& lights) {
  NSWindow* ns_window = widget ? widget->GetNativeWindow().GetNativeNSWindow() : nil;
  NSView* frame = ns_window.contentView.superview;
  if (!ns_window || !frame) {
    return;
  }
  InstallMetricsOverrides(frame.class);
  NSButton* close = [ns_window standardWindowButton:NSWindowCloseButton];
  const NSSize size = close ? close.frame.size : NSMakeSize(window::kButtonSide, window::kButtonSide);
  const window::TitlebarMetrics metrics =
      window::TitlebarFor(lights, window::Size{size.width, size.height});
  ArdiaMacTitlebarMetrics* stored = [[ArdiaMacTitlebarMetrics alloc] init];
  stored.minXInset = metrics.min_x_inset;
  stored.height = metrics.height;
  objc_setAssociatedObject(ns_window, kMetricsKey, stored, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  for (NSWindowButton kind : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton}) {
    [ns_window standardWindowButton:kind].hidden = lights.hidden;
  }
  frame.needsLayout = YES;
  [frame layoutSubtreeIfNeeded];
}

}
