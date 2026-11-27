import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Hand, Loader2, Paperclip, SendHorizontal, X } from "lucide-react";
import { cn } from "cn";
import { formatUsd } from "@/format-usd";
import type { WorkItemArtifact } from "../api";
import { displayError, runHeadline, runsChronological } from "../work-item-overview";
import { ChatMarkdown, MarkdownBlock, MarkdownToggle } from "@/components/markdown-block";
import { PreBlock } from "@/components/pre-block";
import { LiveSurface, StatusBadge } from "@/components/status-badge";
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
  runId?: string | null;
  attachments: ChatAttachment[];
};

export type ChatRun = {
  id: string;
  agentName: string;
  harness: string;
  model: string;
  status: string;
  transcript: string;
  startedAt: string;
  finishedAt: string | null;
  decision: { action: string; agent?: string; note?: string; options?: string[] } | null;
  costUsd: string | null;
  error: string | null;
};

type PendingFile = {
  id: string;
  file: File;
  previewUrl?: string;
};

type Props = {
  workItemId: string;
  status: string;
  takenOver: boolean;
  canTakeOver: boolean;
  onTakenOver: () => void;
  onPipelineContinued?: () => void;
  runs: ChatRun[];
  notesByRun: Map<string, WorkItemArtifact>;
  /** Structured choices for the active ask_user park. */
  askUserOptions?: string[] | null;
  /** Only ask_user holds should light up choice buttons (not proof/bootstrap). */
  holdKind?: "ask_user" | "bootstrap" | "proof" | null;
  onChooseOption?: (option: string) => void | Promise<void>;
  onStopChoices?: () => void | Promise<void>;
  choiceBusy?: string | null;
};

type TimelineItem =
  | { kind: "run"; at: number; run: ChatRun }
  | { kind: "message"; at: number; message: ChatMessage };

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
  status,
  takenOver,
  canTakeOver,
  onTakenOver,
  onPipelineContinued,
  runs,
  notesByRun,
  askUserOptions,
  holdKind,
  onChooseOption,
  onStopChoices,
  choiceBusy,
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
  const pipelineBusy = status === "running" || status === "queued";
  const sendEnabled = takenOver && !sending && !pipelineBusy;

  const timeline = useMemo(() => buildTimeline(runs, messages), [runs, messages]);
  const runsById = useMemo(() => new Map(runs.map((r) => [r.id, r])), [runs]);
  /** Latest ask_user is waiting only while parked on ask_user — not proof/bootstrap. */
  const pendingAsk = useMemo(() => {
    if (status !== "needs_user") return null;
    if (holdKind != null && holdKind !== "ask_user") return null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const item = timeline[i];
      if (item.kind === "run" && item.run.decision?.action === "ask_user") {
        return { kind: "run" as const, id: item.run.id };
      }
      if (item.kind === "message" && item.message.role !== "user") {
        const parsed = formatSteerAssistantText(item.message.content);
        if (parsed.action === "ask_user") {
          return { kind: "message" as const, id: item.message.id };
        }
      }
    }
    return null;
  }, [timeline, status, holdKind]);

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
  }, [timeline, liveAssistant, sending]);

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
    <section className="flex min-h-[32rem] flex-col overflow-hidden rounded-xl border border-border bg-background">
      <div
        ref={threadRef}
        onScroll={onThreadScroll}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {timeline.length === 0 && !liveAssistant && (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        )}
        {timeline.map((item) =>
          item.kind === "run" ? (
            <AgentRunBubble
              key={`run-${item.run.id}`}
              run={item.run}
              note={notesByRun.get(item.run.id) ?? null}
              waitingOnYou={
                pendingAsk?.kind === "run" && pendingAsk.id === item.run.id
              }
              choices={
                pendingAsk?.kind === "run" && pendingAsk.id === item.run.id
                  ? askUserOptions ?? item.run.decision?.options ?? null
                  : null
              }
              choiceBusy={choiceBusy}
              onChooseOption={onChooseOption}
              onStopChoices={onStopChoices}
            />
          ) : (
            <MessageBubble
              key={item.message.id}
              message={item.message}
              runStatus={
                item.message.runId ? runsById.get(item.message.runId)?.status : undefined
              }
              waitingOnYou={
                pendingAsk?.kind === "message" && pendingAsk.id === item.message.id
              }
              choices={
                pendingAsk?.kind === "message" && pendingAsk.id === item.message.id
                  ? askUserOptions ?? null
                  : null
              }
              choiceBusy={choiceBusy}
              onChooseOption={onChooseOption}
              onStopChoices={onStopChoices}
            />
          ),
        )}
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
            runStatus="running"
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

      <div className="space-y-3 border-t border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusBadge status={status} />
          <Button
            variant={takenOver ? "outline" : "default"}
            size="sm"
            disabled={!canTakeOver || takingOver || takenOver}
            onClick={() => void takeOver()}
          >
            <Hand className="size-4" />
            {takingOver ? "Taking over…" : takenOver ? "Taken over" : "Take over"}
          </Button>
        </div>

        {pending.length > 0 && (
          <div className="flex flex-wrap gap-2">
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
            (!takenOver || pipelineBusy) && "opacity-60",
          )}
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (!takenOver || pipelineBusy || !e.dataTransfer.files?.length) return;
            addFiles(e.dataTransfer.files);
          }}
        >
          <Textarea
            rows={3}
            value={text}
            disabled={!takenOver || sending || pipelineBusy}
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
              pipelineBusy
                ? "Pipeline running… wait before steering again"
                : takenOver
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
                disabled={!takenOver || sending || pipelineBusy}
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

