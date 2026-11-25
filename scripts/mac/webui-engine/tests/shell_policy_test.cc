#include "ardia/mac/ac_mac_shell_policy.h"

#include <string>

#include "check.h"

namespace policy = ardia_mac::shell_policy;

TEST(session_json_is_reserved_in_every_ascii_case) {
  for (const char* name : {"session.json", "Session.json", "SESSION.JSON", "sEsSiOn.JsOn", "session.JSON"}) {
    CHECK(!policy::ValidDocumentName(name));
  }
  CHECK(policy::ValidDocumentName("sessions.json"));
  CHECK(policy::ValidDocumentName("session.json.bak"));
  CHECK(policy::ValidDocumentName("notes.json"));
}

TEST(document_names_keep_their_charset) {
  CHECK(!policy::ValidDocumentName(""));
  CHECK(!policy::ValidDocumentName(".hidden"));
  CHECK(!policy::ValidDocumentName("a/b.json"));
  CHECK(!policy::ValidDocumentName("..json/x"));
  CHECK(!policy::ValidDocumentName(std::string(201, 'a')));
  CHECK(policy::ValidDocumentName(std::string(200, 'a')));
}

TEST(oversized_sessions_are_refused_before_writing) {
  CHECK(policy::SessionFits(0));
  CHECK(policy::SessionFits(policy::kSessionLimit));
  CHECK(!policy::SessionFits(policy::kSessionLimit + 1));
  CHECK(policy::kSessionLimit == 64u * 1024u * 1024u);
}

TEST(default_profile_offers_use_the_empty_engine_name) {
  CHECK(policy::OfferedProfile("default").empty());
  CHECK(policy::OfferedProfile("work") == "work");
  CHECK(policy::OfferedProfile("").empty());
}

TEST(adopt_field_shapes) {
  using policy::AdoptField;
  CHECK(policy::ClassifyAdoptField(false, false, "") == AdoptField::kAbsent);
  CHECK(policy::ClassifyAdoptField(true, false, "") == AdoptField::kInvalid);
  CHECK(policy::ClassifyAdoptField(true, true, "") == AdoptField::kInvalid);
  CHECK(policy::ClassifyAdoptField(true, true, "tab:x") == AdoptField::kInvalid);
  CHECK(policy::ClassifyAdoptField(true, true, "tab:7") == AdoptField::kId);
}

TEST(create_plans_check_the_adopt_id_before_reclaim_or_create) {
  using policy::AdoptField;
  using policy::AdoptRefusal;
  using policy::CreatePlan;
  policy::CreateRequest fresh;
  CHECK(policy::PlanCreate(fresh) == CreatePlan::kCreate);
  policy::CreateRequest non_string = fresh;
  non_string.adopt = AdoptField::kInvalid;
  CHECK(policy::PlanCreate(non_string) == CreatePlan::kRefuse);
  policy::CreateRequest reclaim{AdoptField::kAbsent, 0, true, true, 9, AdoptRefusal::kNone};
  CHECK(policy::PlanCreate(reclaim) == CreatePlan::kReclaim);
  policy::CreateRequest invalid_on_existing = reclaim;
  invalid_on_existing.adopt = AdoptField::kInvalid;
  CHECK(policy::PlanCreate(invalid_on_existing) == CreatePlan::kRefuse);
  policy::CreateRequest mismatched = reclaim;
  mismatched.adopt = AdoptField::kId;
  mismatched.adopt_id = 4;
  CHECK(policy::PlanCreate(mismatched) == CreatePlan::kRefuse);
  policy::CreateRequest matching = mismatched;
  matching.adopt_id = 9;
  CHECK(policy::PlanCreate(matching) == CreatePlan::kReclaim);
  policy::CreateRequest adopt{AdoptField::kId, 4, false, false, 0, AdoptRefusal::kNone};
  CHECK(policy::PlanCreate(adopt) == CreatePlan::kAdopt);
  adopt.adoption = AdoptRefusal::kNotOffered;
  CHECK(policy::PlanCreate(adopt) == CreatePlan::kRefuse);
  policy::CreateRequest move{AdoptField::kAbsent, 0, true, false, 9, AdoptRefusal::kNone};
  CHECK(policy::PlanCreate(move) == CreatePlan::kReplace);
  policy::CreateRequest adopt_move{AdoptField::kId, 4, true, false, 9, AdoptRefusal::kNone};
  CHECK(policy::PlanCreate(adopt_move) == CreatePlan::kAdoptReplacing);
}

