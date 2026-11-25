#include "ardia/mac/ac_mac_menu.h"

#import <AppKit/AppKit.h>

#include <memory>
#include <utility>

#include "base/functional/bind.h"
#include "base/logging.h"
#include "base/no_destructor.h"
#include "base/strings/sys_string_conversions.h"
#include "base/task/current_thread.h"
#include "base/task/sequenced_task_runner.h"

@interface ArdiaMacMenuTarget : NSObject
@property(nonatomic, nullable) NSDictionary* chosen;
@property(nonatomic) BOOL forContextMenu;
- (void)perform:(NSMenuItem*)item;
@end

namespace ardia_mac {

namespace {

ArdiaMacMenuTarget* MainTarget() {
  static ArdiaMacMenuTarget* target = [[ArdiaMacMenuTarget alloc] init];
  return target;
}

MenuCommandHandler& MainHandler() {
  static base::NoDestructor<MenuCommandHandler> handler;
  return *handler;
}

std::string StringOf(const base::DictValue& dict, std::string_view key) {
  const std::string* found = dict.FindString(key);
  return found ? *found : std::string();
}

menu::Item ItemOf(const base::Value& value,
                  std::size_t depth,
                  std::vector<menu::Problem>& problems,
                  const std::string& path) {
  menu::Item item;
  const base::DictValue* dict = value.GetIfDict();
  if (!dict) {
    problems.push_back({path, "not an object"});
    return item;
  }
  item.title = StringOf(*dict, "title");
  item.command = StringOf(*dict, "command");
  item.key = StringOf(*dict, "key");
  if (const base::Value* argument = dict->Find("arg")) {
    if (argument->is_string()) {
      item.argument = argument->GetString();
    } else if (!argument->is_none()) {
      problems.push_back({path, "argument"});
    }
  }
  const std::optional<menu::Role> role = menu::RoleNamed(StringOf(*dict, "role"));
  if (!role) {
    problems.push_back({path, "role"});
  }
  item.role = role.value_or(menu::Role::kNone);
  if (dict->FindBool("separator").value_or(false)) {
    item.role = menu::Role::kSeparator;
  }
  item.enabled = dict->FindBool("enabled").value_or(true);
  item.checked = dict->FindBool("checked").value_or(false);
  const std::optional<int> modifiers = dict->FindInt("modifiers");
  if (modifiers && *modifiers >= 0) {
    item.modifiers = static_cast<std::uint32_t>(*modifiers);
  } else if (modifiers) {
    problems.push_back({path, "modifiers"});
  }
  if (const base::ListValue* children = dict->FindList("children")) {
    if (depth >= menu::kMaxDepth || children->size() > menu::kMaxItems) {
      problems.push_back({path, "too deep"});
      return item;
    }
    for (std::size_t index = 0; index < children->size(); ++index) {
      item.children.push_back(ItemOf((*children)[index], depth + 1, problems,
                                     path + "/" + std::to_string(index)));
    }
  }
  return item;
}

NSString* KeyEquivalent(const std::string& key) {
  if (key.empty()) return @"";
  if (key.size() == 1) {
    return [base::SysUTF8ToNSString(key) lowercaseString];
  }
  const auto character = [](unichar c) { return [NSString stringWithCharacters:&c length:1]; };
  if (key == "Enter") return @"\r";
  if (key == "Escape") return @"\e";
  if (key == "Backspace") return @"\b";
  if (key == "Tab") return @"\t";
  if (key == "Space") return @" ";
  if (key == "Delete") return character(NSDeleteFunctionKey);
  if (key == "Up") return character(NSUpArrowFunctionKey);
  if (key == "Down") return character(NSDownArrowFunctionKey);
  if (key == "Left") return character(NSLeftArrowFunctionKey);
  if (key == "Right") return character(NSRightArrowFunctionKey);
  if (key == "Home") return character(NSHomeFunctionKey);
  if (key == "End") return character(NSEndFunctionKey);
  if (key.size() >= 2 && key[0] == 'F') {
    const int number = std::atoi(key.c_str() + 1);
    if (number >= 1 && number <= 20) {
      return character(static_cast<unichar>(NSF1FunctionKey + number - 1));
    }
  }
  return @"";
}

NSEventModifierFlags Modifiers(std::uint32_t modifiers) {
  NSEventModifierFlags flags = 0;
  if (modifiers & menu::kShift) flags |= NSEventModifierFlagShift;
  if (modifiers & menu::kControl) flags |= NSEventModifierFlagControl;
  if (modifiers & menu::kOption) flags |= NSEventModifierFlagOption;
  if (modifiers & menu::kCommand) flags |= NSEventModifierFlagCommand;
  return flags;
}

NSMenu* BuildMenu(const menu::Item& item, ArdiaMacMenuTarget* target, bool app_menus);

NSMenuItem* BuildItem(const menu::Item& item, ArdiaMacMenuTarget* target, bool app_menus) {
  if (item.role == menu::Role::kSeparator) {
    return [NSMenuItem separatorItem];
  }
  NSMenuItem* entry = [[NSMenuItem alloc] initWithTitle:base::SysUTF8ToNSString(item.title)
                                                 action:nil
                                          keyEquivalent:KeyEquivalent(item.key)];
  entry.keyEquivalentModifierMask = item.key.empty() ? 0 : Modifiers(item.modifiers);
  entry.state = item.checked ? NSControlStateValueOn : NSControlStateValueOff;
  entry.enabled = item.enabled;
  if (!item.children.empty() || item.role == menu::Role::kServices ||
      item.role == menu::Role::kWindowMenu || item.role == menu::Role::kHelpMenu) {
    NSMenu* submenu = BuildMenu(item, target, app_menus);
    entry.submenu = submenu;
    if (menu::InstallsAppMenu(item.role, app_menus)) {
      if (item.role == menu::Role::kServices) NSApp.servicesMenu = submenu;
      if (item.role == menu::Role::kWindowMenu) NSApp.windowsMenu = submenu;
      if (item.role == menu::Role::kHelpMenu) NSApp.helpMenu = submenu;
    }
    return entry;
  }
  const std::string_view selector = menu::SelectorFor(item.role);
  if (!selector.empty()) {
    entry.action = NSSelectorFromString(base::SysUTF8ToNSString(std::string(selector)));
    entry.target = nil;
    return entry;
  }
  if (!item.command.empty()) {
    entry.action = @selector(perform:);
    entry.target = target;
    entry.representedObject = @{
      @"command" : base::SysUTF8ToNSString(item.command),
      @"arg" : base::SysUTF8ToNSString(item.argument),
    };
  }
  return entry;
}

NSMenu* BuildMenu(const menu::Item& item, ArdiaMacMenuTarget* target, bool app_menus) {
  NSMenu* built = [[NSMenu alloc] initWithTitle:base::SysUTF8ToNSString(item.title)];
  built.autoenablesItems = NO;
  for (const menu::Item& child : item.children) {
    [built addItem:BuildItem(child, target, app_menus)];
  }
  return built;
}

void LogMenu(const std::string& what, const menu::Item& root) {
  LOG(WARNING) << "Ardia Mac WebUI: " << what;
  for (const std::string& line : menu::Describe(root)) {
    LOG(WARNING) << "Ardia Mac WebUI:   " << line;
  }
}

}

ParsedMenu ParseMenu(const base::Value& spec) {
  ParsedMenu parsed;
  const base::ListValue* items = spec.GetIfList();
  if (!items) {
    if (const base::DictValue* dict = spec.GetIfDict()) {
      items = dict->FindList("items");
    }
  }
  if (!items) {
    parsed.problems.push_back({"", "items must be a list"});
    return parsed;
  }
  if (items->size() > menu::kMaxItems) {
    parsed.problems.push_back({"", "too many items"});
    return parsed;
  }
  for (std::size_t index = 0; index < items->size(); ++index) {
    parsed.root.children.push_back(
        ItemOf((*items)[index], 1, parsed.problems, "/" + std::to_string(index)));
  }
  std::vector<menu::Problem> more = menu::Validate(parsed.root);
  parsed.problems.insert(parsed.problems.end(), more.begin(), more.end());
  return parsed;
}

void InstallMainMenu(const menu::Item& root, MenuCommandHandler handler) {
  MainHandler() = std::move(handler);
  NSMenu* bar = [[NSMenu alloc] initWithTitle:@""];
  for (const menu::Item& top : root.children) {
    NSMenuItem* entry = BuildItem(top, MainTarget(), true);
    if (!entry.submenu) {
      entry.submenu = [[NSMenu alloc] initWithTitle:entry.title];
    }
    [bar addItem:entry];
  }
  NSApp.mainMenu = bar;
}

void InstallDefaultMainMenu(MenuCommandHandler handler) {
  NSString* name = NSRunningApplication.currentApplication.localizedName ?: @"Ardia";
  InstallMainMenu(menu::DefaultMainMenu(base::SysNSStringToUTF8(name)), std::move(handler));
}

void PopUpContextMenu(LiveMenuView live_view,
                      gfx::Point point,
                      NSMenu* built,
                      ArdiaMacMenuTarget* target,
                      ContextMenuDone done) {
  NSView* view = std::move(live_view).Run().GetNativeNSView();
  if (!view || !view.window) {
    std::move(done).Run(std::nullopt);
    return;
  }
  const NSPoint location =
      NSMakePoint(point.x(), view.isFlipped ? point.y() : NSHeight(view.bounds) - point.y());
  {
    base::CurrentThread::ScopedAllowApplicationTasksInNativeNestedLoop allow;
    [built popUpMenuPositioningItem:nil atLocation:location inView:view];
  }
  NSDictionary* chosen = target.chosen;
  if (!chosen) {
    std::move(done).Run(std::nullopt);
    return;
  }
  std::move(done).Run(MenuChoice{base::SysNSStringToUTF8(chosen[@"command"]),
                                 base::SysNSStringToUTF8(chosen[@"arg"])});
}

void ShowContextMenu(LiveMenuView live_view,
                     const gfx::Point& point,
                     const menu::Item& root,
                     bool background_instance,
                     ContextMenuDone done) {
  if (background_instance) {
    LogMenu("context menu (background, not shown)", root);
    std::move(done).Run(std::nullopt);
    return;
  }
  ArdiaMacMenuTarget* target = [[ArdiaMacMenuTarget alloc] init];
  target.forContextMenu = YES;
  NSMenu* built = BuildMenu(root, target, false);
  base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
      FROM_HERE, base::BindOnce(&PopUpContextMenu, std::move(live_view), point,
                                built, target, std::move(done)));
}

}

@implementation ArdiaMacMenuTarget

@synthesize chosen = _chosen;
@synthesize forContextMenu = _forContextMenu;

- (void)perform:(NSMenuItem*)item {
  NSDictionary* represented = item.representedObject;
  if (![represented isKindOfClass:NSDictionary.class]) {
    return;
  }
  if (self.forContextMenu) {
    self.chosen = represented;
    return;
  }
  const ardia_mac::MenuCommandHandler& handler = ardia_mac::MainHandler();
  if (handler) {
    handler.Run(ardia_mac::MenuChoice{base::SysNSStringToUTF8(represented[@"command"]),
                                      base::SysNSStringToUTF8(represented[@"arg"])});
  }
}

@end
