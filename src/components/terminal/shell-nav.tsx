import { Menu } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { type TabId, useTerminal } from "@/store/terminal";
import { TABS, type TabDef } from "./tabs";

const DESKTOP_PRIMARY: TabId[] = ["overview", "tick", "quotes", "pools", "portfolio", "bot", "wallet"];

export function DesktopNav({ poolCount }: { poolCount: number }) {
  const tab = useTerminal((s) => s.tab);
  const setTab = useTerminal((s) => s.setTab);
  const [open, setOpen] = useState(false);
  const tools = TABS.filter((t) => !DESKTOP_PRIMARY.includes(t.id));
  const toolsActive = tools.some((t) => t.id === tab);

  return (
    <>
      <nav
        className="hidden items-center gap-1 overflow-x-auto border-b border-border/70 [scrollbar-width:none] md:flex [&::-webkit-scrollbar]:hidden"
        aria-label="Primary sections"
      >
        {DESKTOP_PRIMARY.map((id) => {
          const item = TABS.find((t) => t.id === id)!;
          return (
            <NavChip
              key={item.id}
              tab={item}
              active={tab === item.id}
              poolCount={poolCount}
              onClick={() => setTab(item.id)}
            />
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-current={toolsActive ? "page" : undefined}
          className={cn(
            "flex h-12 shrink-0 items-center gap-2 rounded-t-lg px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-leef/70",
            toolsActive ? "bg-leef/[0.06] text-leef" : "text-muted-foreground hover:bg-surface-2/70 hover:text-fg",
          )}
        >
          <Menu className="size-4" />
          Tools
          <span className={cn("ml-1 size-1.5 rounded-full", toolsActive ? "bg-leef" : "bg-transparent")} />
        </button>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-[min(26rem,92vw)] border-border/70 bg-surface">
          <SheetHeader className="border-b border-border/70 pb-4">
            <SheetTitle>Tools & diagnostics</SheetTitle>
            <p className="text-xs text-muted-foreground">
              Specialist desks for analysis, treasury and system status.
            </p>
          </SheetHeader>
          <div className="grid grid-cols-1 gap-2 overflow-y-auto p-4">
            {tools.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <Button
                  key={item.id}
                  variant={active ? "secondary" : "outline"}
                  className={cn("h-12 justify-start rounded-xl", active && "ring-1 ring-leef/30")}
                  onClick={() => {
                    setTab(item.id);
                    setOpen(false);
                  }}
                >
                  <Icon className="size-4" />
                  {item.label}
                  {item.id === "sat" && (
                    <span className="ml-auto rounded-full bg-warn/10 px-2 py-0.5 text-[10px] text-warn">
                      Treasury
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function MobileNav({ poolCount }: { poolCount: number }) {
  const tab = useTerminal((s) => s.tab);
  const setTab = useTerminal((s) => s.setTab);
  const [open, setOpen] = useState(false);
  const primary: TabId[] = ["overview", "quotes", "bot", "wallet"];
  const more = TABS.filter((t) => !primary.includes(t.id));

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_36px_-24px_rgb(0_0_0/0.9)] backdrop-blur-2xl md:hidden"
        aria-label="Primary"
      >
        <div className="mx-auto grid max-w-lg grid-cols-5 gap-1 px-2 py-1.5">
          {primary.map((id) => {
            const t = TABS.find((x) => x.id === id)!;
            const Icon = t.icon;
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leef/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                  active ? "bg-leef/[0.06] text-leef" : "text-muted-foreground hover:bg-surface-2/70 hover:text-fg",
                )}
              >
                <span
                  className={cn(
                    "grid size-8 place-items-center rounded-full transition-colors",
                    active && "bg-leef/15 ring-1 ring-leef/30",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                {t.short}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-current={more.some((t) => t.id === tab) ? "page" : undefined}
            className={cn(
              "flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-leef/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
              more.some((t) => t.id === tab) ? "bg-leef/[0.06] text-leef" : "text-muted-foreground hover:bg-surface-2/70 hover:text-fg",
            )}
          >
            <span
              className={cn(
                "grid size-8 place-items-center rounded-full transition-colors",
                more.some((t) => t.id === tab) && "bg-leef/15 ring-1 ring-leef/30",
              )}
            >
              <Menu className="size-4" />
            </span>
            More
          </button>
        </div>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl border-border/70 bg-surface">
          <SheetHeader>
            <SheetTitle>Desks</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-2 gap-2 p-4 pt-0">
            {more.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <Button
                  key={t.id}
                  variant={active ? "secondary" : "outline"}
                  className={cn("h-12 justify-start rounded-xl", active && "ring-1 ring-leef/30")}
                  onClick={() => {
                    setTab(t.id);
                    setOpen(false);
                  }}
                >
                  <Icon className="size-4" />
                  {t.label}
                  {t.id === "pools" && (
                    <span className="ml-auto font-mono text-xs text-leef">{poolCount}</span>
                  )}
                </Button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function NavChip({
  tab,
  active,
  poolCount,
  onClick,
}: {
  tab: TabDef;
  active: boolean;
  poolCount: number;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex h-12 shrink-0 items-center gap-2 whitespace-nowrap rounded-t-lg px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-leef/70",
        active ? "bg-leef/[0.045] text-fg" : "text-muted-foreground hover:bg-surface-2/60 hover:text-fg",
      )}
    >
      <Icon className={cn("size-4", active && "text-leef")} />
      {tab.label}
      {tab.id === "pools" && (
        <span className="rounded-full bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-leef ring-1 ring-border">
          {poolCount}
        </span>
      )}
      <span
        className={cn(
          "absolute inset-x-3 bottom-0 h-0.5 rounded-full transition-all",
          active ? "bg-leef opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}
