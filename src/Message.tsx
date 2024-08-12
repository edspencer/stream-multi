"use client";
import { StreamableValue, readStreamableValue } from "ai/rsc";
import React, { useEffect, useState } from "react";

export function Message({ content }: { content: string | StreamableValue<string> }) {
  const text = useStreamableText(content);
  return <div>{text}</div>;
}

export function ToolMessage({ children }: { children: React.ReactNode }) {
  return <div className="tool mt-4">{children}</div>;
}

//copy/pasted from Vercel AI SDK - lets us use the same component for streaming or already-complete messages
export const useStreamableText = (content: string | StreamableValue<string>) => {
  const [rawContent, setRawContent] = useState(typeof content === "string" ? content : "");

  useEffect(() => {
    (async () => {
      if (typeof content === "object") {
        for await (const delta of readStreamableValue(content)) {
          if (typeof delta === "string") {
            setRawContent(delta);
          }
        }
      }
    })();
  }, [content]);

  return rawContent;
};
