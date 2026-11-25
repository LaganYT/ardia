#ifndef ARDIA_MAC_WEBUI_LAUNCH_ARGS_H_
#define ARDIA_MAC_WEBUI_LAUNCH_ARGS_H_

#include <stddef.h>
#include <stdio.h>
#include <string.h>

enum { kArdiaLaunchExtraArgs = 5, kArdiaLaunchPathLimit = 4096 };

typedef struct {
  char user_data[kArdiaLaunchPathLimit + 32];
  char ardia_data[kArdiaLaunchPathLimit + 32];
} ArdiaLaunchStorage;

static inline int ArdiaHasSwitch(int argc, const char* const argv[], const char* prefix) {
  const size_t length = strlen(prefix);
  for (int i = 1; i < argc; ++i) {
    if (argv[i] && strncmp(argv[i], prefix, length) == 0) {
      return 1;
    }
  }
  return 0;
}

static inline int ArdiaBackgroundValue(const char* value) {
  return value && (strcmp(value, "1") == 0 || strcmp(value, "true") == 0);
}

static inline int ArdiaBuildLaunchArgs(int argc,
                                       const char* const argv[],
                                       const char* data,
                                       const char* background,
                                       ArdiaLaunchStorage* storage,
                                       const char** out) {
  int count = 0;
  for (int i = 0; i < argc; ++i) {
    out[count++] = argv[i];
  }
  if (ArdiaHasSwitch(argc, argv, "--type=")) {
    return count;
  }
  if (data && *data && strlen(data) < kArdiaLaunchPathLimit &&
      !ArdiaHasSwitch(argc, argv, "--user-data-dir=")) {
    snprintf(storage->user_data, sizeof(storage->user_data), "--user-data-dir=%s/Chromium", data);
    snprintf(storage->ardia_data, sizeof(storage->ardia_data), "--ardia-data-dir=%s", data);
    out[count++] = storage->user_data;
    out[count++] = storage->ardia_data;
    out[count++] = "--use-mock-keychain";
    if (!ArdiaHasSwitch(argc, argv, "--ardia-shell=")) {
      out[count++] = "--ardia-shell=webui";
    }
  }
  if (ArdiaBackgroundValue(background) && !ArdiaHasSwitch(argc, argv, "--ardia-background")) {
    out[count++] = "--ardia-background";
  }
  return count;
}

#endif
