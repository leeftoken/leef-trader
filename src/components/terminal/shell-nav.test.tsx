import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { DesktopNav, MobileNav } from "./shell-nav";
import { useTerminal } from "@/store/terminal";


describe("DesktopNav information architecture", () => {
  beforeEach(() => {
    useTerminal.setState({ tab: "overview" });
  });

  it("keeps the seven high-frequency desks in the main desktop navigation", () => {
    render(<DesktopNav poolCount={8} />);
    for (const label of ["Overview", "Live tick", "Swap", "Pools", "Portfolio", "AI Bot", "Wallet", "Tools"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "SAT treasury" })).not.toBeInTheDocument();
  });

  it("opens the Tools drawer and navigates to a specialist desk", () => {
    render(<DesktopNav poolCount={8} />);
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    const treasury = screen.getByRole("button", { name: /SAT treasury/i });
    expect(treasury).toBeInTheDocument();
    fireEvent.click(treasury);
    expect(useTerminal.getState().tab).toBe("sat");
  });

  it("marks Tools as the current page when a specialist desk is active", () => {
    useTerminal.setState({ tab: "sat" });
    render(<DesktopNav poolCount={8} />);
    expect(screen.getByRole("button", { name: "Tools" })).toHaveAttribute("aria-current", "page");
  });
});

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
