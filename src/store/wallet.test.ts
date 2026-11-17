import { afterEach, describe, expect, it } from "vitest";
import { useWallet } from "./wallet";

afterEach(() => {
  useWallet.getState().forgetLive();
});

describe("wallet execution mode", () => {
  it("switches to paper without deleting the connected live wallet identity", () => {
    const wallet = useWallet.getState();
    wallet.setLiveSession({
      account: "testaccount.wam",
      publicKey: "PUB_K1_test",
      permission: "active",
    });

    useWallet.getState().setMode("paper");

    const state = useWallet.getState();
    expect(state.mode).toBe("paper");
    expect(state.account).toBe("testaccount.wam");
    expect(state.authType).toBe("key");
    expect(state.publicKey).toBe("PUB_K1_test");
    expect(state.canSign()).toBe(false);
  });

  it("can return to live mode without recreating the wallet session", () => {
    const wallet = useWallet.getState();
    wallet.setLiveSession({
      account: "testaccount.wam",
      publicKey: "PUB_K1_test",
      permission: "active",
    });
    wallet.setMode("paper");

    useWallet.getState().setMode("live");

    const state = useWallet.getState();
    expect(state.mode).toBe("live");
    expect(state.account).toBe("testaccount.wam");
    expect(state.authType).toBe("key");
    expect(state.publicKey).toBe("PUB_K1_test");
  });
});
