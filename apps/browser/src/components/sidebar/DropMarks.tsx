import { StyleSheet, View } from "react-native";
import { radius } from "../ui";
import type { SplitDropSide } from "../../state/drag/drops";
import { useDropLine } from "./DragProvider";
import { DROP_LINE, SPLIT_DROP, useSidebarTokens } from "./tokens";

export function DropLine() {
  const line = useDropLine();
  const tokens = useSidebarTokens();
  if (!line) return null;
  const { stroke, ring, inset, trailing } = DROP_LINE;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: line.x + inset, top: line.y - ring / 2, width: Math.max(ring, line.w - inset - trailing), height: ring, flexDirection: "row", alignItems: "center" }}>
      <View style={{ width: ring, height: ring, borderRadius: ring / 2, borderWidth: stroke, borderColor: tokens.dropLine }} />
      <View style={{ flex: 1, height: stroke, backgroundColor: tokens.dropLine }} />
    </View>
  );
}

export function SplitDropHalf({ side, fill }: { side: SplitDropSide | null; fill: string }) {
  if (!side) return null;
  return (
    <View pointerEvents="none" style={HALVES}>
      <View style={[HALF, { borderRadius: radius.chrome, backgroundColor: side === "left" ? fill : undefined }]} />
      <View style={[HALF, { borderRadius: radius.chrome, backgroundColor: side === "right" ? fill : undefined }]} />
    </View>
  );
}

const HALVES = { ...StyleSheet.absoluteFillObject, flexDirection: "row", gap: SPLIT_DROP.gap } as const;
const HALF = { flex: 1 } as const;
