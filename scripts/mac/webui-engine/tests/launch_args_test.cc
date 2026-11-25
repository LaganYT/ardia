#include "launch_args.h"

#include <string>
#include <vector>

#include "check.h"

namespace {

std::vector<std::string> Build(std::vector<const char*> argv, const char* data, const char* background) {
  ArdiaLaunchStorage storage;
  std::vector<const char*> out(argv.size() + kArdiaLaunchExtraArgs + 1, nullptr);
  const int count = ArdiaBuildLaunchArgs(static_cast<int>(argv.size()), argv.data(), data, background, &storage,
                                         out.data());
  return std::vector<std::string>(out.begin(), out.begin() + count);
}

bool Has(const std::vector<std::string>& args, const std::string& value) {
  for (const std::string& arg : args) {
    if (arg == value) return true;
  }
  return false;
}

}

TEST(background_environment_alone_adds_the_switch) {
  const auto args = Build({"Ardia"}, nullptr, "1");
  CHECK(Has(args, "--ardia-background"));
  CHECK(Has(Build({"Ardia"}, nullptr, "true"), "--ardia-background"));
}

TEST(background_is_not_added_twice_or_for_other_values) {
  const auto twice = Build({"Ardia", "--ardia-background"}, nullptr, "1");
  int count = 0;
  for (const std::string& arg : twice) count += arg == "--ardia-background";
  CHECK(count == 1);
  for (const char* value : {"", "0", "false", "yes", "TRUE"}) {
    CHECK(!Has(Build({"Ardia"}, nullptr, value), "--ardia-background"));
  }
  CHECK(!Has(Build({"Ardia"}, nullptr, nullptr), "--ardia-background"));
}

TEST(child_processes_are_left_alone) {
  const auto args = Build({"Ardia Helper", "--type=renderer"}, "/tmp/data", "1");
  CHECK(args.size() == 2);
}

TEST(data_dir_adds_profile_switches_and_the_shell) {
  const auto args = Build({"Ardia"}, "/tmp/data", nullptr);
  CHECK(Has(args, "--user-data-dir=/tmp/data/Chromium"));
  CHECK(Has(args, "--ardia-data-dir=/tmp/data"));
  CHECK(Has(args, "--use-mock-keychain"));
  CHECK(Has(args, "--ardia-shell=webui"));
  CHECK(!Has(Build({"Ardia", "--ardia-shell=native"}, "/tmp/data", nullptr), "--ardia-shell=webui"));
  CHECK(!Has(Build({"Ardia", "--user-data-dir=/x"}, "/tmp/data", nullptr), "--ardia-data-dir=/tmp/data"));
}

TEST(hostile_sinks) {
  const std::string huge(10000, 'a');
  const auto args = Build({"Ardia"}, huge.c_str(), "1");
  CHECK(!Has(args, "--use-mock-keychain"));
  CHECK(Has(args, "--ardia-background"));
  CHECK(Build({"Ardia"}, "", nullptr).size() == 1);
  const auto all = Build({"Ardia"}, "/tmp/d", "1");
  CHECK(all.size() <= 1 + static_cast<std::size_t>(kArdiaLaunchExtraArgs));
}

int main(int argc, char** argv) {
  return ardia_mac_test::RunAll(argc, argv);
}
