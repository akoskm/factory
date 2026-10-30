import { CircleAlert, CircleCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function StatusAlert({ kind, text }: { kind: "ok" | "err"; text: string }) {
  return (
    <Alert variant={kind === "err" ? "destructive" : "default"}>
      {kind === "err" ? <CircleAlert /> : <CircleCheck />}
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  );
}
