#include <cmath>
#include <cstdlib>
#include <fstream>
#include <limits>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "ardia/mac/ac_mac_glass_layout.h"
#include "ardia/mac/ac_mac_menu_model.h"
#include "ardia/mac/ac_mac_popover_policy.h"
#include "ardia/mac/ac_mac_shell_policy.h"
#include "ardia/mac/ac_mac_webui_policy.h"
#include "ardia/mac/ac_mac_window_layout.h"
#include "check.h"
#include "launch_args.h"

namespace {

struct Corpus {
  std::vector<std::string> strings;
  std::vector<double> numbers;
};

int HexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  return -1;
}

const Corpus& Load() {
  static const Corpus corpus = [] {
    Corpus loaded;
    const char* path = std::getenv("ARDIA_HOSTILE_CORPUS");
    if (!path) return loaded;
    std::ifstream file(path);
    std::string line;
    while (std::getline(file, line)) {
      std::istringstream fields(line);
      std::string kind, id, value;
      fields >> kind >> id;
      std::getline(fields >> std::ws, value);
      if (kind == "s") {
        std::string bytes;
        for (std::size_t index = 0; index + 1 < value.size(); index += 2) {
          const int high = HexDigit(value[index]);
          const int low = HexDigit(value[index + 1]);
          if (high < 0 || low < 0) break;
          bytes.push_back(static_cast<char>(high * 16 + low));
        }
        loaded.strings.push_back(bytes);
        loaded.strings.push_back("x" + bytes);
        loaded.strings.push_back(bytes + "webui");
      } else if (kind == "n") {
        loaded.numbers.push_back(value == "NaN" ? std::numeric_limits<double>::quiet_NaN()
                                 : value == "Infinity" ? std::numeric_limits<double>::infinity()
                                                       : std::strtod(value.c_str(), nullptr));
      }
    }
    for (double extra : {-std::numeric_limits<double>::infinity(), 1e20, -1e20, 1e308, -0.0, 4.9e-324}) {
      loaded.numbers.push_back(extra);
    }
    return loaded;
  }();
  return corpus;
}

bool Charset(std::string_view text, std::string_view extra) {
  for (char c : text) {
    const bool alnum = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    if (!alnum && extra.find(c) == std::string_view::npos) return false;
  }
  return true;
}

bool NoControls(std::string_view text) {
  for (char c : text) {
    const auto byte = static_cast<unsigned char>(c);
    if (byte < 0x20 || byte == 0x7f) return false;
  }
  return true;
}

}

TEST(corpus_is_loaded) {
  CHECK(Load().strings.size() >= 300);
  CHECK(Load().numbers.size() >= 10);
}

TEST(glass_names_and_ids) {
  for (const std::string& text : Load().strings) {
    if (ardia_mac::glass::ValidId(text)) {
      CHECK(!text.empty() && text.size() <= ardia_mac::glass::kMaxIdLength && Charset(text, "-_:."));
    }
    if (const auto layer = ardia_mac::glass::LayerNamed(text)) {
      CHECK(text.empty() || text == "auto" || text == "behind" || text == "window" || text == "sidebar" ||
            text == "over_page" || text == "overPage" || text == "page");
    }
    if (ardia_mac::glass::MaterialNamed(text)) {
      CHECK(Charset(text, ""));
    }
    ardia_mac::glass::Region region;
    region.id = text;
    region.rect = {0, 0, 10, 10};
    const auto layout = ardia_mac::glass::Lay({region}, {}, {0, 0, 100, 100}, 1);
    for (const auto& placement : layout.placements) CHECK(ardia_mac::glass::ValidId(placement.id));
  }
  ardia_mac::glass::Region control;
  control.id = "control";
  control.rect = {0, 0, 10, 10};
  CHECK(ardia_mac::glass::Lay({control}, {}, {0, 0, 100, 100}, 1).placements.size() == 1);
}

TEST(glass_geometry) {
  for (double a : Load().numbers) {
    for (double b : Load().numbers) {
      ardia_mac::glass::Region region;
      region.id = "g";
      region.rect = {a, b, a, b};
      region.radii = {a, b, a, b};
      region.opacity = a;
      region.blur = b;
      const auto layout = ardia_mac::glass::Lay({region}, {{1, {a, b, 500, 500}}}, {0, 0, 1280, 800}, a);
      for (const auto& placement : layout.placements) {
        CHECK(std::isfinite(placement.frame.x) && std::isfinite(placement.frame.width));
        CHECK(placement.opacity >= 0 && placement.opacity <= 1 && std::isfinite(placement.radius));
      }
      const int narrowed = ardia_mac::glass::ClampToInt(a);
      CHECK(narrowed >= -1000000 && narrowed <= 1000000);
      if (const auto generation = ardia_mac::glass::PresentableGeneration(a)) CHECK(*generation >= 0 && *generation == a);
      const auto shape = ardia_mac::glass::ShapeFor({a, b, a, b});
      CHECK(std::isfinite(shape.radii.upper_left) && shape.radii.upper_left >= 0);
      CHECK(std::isfinite(ardia_mac::glass::NativeCornerRadius(shape)));
    }
  }
}

