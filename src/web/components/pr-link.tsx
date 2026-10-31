import type { ReactNode } from "react";
import { ExternalLink, GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrLink({
  href,
  label = "Pull request",
  icon = <GitPullRequest />,
}: {
  href: string;
  label?: string;
  icon?: ReactNode;
}) {
  return (
    <Button variant="outline" size="sm" asChild>
      <a href={href} target="_blank" rel="noreferrer">
        {icon}
        {label}
        <ExternalLink />
      </a>
    </Button>
  );
}
