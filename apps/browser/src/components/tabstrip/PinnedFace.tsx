import { View } from "react-native";
import { useTab } from "../../state/browser/hooks";
import { TabBadges } from "../media/TabBadges";
import { TabIcon } from "../sidebar/TabIcon";
import { useTheme } from "../ui/theme";
import { ITEM_HEIGHT, PINNED_CELL, PINNED_FACE_INSET, PINNED_FACE_RADIUS } from "./tokens";

export function PinnedFace({ tabId, active, hovered, pressed }: { tabId: string; active: boolean; hovered: boolean; pressed: boolean }) {
  const theme = useTheme();
  const tab = useTab(tabId);
  if (!tab) return null;
  const face = { position: "absolute", left: PINNED_FACE_INSET, right: PINNED_FACE_INSET, top: PINNED_FACE_INSET, bottom: PINNED_FACE_INSET } as const;
  return (
    <View style={{ width: PINNED_CELL, height: ITEM_HEIGHT - 1, alignItems: "center", justifyContent: "center" }}>
      {(active || hovered || pressed) && (
        <View
          style={{
            ...face,
            borderRadius: PINNED_FACE_RADIUS,
            backgroundColor: pressed ? theme.tabPressed : active ? theme.pinnedSelectedFill : theme.tabHover,
          }}
        />
      )}
      <View pointerEvents="none">
        <TabIcon tabId={tab.id} url={tab.url} favicon={tab.favicon} icon={tab.customIcon} />
        <TabBadges tabId={tab.id} pip={false} />
      </View>
    </View>
  );
}
