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

export function MarkdownBlock({ markdown, source }: { markdown: string; source: boolean }) {
  if (source) return <PreBlock>{markdown}</PreBlock>;
  return <MarkdownPreview markdown={markdown} />;
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  return (
    <div
      className={cn(
        "max-h-[420px] overflow-auto text-sm leading-relaxed",
        "[&_h1]:mt-0 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold",
        "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-medium",
        "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5 [&_li]:pl-1",
        "[&_a]:underline [&_a]:underline-offset-4",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs",
        "[&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-muted/50 [&_pre]:p-3",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
        "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
      )}
    >
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
    </div>
  );
}
