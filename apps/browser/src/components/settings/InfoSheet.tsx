import { View } from "react-native";
import { Button, DialogActions, DialogTitle, proseLineHeight, Sheet, space, Text } from "../ui";
import { closeSettingsSheet, showSettingsSheet } from "../../state/settings/sheet";

export function InfoSheet({ title, paragraphs, action = "Done" }: { title: string; paragraphs: readonly string[]; action?: string }) {
  return (
    <Sheet onClose={closeSettingsSheet}>
      <DialogTitle>{title}</DialogTitle>
      <View style={PROSE_LIST}>
        {paragraphs.map((text, index) => (
          <Text key={index} style={PROSE}>
            {text}
          </Text>
        ))}
      </View>
      <DialogActions>
        <Button title={action} kind="primary" onPress={closeSettingsSheet} />
      </DialogActions>
    </Sheet>
  );
}

export function InfoButton({ title, paragraphs, action }: { title: string; paragraphs: readonly string[]; action?: string }) {
  return (
    <Button
      variant="icon"
      icon="info.circle"
      size="m"
      onPress={() => showSettingsSheet(<InfoSheet title={title} paragraphs={paragraphs} action={action} />)}
      tooltip={title}
    />
  );
}

const PROSE_LIST = { gap: space.l, marginTop: space.l } as const;
const PROSE = { lineHeight: proseLineHeight.body } as const;
