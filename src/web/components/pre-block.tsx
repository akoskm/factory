export function PreBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="max-h-[420px] overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
      {children}
    </pre>
  );
}
