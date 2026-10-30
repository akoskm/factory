import { Label } from "@/components/ui/label";

export function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