function buildTimeline(runs: ChatRun[], messages: ChatMessage[]): TimelineItem[] {
  const linkedRunIds = new Set(
    messages.map((m) => m.runId).filter((id): id is string => Boolean(id)),
  );
  const items: TimelineItem[] = [];

  for (const run of runsChronological(runs)) {
    if (linkedRunIds.has(run.id)) continue;
    items.push({ kind: "run", at: Date.parse(run.startedAt), run });
  }
  for (const message of messages) {
    items.push({ kind: "message", at: Date.parse(message.createdAt), message });
  }

  items.sort((a, b) => a.at - b.at || (a.kind === "run" ? -1 : 1));
  return items;
}

function WaitingDots() {
  const frames = [".", "..", "..."] as const;
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
  action: string | null;
  decisionLabel: string | null;
} {
  let text = raw;
  let action: string | null = null;
  let decisionLabel: string | null = null;

  const decisionMatch =
    text.match(/```ya?ml\s*([\s\S]*?)```/i) ??
    text.match(/(?:^|\n)decision:\s*\n(?:[ \t].+\n?)+/i);
  if (decisionMatch) {
    const block = decisionMatch[1] ?? decisionMatch[0];
    action = block.match(/action:\s*(spawn|complete|fail|ask_user)/i)?.[1]?.toLowerCase() ?? null;
    const agent = block.match(/agent:\s*([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
    if (action === "spawn" && agent) decisionLabel = `Pipeline → ${agent}`;
    else if (action === "complete") decisionLabel = "Pipeline → complete";
    else if (action === "fail") decisionLabel = "Pipeline → fail";
    else if (action === "ask_user") decisionLabel = null; // pending bubble sets Waiting on you
    else if (action) decisionLabel = `Pipeline → ${action}`;
  }

  text = text.replace(/```ya?ml\s*[\s\S]*?```/gi, "");
  text = text.replace(/(?:^|\n)decision:\s*\n(?:[ \t].+\n?)+/gi, "\n");
  text = text.replace(/```+/g, "");
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

  return { body: unique.join("\n\n").trim(), action, decisionLabel };
}

function AskUserChoices({
  choices,
  choiceBusy,
  onChooseOption,
  onStopChoices,
}: {
  choices: string[];
  choiceBusy?: string | null;
  onChooseOption?: (option: string) => void | Promise<void>;
  onStopChoices?: () => void | Promise<void>;
}) {
  const [otherDraft, setOtherDraft] = useState("");
  /** Local pending locks UI on the same click tick (before parent/network). */
  const [pending, setPending] = useState<string | null>(null);
  if (choices.length === 0 || !onChooseOption) return null;
  const choose = onChooseOption;

  // Structured options[] only — no label sniffing. Freeform box always available.
  const busyKey = pending ?? choiceBusy;
  const locked = busyKey != null;
  const freeformSelected =
    busyKey != null && busyKey !== "__stop__" && !choices.includes(busyKey);
  const canSendOther = otherDraft.trim().length > 0 && !locked;

  async function submitChoice(option: string) {
    if (locked) return;
    setPending(option);
    try {
      await choose(option);
    } finally {
      setPending(null);
    }
  }

  async function submitStop() {
    if (!onStopChoices || locked) return;
    setPending("__stop__");
    try {
      await onStopChoices();
    } finally {
      setPending(null);
    }
  }

  return (
    <div
      className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3"
      aria-busy={locked}
    >
      {locked && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          {busyKey === "__stop__" ? "Stopping…" : "Sending your answer…"}
        </p>
      )}
      {choices.map((option) => {
        const selected = busyKey === option;
        return (
          <Button
            key={option}
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-auto justify-start whitespace-normal px-3 py-2 text-left transition-opacity",
              locked && !selected && "opacity-40",
              selected && "border-primary/50 bg-primary/5",
            )}
            disabled={locked}
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation();
              void submitChoice(option);
            }}
          >
            {selected ? (
              <span className="flex items-start gap-2">
                <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden />
                <span>Sending…</span>
              </span>
            ) : (
              option
            )}
          </Button>
        );
      })}
      <div
        className={cn(
          "grid gap-2 rounded-md border border-border/60 bg-background/40 p-2 transition-opacity",
          locked && !freeformSelected && "opacity-40",
          freeformSelected && "border-primary/50 bg-primary/5",
        )}
      >
        <p className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
          Other
        </p>
        <Textarea
          value={otherDraft}
          onChange={(e) => setOtherDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Write your answer…"
          rows={3}
          disabled={locked}
          className="min-h-[4.5rem] resize-y bg-background text-sm"
        />
        <Button
          type="button"
          size="sm"
          className="self-end"
          disabled={locked || !canSendOther}
          onClick={(e) => {
            e.stopPropagation();
            const text = otherDraft.trim();
            if (!text || locked) return;
            void submitChoice(text);
          }}
        >
          {freeformSelected ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Sending…
            </span>
          ) : (
            "Send"
          )}
        </Button>
      </div>
      {onStopChoices && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "self-start text-muted-foreground transition-opacity",
            locked && busyKey !== "__stop__" && "opacity-40",
          )}
          disabled={locked}
          onClick={(e) => {
            e.stopPropagation();
            void submitStop();
          }}
        >
          {busyKey === "__stop__" ? (
            <span className="flex items-center gap-2">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Stopping…
            </span>
          ) : (
            "Stop"
          )}
        </Button>
      )}
    </div>
  );
}

function AgentRunBubble({
  run,
  note,
  waitingOnYou,
  choices,
  choiceBusy,
  onChooseOption,
  onStopChoices,
}: {
  run: ChatRun;
  note: WorkItemArtifact | null;
  waitingOnYou?: boolean;
  choices?: string[] | null;
  choiceBusy?: string | null;
  onChooseOption?: (option: string) => void | Promise<void>;
  onStopChoices?: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(run.status === "running");
  const [source, setSource] = useState(false);
  const headline = runHeadline(run);
  const error = run.error ? displayError(run.error) : null;
  const cost = formatUsd(run.costUsd);
  const decisionLabel =
    run.decision?.action === "spawn" && run.decision.agent
      ? `Pipeline → ${run.decision.agent}`
      : run.decision?.action === "complete"
        ? "Pipeline → complete"
        : run.decision?.action === "fail"
          ? "Pipeline → fail"
          : run.decision?.action === "ask_user"
            ? waitingOnYou
              ? "Waiting on you"
              : null
            : run.decision?.action
              ? `Pipeline → ${run.decision.action}`
              : null;
  const choiceList = choices?.filter(Boolean) ?? [];

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "max-w-[92%] rounded-2xl bg-muted px-3 py-2 text-sm text-foreground",
          run.status === "running" && "ring-1 ring-emerald-500/30",
          waitingOnYou && "ring-1 ring-amber-500/35",
        )}
      >
        <button
          type="button"
          className="flex w-full items-start gap-2 text-left"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <LiveSurface active={run.status === "running"}>
                <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
                  {run.agentName}
                </span>
              </LiveSurface>
              <StatusBadge status={run.status} />
              {cost && <span className="text-[0.65rem] text-muted-foreground">{cost}</span>}
            </div>
            <div className="text-foreground">
              {run.status === "running" ? (
                <WaitingDots />
              ) : (
                <ChatMarkdown
                  markdown={
                    waitingOnYou && run.decision?.note
                      ? run.decision.note
                      : headline || "—"
                  }
                />
              )}
            </div>
            {decisionLabel && (
              <p className="text-[0.7rem] tracking-wide text-muted-foreground uppercase">
                {decisionLabel}
              </p>
            )}
          </div>
          <ChevronDown
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {waitingOnYou && choiceList.length > 0 && (
          <AskUserChoices
            choices={choiceList}
            choiceBusy={choiceBusy}
            onChooseOption={onChooseOption}
            onStopChoices={onStopChoices}
          />
        )}
        {open && (
          <div className="mt-3 grid gap-3 border-t border-border/60 pt-3">
            {note && (
              <div className="grid gap-2">
                <div className="flex justify-end">
                  <MarkdownToggle source={source} onChange={setSource} />
                </div>
                <MarkdownBlock markdown={note.content} source={source} />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {run.harness} / {run.model}
              {run.finishedAt ? ` · finished ${new Date(run.finishedAt).toLocaleString()}` : ""}
              {` · started ${new Date(run.startedAt).toLocaleString()}`}
            </p>
            {error && (
              <Alert variant="destructive">
                <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
              </Alert>
            )}
            <PreBlock>
              {run.transcript.trim() ? displayError(run.transcript) : "(no transcript)"}
            </PreBlock>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  live,
  waiting,
  runStatus,
  waitingOnYou,
  choices,
  choiceBusy,
  onChooseOption,
  onStopChoices,
}: {
  message: ChatMessage;
  live?: boolean;
  waiting?: boolean;
  runStatus?: string;
  waitingOnYou?: boolean;
  choices?: string[] | null;
  choiceBusy?: string | null;
  onChooseOption?: (option: string) => void | Promise<void>;
  onStopChoices?: () => void | Promise<void>;
}) {
  const isUser = message.role === "user";
  const formatted = !isUser ? formatSteerAssistantText(message.content) : null;
  const body = formatted?.body ?? message.content;
  const decisionLabel =
    waitingOnYou && formatted?.action === "ask_user"
      ? "Waiting on you"
      : (formatted?.decisionLabel ?? null);
  const badgeStatus = runStatus ?? (!isUser && !live && !waiting ? "finished" : undefined);
  const choiceList = choices?.filter(Boolean) ?? [];

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
          live && "opacity-90",
          waitingOnYou && "ring-1 ring-amber-500/35",
        )}
      >
        {!isUser && (
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">
              Foreman{live ? " · live" : ""}
            </span>
            {badgeStatus && <StatusBadge status={badgeStatus} />}
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
        {waiting ? (
          <WaitingDots />
        ) : body || message.content ? (
          <ChatMarkdown markdown={body || message.content} />
        ) : null}
        {decisionLabel && !waiting && (
          <p className="mt-2 text-[0.7rem] tracking-wide text-muted-foreground uppercase">
            {decisionLabel}
          </p>
        )}
        {waitingOnYou && choiceList.length > 0 && (
          <AskUserChoices
            choices={choiceList}
            choiceBusy={choiceBusy}
            onChooseOption={onChooseOption}
            onStopChoices={onStopChoices}
          />
        )}
      </div>
    </div>
  );
}
