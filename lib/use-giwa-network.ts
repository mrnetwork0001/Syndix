"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import {
  GIWA_EXPLORER,
  GIWA_RPC_HTTP,
  GIWA_SEPOLIA_ID,
  giwaSepolia,
} from "./giwa";

const USER_REJECTED = 4001;

interface ProviderError {
  code?: number;
  message?: string;
  cause?: { code?: number };
}

function errorCode(error: unknown): number | undefined {
  const e = error as ProviderError | undefined;
  return e?.code ?? e?.cause?.code;
}

/**
 * Keeps the wallet on GIWA Sepolia.
 *
 * Two things the default `switchChain` alone does not handle:
 *
 * 1. GIWA is not in any wallet's built-in network list, so a first-time user
 *    gets error 4902 rather than a switch prompt. We fall back to an explicit
 *    `wallet_addEthereumChain`, which both adds and selects the network.
 * 2. `useChainId()` reports the wagmi config's chain, not the wallet's, so it
 *    reads as correct even when the wallet is on Ethereum mainnet. The live
 *    value is `useAccount().chainId`.
 */
export function useGiwaNetwork() {
  const { chainId, isConnected, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** One automatic attempt per connection; after that it is user-driven. */
  const autoTried = useRef<string | null>(null);

  const onWrongNetwork = isConnected && chainId !== undefined && chainId !== GIWA_SEPOLIA_ID;

  const addGiwaToWallet = useCallback(async () => {
    const provider = (await connector?.getProvider?.()) as
      | { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
      | undefined;
    if (!provider?.request) {
      throw new Error("Wallet does not expose an EIP-1193 provider.");
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${GIWA_SEPOLIA_ID.toString(16)}`,
          chainName: giwaSepolia.name,
          nativeCurrency: giwaSepolia.nativeCurrency,
          rpcUrls: [GIWA_RPC_HTTP],
          blockExplorerUrls: [GIWA_EXPLORER],
        },
      ],
    });
  }, [connector]);

  const switchToGiwa = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await switchChainAsync({ chainId: GIWA_SEPOLIA_ID });
    } catch (caught) {
      const code = errorCode(caught);
      if (code === USER_REJECTED) {
        setError("Network switch declined in your wallet.");
        setPending(false);
        return;
      }
      // Anything else is treated as "wallet does not know this chain". The
      // canonical code is 4902, but wallets are inconsistent here (some return
      // -32603, some a bare Error), so we attempt the add rather than matching.
      try {
        await addGiwaToWallet();
      } catch (addError) {
        const addCode = errorCode(addError);
        setError(
          addCode === USER_REJECTED
            ? "Adding GIWA Sepolia was declined in your wallet."
            : addError instanceof Error
              ? addError.message.split("\n")[0]
              : "Could not add GIWA Sepolia to this wallet.",
        );
      }
    } finally {
      setPending(false);
    }
  }, [switchChainAsync, addGiwaToWallet]);

  // Prompt once as soon as we see a connected wallet on the wrong chain, so the
  // reader is not left to notice a badge on their own.
  useEffect(() => {
    if (!onWrongNetwork || !connector) return;
    const key = `${connector.uid}:${chainId}`;
    if (autoTried.current === key) return;
    autoTried.current = key;
    void switchToGiwa();
  }, [onWrongNetwork, connector, chainId, switchToGiwa]);

  return {
    chainId,
    isConnected,
    onWrongNetwork,
    pending,
    error,
    switchToGiwa,
    expectedChainId: GIWA_SEPOLIA_ID,
  };
}
