import { type ReactNode, useRef } from "react";
import { Animated, Pressable, type Insets, type StyleProp, type ViewStyle } from "react-native";
import { hostOf } from "@ardia/core";
import { useSettings } from "../../state/browser/hooks";
import { tabTitle } from "../../state/browser/model";
import type { Tab } from "../../state/browser/types";
import { middleClickTab } from "../../state/sidebar/clearTabs";
import { dismissHover } from "../../state/sidebar/hover";
import { openTabMenu } from "../../state/sidebar/menus";
import { clickHeldTabPress, holdTabPress, pressOutTabPress, type TabPress } from "../../state/sidebar/heldTabPress";
import { tabPressTag } from "../../state/tabs/tabReveal";
import { useSplitOf } from "../../state/windows/card";
import { ContextMenuArea } from "../ui";
import { buttonMotion, usePressScaleMotion } from "../ui/motion";

const SQUISH = { row: buttonMotion.rowPressScale, tile: buttonMotion.tilePressScale } as const;

export function TabPressArea({
  windowId,
  tab,
  style,
  pressStyle,
  tooltip,
  squish,
  hitSlop,
  selected = false,
  children,
}: {
  windowId: string;
  tab: Tab;
  style?: StyleProp<ViewStyle>;
  pressStyle?: StyleProp<ViewStyle>;
  tooltip?: string;
  squish?: keyof typeof SQUISH;
  hitSlop?: Insets;
  selected?: boolean;
  children: ReactNode | ((state: { pressed: boolean }) => ReactNode);
}) {
  const press = useRef<TabPress | null>(null);
  const inSplit = !!useSplitOf(tab.id);
  const plainTooltip = useSettings((s) => !s.showTabHoverMenu);
  const pressMotion = usePressScaleMotion(!!squish, squish ? SQUISH[squish] : undefined);
  const scale = pressMotion.scale;
  return (
    <ContextMenuArea
      onMiddleClick={() => middleClickTab(tab.id)}
      onContextMenu={() => {
        dismissHover();
        void openTabMenu(windowId, tab);
      }}
      style={style}
    >
      <Pressable
        onPressIn={(e) => {
          pressMotion.onPressIn?.();
          press.current = holdTabPress(windowId, tab.id, e, press.current);
        }}
        onPress={(e) => clickHeldTabPress(windowId, tab.id, e, press.current)}
        onPressOut={(e) => {
          pressMotion.onPressOut?.();
          pressOutTabPress(press.current, e);
        }}
        style={pressStyle}
        nativeID={tabPressTag(tab.id, selected, inSplit)}
        collapsable={false}
        hitSlop={hitSlop}
        tooltip={tooltip ?? (plainTooltip ? titleTooltip(tab) : undefined)}
      >
        {scale ? (state) => <Animated.View style={{ transform: [{ scale }] }}>{typeof children === "function" ? children(state) : children}</Animated.View> : children}
      </Pressable>
    </ContextMenuArea>
  );
}

function titleTooltip(tab: Tab): string {
  const host = tab.url ? hostOf(tab.url) : "";
  return host ? `${tabTitle(tab)}\n${host}` : tabTitle(tab);
}
