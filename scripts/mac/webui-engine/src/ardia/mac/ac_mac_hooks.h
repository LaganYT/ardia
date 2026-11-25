#ifndef ARDIA_MAC_AC_MAC_HOOKS_H_
#define ARDIA_MAC_AC_MAC_HOOKS_H_

extern bool g_ardia_mac_hosts_normal_windows;

#if defined(__OBJC__)
#import <AppKit/AppKit.h>

extern bool (*g_ardia_mac_shell_passes_point)(NSView* view, NSPoint point);
#endif

#endif
