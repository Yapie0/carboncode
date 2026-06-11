import { Box, Text } from "ink";
// biome-ignore lint/style/useImportType: tsconfig jsx=react needs React in value scope for JSX compilation
import React from "react";
import type { UserCard as UserCardData } from "../state/cards.js";
import { FG, SURFACE, TONE } from "../theme/tokens.js";

export function UserCard({ card }: { card: UserCardData }): React.ReactElement {
  const lines = card.text.length > 0 ? card.text.split("\n") : [""];

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      paddingX={1}
      borderStyle="round"
      borderColor={TONE.brand}
      backgroundColor={SURFACE.bgInput}
    >
      {lines.map((line, index) => (
        <Box key={`${index}:${line}`}>
          <Text bold color={index === 0 ? TONE.brand : FG.faint}>
            {index === 0 ? "> " : "  "}
          </Text>
          <Text>{line}</Text>
        </Box>
      ))}
    </Box>
  );
}
