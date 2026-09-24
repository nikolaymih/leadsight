"use client";

import { useMutation } from "@tanstack/react-query";
import { Loader2, SendHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { toastError } from "@/lib/errors";
import { orpc } from "@/lib/orpc";
import { cn } from "@/lib/utils";

// Left pane of campaign setup. The whole conversation plus every URL seen so far goes to
// campaigns.draft on each turn; the API answers with a reply and, once it knows enough, a draft.

type Message = { role: "user" | "assistant"; content: string };
type Draft = NonNullable<Awaited<ReturnType<typeof orpc.campaigns.draft.call>>["draft"]>;

const OPENING = "Describe what you're looking for. You can paste a URL to your offer.";
const URL_RE = /https?:\/\/[^\s<>"')]+/g;

export function DraftChat({
  onDraft,
  className,
}: {
  onDraft: (draft: Draft, mode: "replace" | "criteria") => void;
  className?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: OPENING }]);
  const [input, setInput] = useState("");
  const [hasDraft, setHasDraft] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const draft = useMutation(
    orpc.campaigns.draft.mutationOptions({
      onError: (err) => toastError(err, "The assistant could not answer"),
    }),
  );

  // Scroll after React has painted the appended message.
  const scrollToBottom = () => requestAnimationFrame(() => bottom.current?.scrollIntoView({ block: "end" }));

  async function send(content: string, mode: "replace" | "criteria" = "replace") {
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    scrollToBottom();
    const urls = [
      ...new Set(next.flatMap((m) => (m.role === "user" ? (m.content.match(URL_RE) ?? []) : []))),
    ];
    const result = await draft
      .mutateAsync({ messages: next.filter((_, i) => i > 0), urls })
      .catch(() => null);
    if (!result) return;
    setMessages((m) => [...m, { role: "assistant", content: result.reply }]);
    scrollToBottom();
    if (result.draft) {
      setHasDraft(true);
      onDraft(result.draft, mode);
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col rounded-lg border border-border bg-card", className)}>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {messages.map((m, i) => (
          <div
            // Messages are append-only, so index order is stable.
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only log
            key={i}
            className={cn(
              "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
              m.role === "user" ? "ml-auto bg-accent text-accent-foreground" : "bg-muted",
            )}
          >
            {m.content}
          </div>
        ))}
        {draft.isPending ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Thinking…
          </div>
        ) : null}
        <div ref={bottom} />
      </div>
      <form
        className="flex flex-col gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && !draft.isPending) void send(input.trim());
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="We sell… to… Here's our page: https://…"
          aria-label="Message"
          className="min-h-16"
          disabled={draft.isPending}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (input.trim() && !draft.isPending) void send(input.trim());
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!hasDraft || draft.isPending}
            onClick={() =>
              void send(
                "Regenerate only the criteria: keep the name, offer, ideal poster, keywords and sources as they are.",
                "criteria",
              )
            }
          >
            Regenerate criteria
          </Button>
          <Button type="submit" size="sm" disabled={!input.trim() || draft.isPending}>
            <SendHorizontal />
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
