import { ExternalLink, GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrLink({ href, label = "Pull request" }: { href: string; label?: string }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={href} target="_blank" rel="noreferrer">
        <GitPullRequest />
        {label}
        <ExternalLink />
      </a>
    </Button>
  );
}
