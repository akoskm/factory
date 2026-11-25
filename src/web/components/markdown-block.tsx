import { Code, Eye } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "cn";
import { PreBlock } from "@/components/pre-block";
import { Button } from "@/components/ui/button";

export function MarkdownToggle({
  source,
  onChange,
}: {
  source: boolean;
  onChange: (source: boolean) => void;
}) {
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        size="icon-xs"
        variant={source ? "ghost" : "secondary"}
        aria-label="Preview"
        aria-pressed={!source}
        onClick={() => onChange(false)}
      >
        <Eye />
      </Button>
      <Button
        type="button"
        size="icon-xs"
        variant={source ? "secondary" : "ghost"}
        aria-label="Markdown"
        aria-pressed={source}
        onClick={() => onChange(true)}
      >
        <Code />
      </Button>
    </div>
  );
}

const MD_PROSE = cn(
  "text-sm leading-relaxed break-words",
  "[&_h1]:mt-0 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold",
  "[&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold",
  "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:font-medium",
  "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:my-0.5 [&_li]:pl-1",
  "[&_a]:underline [&_a]:underline-offset-4",
  "[&_strong]:font-semibold",
  "[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs dark:[&_code]:bg-white/10",
  "[&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-black/10 [&_pre]:p-3 dark:[&_pre]:bg-white/10",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-current/30 [&_blockquote]:pl-3 [&_blockquote]:opacity-90",
  "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
  "[&_th]:border [&_th]:border-current/20 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border [&_td]:border-current/20 [&_td]:px-2 [&_td]:py-1",
);

export function MarkdownBlock({ markdown, source }: { markdown: string; source: boolean }) {
  if (source) return <PreBlock>{markdown}</PreBlock>;
  return (
    <div className={cn(MD_PROSE, "max-h-[420px] overflow-auto")}>
      <MarkdownBody markdown={markdown} />
    </div>
  );
}

/** Compact markdown for chat bubbles (links, bold, lists, etc.). */
export function ChatMarkdown({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div className={cn(MD_PROSE, className)}>
      <MarkdownBody markdown={markdown} />
    </div>
  );
}

function MarkdownBody({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}