TEST(a_cross_profile_move_is_always_replaced) {
  policy::CreateRequest move{policy::AdoptField::kAbsent, 0, true, false, 9, policy::AdoptRefusal::kNone};
  CHECK(policy::PlanCreate(move) == policy::CreatePlan::kReplace);
}

TEST(offers_keep_their_active_disposition_and_leave_with_their_tab) {
  policy::OfferBook<int> book;
  book.Add(3, 30, true);
  book.Add(4, 40, false);
  CHECK(book.Find(3) && book.Find(3)->active && book.Find(3)->handle == 30);
  CHECK(book.Find(4) && !book.Find(4)->active);
  book.Forget(3);
  CHECK(!book.Find(3) && book.size() == 1);
  book.Add(5, 0, true);
  book.Prune([](int, const auto& offer) { return offer.handle != 0; });
  CHECK(book.size() == 1 && book.Find(4));
  for (int id = 0; id < 1000; ++id) {
    book.Add(100 + id, id + 1, id % 2 == 0);
    book.Forget(100 + id);
  }
  CHECK(book.size() == 1);
}

TEST(suppressed_shortcuts_are_consumed_without_a_command) {
  CHECK(policy::ShortcutActionFor(true) == policy::ShortcutAction::kConsume);
  CHECK(policy::ShortcutActionFor(false) == policy::ShortcutAction::kDispatch);
  CHECK(policy::ShortcutAccepted(84, 0, false, true));
  CHECK(policy::ShortcutAccepted(84, 4, true, false));
  CHECK(!policy::ShortcutAccepted(84, 0, false, false));
  CHECK(!policy::ShortcutAccepted(0, 0, true, false));
  CHECK(!policy::ShortcutAccepted(300, 0, true, true));
  CHECK(!policy::ShortcutAccepted(84, -1, true, true));
}

TEST(adopt_ids_are_tab_and_a_positive_int) {
  CHECK(policy::ParseAdoptId("tab:1") == 1);
  CHECK(policy::ParseAdoptId("tab:2147483647") == 2147483647);
  for (const char* bad : {"", "tab:", "tab:0", "tab:-1", "tab:2147483648", "tab:12a", "tab: 1", "ardiacore:1",
                          "TAB:1", "tab:99999999999", "tab:1\n"}) {
    CHECK(!policy::ParseAdoptId(bad));
  }
}

TEST(unclaimed_tabs_are_offered_once_the_shell_listens) {
  using policy::UnclaimedStep;
  CHECK(policy::NextUnclaimedStep(true, true, true, false, 0) == UnclaimedStep::kDrop);
  CHECK(policy::NextUnclaimedStep(false, false, true, false, 0) == UnclaimedStep::kWait);
  CHECK(policy::NextUnclaimedStep(false, false, true, false, policy::kUnclaimedTries) == UnclaimedStep::kDrop);
  CHECK(policy::NextUnclaimedStep(true, false, false, false, 0) == UnclaimedStep::kPark);
  CHECK(policy::NextUnclaimedStep(true, false, true, true, 0) == UnclaimedStep::kWait);
  CHECK(policy::NextUnclaimedStep(true, false, true, true, policy::kUnclaimedTries) == UnclaimedStep::kReport);
  CHECK(policy::NextUnclaimedStep(true, false, true, false, 0) == UnclaimedStep::kReport);
}

TEST(only_an_offered_unbound_tab_of_the_same_profile_is_adopted) {
  using policy::AdoptRefusal;
  CHECK(policy::CheckAdoption(true, true, true, true, false) == AdoptRefusal::kNone);
  CHECK(policy::CheckAdoption(false, true, true, true, false) == AdoptRefusal::kMalformed);
  CHECK(policy::CheckAdoption(true, false, true, true, false) == AdoptRefusal::kNotOffered);
  CHECK(policy::CheckAdoption(true, true, false, true, false) == AdoptRefusal::kOtherProfile);
  CHECK(policy::CheckAdoption(true, true, true, false, false) == AdoptRefusal::kGone);
  CHECK(policy::CheckAdoption(true, true, true, true, true) == AdoptRefusal::kAlreadyClaimed);
}

int main(int argc, char** argv) {
  return ardia_mac_test::RunAll(argc, argv);
}
