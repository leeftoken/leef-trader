import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MobileNav } from "./shell-nav";
import { useTerminal } from "@/store/terminal";

describe("MobileNav primary navigation", () => {
  beforeEach(() => {
    useTerminal.setState({ tab: "overview" });
  });

  it("keeps Overview directly reachable from the bottom navigation", () => {
    render(<MobileNav poolCount={8} />);
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
  });

  it("keeps the high-frequency trader desks in the bottom bar", () => {
    render(<MobileNav poolCount={8} />);
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Swap" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bot" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wallet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("marks the current section as the active page", () => {
    useTerminal.setState({ tab: "bot" });
    render(<MobileNav poolCount={8} />);
    expect(screen.getByRole("button", { name: "Bot" })).toHaveAttribute("aria-current", "page");
  });


  it("opens More and switches to an additional desk", () => {
    render(<MobileNav poolCount={8} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    const satDesk = screen.getByRole("button", { name: /SAT treasury/i });
    expect(satDesk).toBeInTheDocument();
    fireEvent.click(satDesk);
    expect(useTerminal.getState().tab).toBe("sat");
  });

  it("marks More as current when an additional desk is active", () => {
    useTerminal.setState({ tab: "sat" });
    render(<MobileNav poolCount={8} />);
    expect(screen.getByRole("button", { name: "More" })).toHaveAttribute("aria-current", "page");
  });

  it("opens the selected desk from the bottom navigation", () => {
    render(<MobileNav poolCount={8} />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(useTerminal.getState().tab).toBe("overview");
    fireEvent.click(screen.getByRole("button", { name: "Swap" }));
    expect(useTerminal.getState().tab).toBe("quotes");
    fireEvent.click(screen.getByRole("button", { name: "Bot" }));
    expect(useTerminal.getState().tab).toBe("bot");
  });
});
