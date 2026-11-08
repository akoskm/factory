import { Monitor, Moon, Sun } from "lucide-react";
import packageJson from "../../../package.json";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type ThemePreference } from "@/theme";
import { useTheme } from "@/use-theme";

const LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

function themeIcon(preference: ThemePreference) {
  if (preference === "dark") return Moon;
  if (preference === "light") return Sun;
  return Monitor;
}

export function SidebarThemeFooter() {
  const { preference, setPreference } = useTheme();
  const { isMobile, state } = useSidebar();
  const Icon = themeIcon(preference);

  return (
    <div className="flex items-center justify-between gap-2 border-t pl-2.5 pt-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:pl-0">
      <span className="truncate text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
        v{packageJson.version}
      </span>
      <div className="flex items-center gap-2">
        <Select value={preference} onValueChange={(v) => setPreference(v as ThemePreference)}>
          <Tooltip>
            <TooltipTrigger asChild>
              <SelectTrigger
                aria-label="Theme"
                className="h-8 w-[6.5rem] shrink-0 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:shadow-none group-data-[collapsible=icon]:[&>svg:last-child]:hidden"
              >
                <Icon className="size-4 shrink-0 group-data-[collapsible=icon]:mx-auto" />
                <span className="group-data-[collapsible=icon]:hidden">
                  <SelectValue />
                </span>
              </SelectTrigger>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              align="center"
              hidden={state !== "collapsed" || isMobile}
            >
              Theme: {LABELS[preference]}
            </TooltipContent>
          </Tooltip>
          <SelectContent align="end">
            {(Object.keys(LABELS) as ThemePreference[]).map((key) => (
              <SelectItem key={key} value={key}>
                {LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <SidebarTrigger
              showCollapsedStateIcon
              className="shrink-0 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:shadow-none"
            />
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="center"
            hidden={state !== "collapsed" || isMobile}
          >
            Toggle sidebar
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
