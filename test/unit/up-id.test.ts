import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveUpIdName } from "@/lib/up-id";
import {
  UPNAME_REGISTRY,
  UP_ID_READER_REGISTRY,
  isRealUpIdRegistry,
  isValidUpId,
} from "@/lib/giwa";

const HOLDER = "0xAE2F77e84817230aa051f76Df250DfC9820305B4";

/** The shape GIWA's Blockscout actually serves, trimmed to what we read. */
function holdings(items: unknown[]) {
  return {
    ok: true,
    json: async () => ({ items }),
  } as unknown as Response;
}

function upnameItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "60271723832317627005147390312673478007234028967986907754404148504475901513667",
    token: { address_hash: UPNAME_REGISTRY, symbol: "UPNAME" },
    metadata: { name: "9ojdddq3.up.id" },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("up.id reverse resolution", () => {
  /**
   * Regression: the explorer serves `token.address_hash`. An earlier version
   * read `token.address`, which is undefined here, so every lookup silently
   * returned null and verified readers showed no name.
   */
  it("matches the registry on address_hash", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => holdings([upnameItem()])));
    await expect(resolveUpIdName(HOLDER)).resolves.toBe("9ojdddq3.up.id");
  });

  it("still matches the older `address` field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        holdings([
          upnameItem({ token: { address: UPNAME_REGISTRY, symbol: "UPNAME" } }),
        ]),
      ),
    );
    await expect(resolveUpIdName(HOLDER)).resolves.toBe("9ojdddq3.up.id");
  });

  /**
   * The security-relevant case: anyone can deploy an ERC-721 that calls itself
   * UPNAME and mint a token named `vitalik.up.id`. Matching on the symbol would
   * let that token supply the label, so the contract address is what decides.
   */
  it("ignores an impostor token with the same symbol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        holdings([
          upnameItem({
            token: {
              address_hash: "0x00000000000000000000000000000000deadbeef",
              symbol: "UPNAME",
            },
            metadata: { name: "vitalik.up.id" },
          }),
        ]),
      ),
    );
    await expect(resolveUpIdName(HOLDER)).resolves.toBeNull();
  });

  it("returns null when the address holds nothing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => holdings([])));
    await expect(resolveUpIdName(HOLDER)).resolves.toBeNull();
  });

  it("falls back to the metadata service when the indexer has no name", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/v2/")) {
        return holdings([upnameItem({ metadata: null })]);
      }
      return {
        ok: true,
        json: async () => ({ name: "9ojdddq3.up.id" }),
      } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolveUpIdName(HOLDER)).resolves.toBe("9ojdddq3.up.id");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /** A label lookup failing must never read as "not verified" — that is a contract call. */
  it("returns null rather than throwing when the explorer is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(resolveUpIdName(HOLDER)).resolves.toBeNull();
  });

  it("rejects a name that does not end in .up.id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).includes("/api/v2/")
          ? holdings([upnameItem({ metadata: { name: "not-a-name" } })])
          : ({ ok: false, json: async () => ({}) } as unknown as Response),
      ),
    );
    await expect(resolveUpIdName(HOLDER)).resolves.toBeNull();
  });
});

describe("registry identification", () => {
  it("recognises the deployed adapter regardless of casing", () => {
    expect(isRealUpIdRegistry(UP_ID_READER_REGISTRY)).toBe(true);
    expect(isRealUpIdRegistry(UP_ID_READER_REGISTRY.toLowerCase())).toBe(true);
  });

  /** The mock must never be mistaken for the real thing — the UI copy differs. */
  it("does not recognise the mock registry or an absent one", () => {
    expect(isRealUpIdRegistry("0xA82EDb5e111c31C63E06EF0007f2fa1a9e7EB30d")).toBe(false);
    expect(isRealUpIdRegistry(undefined)).toBe(false);
  });

  it("accepts the real name observed on chain", () => {
    expect(isValidUpId("9ojdddq3.up.id")).toBe(true);
    expect(isValidUpId("gsucoin.up.id")).toBe(true);
  });
});