TEST(popover_guards) {
  for (const std::string& text : Load().strings) {
    if (ardia_mac::popover::ValidId(text)) CHECK(text.size() <= 128 && Charset(text, "-_"));
    if (ardia_mac::popover::ValidRoute(text)) {
      CHECK(text.find("..") == std::string::npos && text.front() != '/' && Charset(text, "-_/."));
    }
    if (const auto reason = ardia_mac::popover::ReasonNamed(text)) CHECK(Charset(text, ""));
    if (const auto edge = ardia_mac::popover::EdgeNamed(text)) CHECK(Charset(text, ""));
  }
  for (double a : Load().numbers) {
    for (double b : Load().numbers) {
      const ardia_mac::popover::Rect hostile{a, b, a, b};
      if (const auto mapped = ardia_mac::popover::WindowToScreen(hostile, {0, 0, 1280, 800}, b)) {
        CHECK(std::isfinite(mapped->x) && std::isfinite(mapped->height));
      }
      if (const auto clamped = ardia_mac::popover::ClampToScreen(hostile, hostile, {{0, 25, 1440, 875}}, a > 0,
                                                                 {0, 0, 1280, 800})) {
        CHECK(clamped->frame.x >= 0 && clamped->frame.right() <= 1440 + 0.5);
      }
    }
  }
  CHECK(ardia_mac::popover::ValidRoute("downloads") && ardia_mac::popover::ValidId("popover-main-1"));
}

TEST(menu_construction) {
  for (const std::string& text : Load().strings) {
    ardia_mac::menu::Item root;
    ardia_mac::menu::Item item;
    item.title = text;
    item.command = text;
    item.key = text;
    item.argument = text;
    root.children.push_back(item);
    if (ardia_mac::menu::Validate(root).empty()) {
      CHECK(text.size() <= ardia_mac::menu::kMaxCommand && NoControls(text) && Charset(text, "._-:"));
      CHECK(ardia_mac::menu::ValidKey(text));
    }
    CHECK(!ardia_mac::menu::RoleNamed(text) || Charset(text, ""));
    ardia_mac::menu::Describe(root);
  }
  ardia_mac::menu::Item control;
  ardia_mac::menu::Item open;
  open.title = "Open";
  open.command = "open";
  open.key = "o";
  control.children.push_back(open);
  CHECK(ardia_mac::menu::Validate(control).empty());
}

TEST(window_guards) {
  for (double a : Load().numbers) {
    for (double b : Load().numbers) {
      if (const auto lights = ardia_mac::window::LightsFrom(a, b, false, {1280, 800})) {
        CHECK(lights->center.x >= 0 && lights->center.x <= 1280 && lights->center.y >= 0 && lights->center.y <= 800);
        const auto zoom = ardia_mac::window::ButtonOrigin(*lights, {14, 14}, 800, 2);
        CHECK(zoom.x + ardia_mac::window::kButtonSide <= 1280);
      }
    }
  }
  for (const std::string& text : Load().strings) {
    const auto action = ardia_mac::window::CaptionActionFor(text, std::nullopt, false);
    if (action == ardia_mac::window::CaptionAction::kMinimize) CHECK(text == "Minimize");
    if (action == ardia_mac::window::CaptionAction::kNone) CHECK(text == "None");
    CHECK(ardia_mac::window::CaptionActionFor(text, true, true) == ardia_mac::window::CaptionAction::kNone);
  }
  CHECK(ardia_mac::window::LightsFrom(25, 20, false, {1280, 800}).has_value());
}

TEST(bridge_documents) {
  for (const std::string& text : Load().strings) {
    if (ardia_mac::shell_policy::ValidDocumentName(text)) {
      CHECK(text.size() <= 200 && text.front() != '.' && Charset(text, "._-"));
      CHECK(!ardia_mac::shell_policy::EqualsIgnoringAsciiCase(text, "session.json"));
    }
  }
  CHECK(ardia_mac::shell_policy::ValidDocumentName("notes.json"));
  for (const std::string& text : Load().strings) {
    if (const auto id = ardia_mac::shell_policy::ParseAdoptId(text)) {
      CHECK(*id > 0 && text == "tab:" + std::to_string(*id));
    }
    if (ardia_mac::shell_policy::ClassifyAdoptField(true, true, text) == ardia_mac::shell_policy::AdoptField::kId) {
      CHECK(text.starts_with("tab:") && Charset(text.substr(4), ""));
    }
  }
  CHECK(ardia_mac::shell_policy::ParseAdoptId("tab:12") == 12);
}

TEST(launch_environment) {
  for (const std::string& text : Load().strings) {
    namespace policy = ardia_mac::webui_policy;
    if (policy::Active(policy::Decide(policy::Build::kDevelopment, text, text))) CHECK(text == "webui");
    CHECK(!policy::Active(policy::Decide(policy::Build::kRelease, text, text)));
    if (policy::Background(false, text)) CHECK(text == "1" || text == "true");
    ArdiaLaunchStorage storage;
    const char* argv[] = {"Ardia"};
    const char* out[1 + kArdiaLaunchExtraArgs + 1] = {};
    const int count = ArdiaBuildLaunchArgs(1, argv, text.c_str(), text.c_str(), &storage, out);
    CHECK(count >= 1 && count <= 1 + kArdiaLaunchExtraArgs);
    for (int index = 1; index < count; ++index) {
      const std::string_view arg = out[index];
      CHECK(arg.starts_with("--user-data-dir=") || arg.starts_with("--ardia-data-dir=") ||
            arg == "--use-mock-keychain" || arg == "--ardia-shell=webui" || arg == "--ardia-background");
      CHECK(arg.size() < kArdiaLaunchPathLimit + 32);
    }
  }
  CHECK(ardia_mac::webui_policy::Active(
      ardia_mac::webui_policy::Decide(ardia_mac::webui_policy::Build::kDevelopment, "webui", std::nullopt)));
}

int main(int argc, char** argv) {
  return ardia_mac_test::RunAll(argc, argv);
}
