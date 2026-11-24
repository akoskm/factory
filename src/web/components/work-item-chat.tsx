import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, Paperclip, SendHorizontal, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

export type ChatAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
};

export type ChatMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  attachments: ChatAttachment[];
};

type PendingFile = {
  id: string;
  file: File;
  previewUrl?: string;
};

type Props = {
  workItemId: string;
  takenOver: boolean;
  canTakeOver: boolean;
  onTakenOver: () => void;
  onPipelineContinued?: () => void;
};

async function loadMessages(workItemId: string): Promise<{
  messages: ChatMessage[];
  takenOver: boolean;
}> {
  const res = await fetch(`/api/work-items/${workItemId}/messages`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ messages: ChatMessage[]; takenOver: boolean }>;
}

export function WorkItemChat({
  workItemId,
  takenOver,
  canTakeOver,
  onTakenOver,
  onPipelineContinued,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [takingOver, setTakingOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveAssistant, setLiveAssistant] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const sendEnabled = takenOver && !sending;

  const refresh = useCallback(async () => {
    const data = await loadMessages(workItemId);
    setMessages((prev) => {
      if (
        prev.length === data.messages.length &&
        prev.every(
          (m, i) =>
            m.id === data.messages[i]?.id &&
            m.content === data.messages[i]?.content &&
            m.updatedAt === data.messages[i]?.updatedAt,
        )
      ) {
        return prev;
      }
      return data.messages;
    });
  }, [workItemId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!takenOver) return;
    const timer = setInterval(() => {
      if (sending) return;
      void refresh().catch(() => undefined);
    }, 2500);
    return () => clearInterval(timer);
  }, [takenOver, sending, refresh]);

  function onThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = gap < 80;
  }

  useEffect(() => {
    if (!stickToBottomRef.current && !sending) return;
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, liveAssistant, sending]);

  useEffect(() => {
    return () => {
      for (const p of pending) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
    };
  }, [pending]);

  async function takeOver() {
    setTakingOver(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-items/${workItemId}/take-over`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || res.statusText);
      }
      onTakenOver();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTakingOver(false);
    }
  }

  function addFiles(list: FileList | File[]) {
    const next: PendingFile[] = [];
    for (const file of Array.from(list)) {
      next.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      });
    }
    setPending((prev) => [...prev, ...next]);
  }

  function removePending(id: string) {
    setPending((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function send() {
    if (!sendEnabled) return;
    if (!text.trim() && pending.length === 0) return;
    setSending(true);
    setError(null);
    stickToBottomRef.current = true;
    setLiveAssistant("");
    try {
      const form = new FormData();
      form.set("text", text);
      for (const p of pending) form.append("files", p.file);

      const res = await fetch(`/api/work-items/${workItemId}/messages?stream=1`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || res.statusText);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let continued = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const lines = chunk.split("\n");
          let event = "message";
          let data = "";
          for (const line of lines) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            if (line.startsWith("data:")) data += line.slice(5).trim();
          }
          if (!data) continue;
          if (event === "delta") {
            const parsed = JSON.parse(data) as { content?: string };
            setLiveAssistant(parsed.content ?? "");
          } else if (event === "done") {
            const parsed = JSON.parse(data) as { continuedPipeline?: boolean };
            continued = Boolean(parsed.continuedPipeline);
          } else if (event === "error") {
            const parsed = JSON.parse(data) as { error?: string };
            throw new Error(parsed.error || "send failed");
          }
        }
      }

      setText("");
      for (const p of pending) {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      }
      setPending([]);
      setLiveAssistant(null);
      await refresh();
      if (continued) onPipelineContinued?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLiveAssistant(null);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-heading text-lg font-semibold tracking-tight">Steer</h2>
          <p className="text-sm text-muted-foreground">
            {takenOver
              ? "Chat with the foreman. Attach screenshots. Send anytime."
              : "Take over to stop the agent and steer the loop."}
          </p>
        </div>
        <Button
          variant={takenOver ? "outline" : "default"}
          disabled={!canTakeOver || takingOver || takenOver}
          onClick={() => void takeOver()}
        >
          <Hand className="size-4" />
          {takingOver ? "Taking over…" : takenOver ? "Taken over" : "Take over"}
        </Button>
      </div>

      <div
        ref={threadRef}
        onScroll={onThreadScroll}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && !liveAssistant && (
          <p className="text-sm text-muted-foreground">No steer messages yet.</p>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {liveAssistant !== null && (
          <MessageBubble
            message={{
              id: "live",
              role: "assistant",
              content: liveAssistant,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              attachments: [],
            }}
            live
            waiting={!liveAssistant.trim()}
          />
        )}
      </div>

      {error && (
        <div className="px-4 pb-2">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      <div className="border-t border-border p-3">
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="relative flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
              >
                {p.previewUrl ? (
                  <img src={p.previewUrl} alt="" className="size-8 rounded object-cover" />
                ) : null}
                <span className="max-w-[10rem] truncate">{p.file.name}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => removePending(p.id)}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div
          className={cn(
            "rounded-lg border border-border bg-muted/20 p-2",
            !takenOver && "opacity-60",
          )}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!takenOver || !e.dataTransfer.files?.length) return;
            addFiles(e.dataTransfer.files);
          }}
        >
          <Textarea
            rows={3}
            value={text}
            disabled={!takenOver || sending}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const items = e.clipboardData?.files;
              if (items?.length) addFiles(items);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={
              takenOver
                ? "Steer the agents… (paste or drop screenshots)"
                : "Take over to enable chat"
            }
            className="min-h-[4.5rem] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.pdf,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!takenOver || sending}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="size-4" />
                Attach
              </Button>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={!sendEnabled || (!text.trim() && pending.length === 0)}
              className={cn(sending && "steer-send-pulse disabled:opacity-100")}
              onClick={() => void send()}
            >
              <SendHorizontal className="size-4" />
              {sending ? (
                <>
                  Sending
                  <WaitingDots />
                </>
              ) : (
                "Send"
              )}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function WaitingDots() {
  const frames = ["...", "..", "."] as const;
  const [i, setI] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setI((n) => (n + 1) % frames.length), 400);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="inline-block w-[1.25em] text-left tabular-nums" aria-hidden>
      {frames[i]}
    </span>
  );
}

/** Hide machine decision YAML + collapse duplicated narration for chat display. */
export function formatSteerAssistantText(raw: string): {
  body: string;
  decisionLabel: string | null;
} {
  let text = raw;
  let decisionLabel: string | null = null;

  const decisionMatch =
    text.match(/```ya?ml\s*([\s\S]*?)```/i) ??
    text.match(/(?:^|\n)decision:\s*\n(?:[ \t].+\n?)+/i);
  if (decisionMatch) {
    const block = decisionMatch[1] ?? decisionMatch[0];
    const action = block.match(/action:\s*(spawn|complete|fail)/i)?.[1]?.toLowerCase();
    const agent = block.match(/agent:\s*([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
    if (action === "spawn" && agent) decisionLabel = `Pipeline → ${agent}`;
    else if (action === "complete") decisionLabel = "Pipeline → complete";
    else if (action === "fail") decisionLabel = "Pipeline → fail";
    else if (action) decisionLabel = `Pipeline → ${action}`;
  }

  text = text.replace(/```ya?ml\s*[\s\S]*?```/gi, "");
  text = text.replace(/(?:^|\n)decision:\s*\n(?:[ \t].+\n?)+/gi, "\n");
  // drop leftover fence crumbs
  text = text.replace(/```+/g, "");

  // collapse accidental duplicated prefixes (CheckingChecking…)
  text = text.replace(/\b([A-Za-z]{3,})\1\b/g, "$1");

  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+\n/g, "\n").trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of paras) {
    const key = p.replace(/\s+/g, " ").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  return { body: unique.join("\n\n").trim(), decisionLabel };
}

function MessageBubble({
  message,
  live,
  waiting,
}: {
  message: ChatMessage;
  live?: boolean;
  waiting?: boolean;
}) {
  const isUser = message.role === "user";
  const formatted = !isUser ? formatSteerAssistantText(message.content) : null;
  const body = formatted?.body ?? message.content;
  const decisionLabel = formatted?.decisionLabel ?? null;

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
          live && "opacity-90",
        )}
      >
        {!isUser && (
          <div className="mb-1 text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
            Foreman{live ? " · live" : ""}
          </div>
        )}
        {message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.attachments.map((a) =>
              a.mimeType.startsWith("image/") ? (
                <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                  <img
                    src={a.url}
                    alt={a.filename}
                    className="max-h-40 max-w-full rounded-md border border-border/40 object-contain"
                  />
                </a>
              ) : (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {a.filename}
                </a>
              ),
            )}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">
          {waiting ? <WaitingDots /> : body || (decisionLabel ? null : message.content)}
        </div>
        {decisionLabel && !waiting && (
          <p className="mt-2 text-[0.7rem] tracking-wide text-muted-foreground uppercase">
            {decisionLabel}
          </p>
        )}
      </div>
    </div>
  );
}
