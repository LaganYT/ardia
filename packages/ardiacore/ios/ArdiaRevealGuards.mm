#import "ArdiaWebViewInternal.h"
#import "ArdiaRuntime.h"

#import <objc/runtime.h>

using namespace ardia_runtime;

namespace {

BOOL Refused(id target) {
  return [ArdiaWebView refusesInputAheadOfSwitch:target];
}

BOOL ChangesThePage(SEL selector) {
  NSString *name = NSStringFromSelector(selector);
  return [name hasPrefix:@"accessibilityPerform"] || [name hasPrefix:@"setAccessibility"] || [name isEqualToString:@"accessibilitySetValue:forAttribute:"];
}

id GuardedCall(SEL selector, IMP original, NSMethodSignature *signature) {
  const char result = signature.methodReturnType[0];
  const BOOL answers = result == 'B' || result == 'c';
  if (!answers && result != 'v') return nil;
  const NSUInteger count = signature.numberOfArguments - 2;
  NSString *first = count > 0 ? @([signature getArgumentTypeAtIndex:2]) : @"";
  NSString *second = count > 1 ? @([signature getArgumentTypeAtIndex:3]) : @"";
  if (count == 0 && answers) return ^BOOL(id element) { return !Refused(element) && ((BOOL (*)(id, SEL))original)(element, selector); };
  if (count == 0) return ^(id element) { if (!Refused(element)) ((void (*)(id, SEL))original)(element, selector); };
  if (answers) return nil;
  if (count == 1 && [first isEqualToString:@"@"]) return ^(id element, id value) { if (!Refused(element)) ((void (*)(id, SEL, id))original)(element, selector, value); };
  if (count == 1 && ([first isEqualToString:@"B"] || [first isEqualToString:@"c"])) return ^(id element, BOOL value) { if (!Refused(element)) ((void (*)(id, SEL, BOOL))original)(element, selector, value); };
  if (count == 1 && [first hasPrefix:@"{_NSRange="]) return ^(id element, NSRange value) { if (!Refused(element)) ((void (*)(id, SEL, NSRange))original)(element, selector, value); };
  if (count == 2 && [first isEqualToString:@"@"] && [second isEqualToString:@"@"])
    return ^(id element, id value, id name) { if (!Refused(element)) ((void (*)(id, SEL, id, id))original)(element, selector, value, name); };
  return nil;
}

NSUInteger GuardAccessibilityOf(Class cls) {
  NSUInteger guarded = 0;
  unsigned int count = 0;
  Method *methods = cls ? class_copyMethodList(cls, &count) : nullptr;
  for (unsigned int i = 0; i < count; i++) {
    const SEL selector = method_getName(methods[i]);
    const char *types = method_getTypeEncoding(methods[i]);
    if (!ChangesThePage(selector) || !types) continue;
    id guard = GuardedCall(selector, method_getImplementation(methods[i]), [NSMethodSignature signatureWithObjCTypes:types]);
    if (!guard) continue;
    method_setImplementation(methods[i], imp_implementationWithBlock(guard));
    guarded++;
  }
  free(methods);
  return guarded;
}

NSUInteger gGuardedAccessibility = 0;

}

@implementation ArdiaWebView (RevealGuards)

+ (NSUInteger)guardedAccessibilityCalls {
  return gGuardedAccessibility;
}

+ (void)installRevealGuards {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    Class app = NSApp.class;
    const SEL resolve = @selector(targetForAction:to:from:);
    static IMP resolveUnguarded;
    ReplaceMethod(app, resolve, ^id(IMP original) {
      resolveUnguarded = original;
      return ^id(NSApplication *application, SEL action, id target, id sender) {
        id found = ((id (*)(id, SEL, SEL, id, id))original)(application, resolve, action, target, sender);
        return Refused(found) ? nil : found;
      };
    });
    const SEL send = @selector(sendAction:to:from:);
    ReplaceMethod(app, send, ^id(IMP original) {
      return ^BOOL(NSApplication *application, SEL action, id target, id sender) {
        if ([ArdiaWebView anyRevealGap]) {
          id found = target ?: (resolveUnguarded ? ((id (*)(id, SEL, SEL, id, id))resolveUnguarded)(application, resolve, action, nil, sender) : nil);
          if (Refused(found)) return NO;
        }
        return ((BOOL (*)(id, SEL, SEL, id, id))original)(application, send, action, target, sender);
      };
    });
    Class widget = NSClassFromString(@"RenderWidgetHostViewCocoa");
    const SEL requestor = @selector(validRequestorForSendType:returnType:);
    ReplaceMethod(widget, requestor, ^id(IMP original) {
      return ^id(NSView *page, NSPasteboardType sendType, NSPasteboardType returnType) {
        return Refused(page) ? nil : ((id (*)(id, SEL, id, id))original)(page, requestor, sendType, returnType);
      };
    });
    const SEL touchBar = @selector(makeTouchBar);
    ReplaceMethod(widget, touchBar, ^id(IMP original) {
      return ^id(NSView *page) {
        return Refused(page) ? nil : ((id (*)(id, SEL))original)(page, touchBar);
      };
    });
    const SEL focused = @selector(setAccessibilityFocused:);
    ReplaceMethod(widget, focused, ^id(IMP original) {
      return ^(NSView *page, BOOL isFocused) {
        if (!Refused(page)) ((void (*)(id, SEL, BOOL))original)(page, focused, isFocused);
      };
    });
    Class contents = NSClassFromString(@"WebContentsViewCocoa");
    for (NSString *name in @[ @"draggingEntered:", @"draggingUpdated:" ]) {
      const SEL drag = NSSelectorFromString(name);
      ReplaceMethod(contents, drag, ^id(IMP original) {
        return ^NSDragOperation(NSView *page, id info) {
          return Refused(page) ? NSDragOperationNone : ((NSDragOperation (*)(id, SEL, id))original)(page, drag, info);
        };
      });
    }
    const SEL drop = @selector(performDragOperation:);
    ReplaceMethod(contents, drop, ^id(IMP original) {
      return ^BOOL(NSView *page, id info) {
        return !Refused(page) && ((BOOL (*)(id, SEL, id))original)(page, drop, info);
      };
    });
    for (NSString *name in @[ @"BrowserAccessibilityCocoa", @"AXPlatformNodeCocoa" ]) gGuardedAccessibility += GuardAccessibilityOf(NSClassFromString(name));
  });
}

@end
