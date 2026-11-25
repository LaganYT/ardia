#ifndef ARDIA_MAC_AC_MAC_GLASS_H_
#define ARDIA_MAC_AC_MAC_GLASS_H_

#include <memory>
#include <vector>

#include "ardia/mac/ac_mac_glass_layout.h"
#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/memory/weak_ptr.h"
#include "base/values.h"
#include "ui/gfx/native_ui_types.h"

namespace views {
class Widget;
}

namespace ardia_mac {

struct GlassPage {
  glass::Page page;
  gfx::NativeView view;
};

bool LiquidGlassAvailable();

class GlassRegions {
 public:
  using Presented = base::RepeatingCallback<void(int generation)>;

  GlassRegions(views::Widget* widget, Presented presented);
  GlassRegions(const GlassRegions&) = delete;
  GlassRegions& operator=(const GlassRegions&) = delete;
  ~GlassRegions();

  base::Value Apply(const base::DictValue& args, double shell_zoom);
  base::Value ApplyBackdrops(const base::DictValue& args, double shell_zoom);
  void SetSurface(const glass::Rect& shell_in_window,
                  std::vector<GlassPage> pages);
  void Clear();

 private:
  struct Views;

  glass::Layout Relayout();
  void EmitPresented(glass::PresentedGate::Ticket ticket);

  raw_ptr<views::Widget> widget_;
  std::unique_ptr<Views> views_;
  std::vector<glass::Region> regions_;
  std::vector<glass::Region> backdrops_;
  std::vector<glass::Placement> placed_;
  std::vector<GlassPage> pages_;
  glass::Rect shell_;
  double zoom_ = 1;
  Presented presented_;
  glass::PresentedGate gate_;
  base::WeakPtrFactory<GlassRegions> weak_factory_{this};
};

}

#endif
