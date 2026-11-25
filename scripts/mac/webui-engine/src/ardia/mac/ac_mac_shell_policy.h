#ifndef ARDIA_MAC_AC_MAC_SHELL_POLICY_H_
#define ARDIA_MAC_AC_MAC_SHELL_POLICY_H_

#include <algorithm>
#include <cstddef>
#include <utility>
#include <limits>
#include <map>
#include <optional>
#include <string_view>

namespace ardia_mac::shell_policy {

inline constexpr std::size_t kSessionLimit = 64 * 1024 * 1024;
inline constexpr std::size_t kDocumentNameLimit = 200;
inline constexpr std::string_view kSessionFile = "session.json";

inline char LowerAscii(char c) {
  return c >= 'A' && c <= 'Z' ? static_cast<char>(c - 'A' + 'a') : c;
}

inline bool EqualsIgnoringAsciiCase(std::string_view a, std::string_view b) {
  return a.size() == b.size() &&
         std::equal(a.begin(), a.end(), b.begin(), [](char x, char y) { return LowerAscii(x) == LowerAscii(y); });
}

inline bool ValidDocumentName(std::string_view name) {
  if (name.empty() || name.size() > kDocumentNameLimit || name.front() == '.') return false;
  const bool charset = std::all_of(name.begin(), name.end(), [](char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' ||
           c == '-';
  });
  return charset && !EqualsIgnoringAsciiCase(name, kSessionFile);
}

inline bool SessionFits(std::size_t serialized_bytes) {
  return serialized_bytes <= kSessionLimit;
}

inline std::optional<int> ParseAdoptId(std::string_view adopt) {
  constexpr std::string_view prefix = "tab:";
  if (!adopt.starts_with(prefix) || adopt.size() == prefix.size() || adopt.size() > prefix.size() + 10) {
    return std::nullopt;
  }
  long long value = 0;
  for (char c : adopt.substr(prefix.size())) {
    if (c < '0' || c > '9') return std::nullopt;
    value = value * 10 + (c - '0');
  }
  if (value <= 0 || value > std::numeric_limits<int>::max()) return std::nullopt;
  return static_cast<int>(value);
}

inline constexpr int kUnclaimedTries = 40;

enum class UnclaimedStep { kWait, kPark, kDrop, kReport };

inline UnclaimedStep NextUnclaimedStep(bool in_window, bool claimed, bool listening, bool blank_url, int tries) {
  if (claimed) return UnclaimedStep::kDrop;
  if (!in_window) return tries < kUnclaimedTries ? UnclaimedStep::kWait : UnclaimedStep::kDrop;
  if (!listening) return UnclaimedStep::kPark;
  if (blank_url && tries < kUnclaimedTries) return UnclaimedStep::kWait;
  return UnclaimedStep::kReport;
}

enum class AdoptRefusal { kNone, kMalformed, kNotOffered, kOtherProfile, kGone, kAlreadyClaimed };

inline AdoptRefusal CheckAdoption(bool parsed, bool offered, bool same_profile, bool present, bool bound) {
  if (!parsed) return AdoptRefusal::kMalformed;
  if (!offered) return AdoptRefusal::kNotOffered;
  if (!same_profile) return AdoptRefusal::kOtherProfile;
  if (!present) return AdoptRefusal::kGone;
  if (bound) return AdoptRefusal::kAlreadyClaimed;
  return AdoptRefusal::kNone;
}

template <typename Handle>
class OfferBook {
 public:
  struct Offer {
    Handle handle;
    bool active = false;
  };

  void Add(int id, Handle handle, bool active) { offers_[id] = Offer{std::move(handle), active}; }
  void Forget(int id) { offers_.erase(id); }
  const Offer* Find(int id) const {
    const auto found = offers_.find(id);
    return found == offers_.end() ? nullptr : &found->second;
  }
  template <typename Keep>
  void Prune(Keep keep) {
    std::erase_if(offers_, [&keep](const auto& entry) { return !keep(entry.first, entry.second); });
  }
  const std::map<int, Offer>& offers() const { return offers_; }
  std::size_t size() const { return offers_.size(); }

 private:
  std::map<int, Offer> offers_;
};

enum class ShortcutAction { kDispatch, kConsume };

inline ShortcutAction ShortcutActionFor(bool suppressed) {
  return suppressed ? ShortcutAction::kConsume : ShortcutAction::kDispatch;
}

inline bool ShortcutAccepted(int key_code, int modifiers, bool has_command, bool suppressed) {
  return key_code >= 1 && key_code <= 255 && modifiers >= 0 && (has_command || suppressed);
}

inline std::string_view OfferedProfile(std::string_view profile_name) {
  return profile_name == "default" ? std::string_view() : profile_name;
}

enum class AdoptField { kAbsent, kInvalid, kId };

inline AdoptField ClassifyAdoptField(bool present, bool is_string, std::string_view value) {
  if (!present) return AdoptField::kAbsent;
  if (!is_string || !ParseAdoptId(value)) return AdoptField::kInvalid;
  return AdoptField::kId;
}

enum class CreatePlan { kRefuse, kReclaim, kCreate, kReplace, kAdopt, kAdoptReplacing };

struct CreateRequest {
  AdoptField adopt = AdoptField::kAbsent;
  int adopt_id = 0;
  bool key_bound = false;
  bool same_profile = false;
  int bound_id = 0;
  AdoptRefusal adoption = AdoptRefusal::kNone;
};

inline CreatePlan PlanCreate(const CreateRequest& request) {
  if (request.adopt == AdoptField::kInvalid) return CreatePlan::kRefuse;
  if (request.key_bound && request.same_profile) {
    if (request.adopt == AdoptField::kAbsent || request.adopt_id == request.bound_id) return CreatePlan::kReclaim;
    return CreatePlan::kRefuse;
  }
  if (request.adopt == AdoptField::kId) {
    if (request.adoption != AdoptRefusal::kNone) return CreatePlan::kRefuse;
    return request.key_bound ? CreatePlan::kAdoptReplacing : CreatePlan::kAdopt;
  }
  return request.key_bound ? CreatePlan::kReplace : CreatePlan::kCreate;
}

}

#endif
