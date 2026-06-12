import { Box, Text, useStdout } from "ink";
// biome-ignore lint/style/useImportType: tsconfig jsx=react needs React in value scope for JSX compilation
import React from "react";
import type { UserCard as UserCardData } from "../state/cards.js";
import { FG, SURFACE, TONE } from "../theme/tokens.js";

export function UserCard({ card }: { card: UserCardData }): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;
  const cardWidth = Math.max(20, Math.floor(cols * 0.96));
  const lines = card.text.length > 0 ? card.text.split("\n") : [""];

  return (
    <Box
      flexDirection="column"
      width={cardWidth}
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
