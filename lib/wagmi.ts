import { createConfig, http, cookieStorage, createStorage } from "wagmi";
import { injected } from "wagmi/connectors";
import { GIWA_RPC_FLASHBLOCKS, GIWA_RPC_HTTP, giwaSepolia } from "./giwa";

/**
 * Wagmi config for GIWA Sepolia.
 *
 * `injected()` covers GIWA Wallet, MetaMask, Rabby and every other EIP-6963
 * provider — GIWA Wallet's in-app dApp browser injects on the same standard,
 * so the same button works inside and outside the wallet.
 *
 * `ssr: true` + cookie storage stops the connect button from flashing
 * "Connect" on hydration for an already-connected reader.
 */
export function createWagmiConfig() {
  return createConfig({
    chains: [giwaSepolia],
    connectors: [injected({ shimDisconnect: true })],
    storage: createStorage({ storage: cookieStorage }),
    ssr: true,
    transports: {
      [giwaSepolia.id]: http(GIWA_RPC_HTTP, {
        batch: true,
        retryCount: 2,
      }),
    },
  });
}

/**
 * Separate transport aimed at the Flashblocks RPC. Reward claims are polled
 * against this so a receipt surfaces in ~200ms of preconfirmation rather than
 * waiting a full ~1s sealed block — the difference between a reward that feels
 * instant and one that feels like a pending transaction.
 */
export const flashblocksTransport = http(GIWA_RPC_FLASHBLOCKS, {
  batch: false,
  retryCount: 1,
});

declare module "wagmi" {
  interface Register {
    config: ReturnType<typeof createWagmiConfig>;
  }
}
