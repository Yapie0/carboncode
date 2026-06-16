import { Box } from "ink";
// biome-ignore lint/style/useImportType: tsconfig jsx=react needs React in value scope for JSX compilation
import React from "react";

export interface ConversationViewportProps {
  history: React.ReactNode;
  controls: React.ReactNode;
}

export function ConversationViewport({
  history,
  controls,
}: ConversationViewportProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box flexDirection="column">{history}</Box>
      {controls}
    </Box>
  );
}
