import { createPublicClient, http, formatEther } from "viem";
import { syndixTreasuryAbi } from "./abi";
import {
  GIWA_RPC_HTTP,
  IS_LIVE_CHAIN,
  SYNDIX_CONTRACTS,
  giwaSepolia,
} from "./giwa";

/**
 * Live protocol state, read from SyndixTreasury on GIWA Sepolia.
 *
 * This is the difference between a page that claims numbers and a page that
 * proves them: every figure below is fetched from the deployed contract at
 * request time. When nothing is deployed, `live` is false and the caller is
 * expected to say so rather than substitute the editorial dataset.
 */

export interface LiveProtocolStats {
  live: true;
  articleCount: number;
  uniqueReaders: number;
  totalProtocolVolumeWei: bigint;
  totalRewardDistributedWei: bigint;
  reservedRewardsWei: bigint;
  treasuryBalanceWei: bigint;
  unreservedBalanceWei: bigint;
  /** Wei per unit gas at the time of reading. */
  gasPriceWei: bigint;
  blockNumber: bigint;
  /** `balance >= reservedRewards` — the solvency invariant, checked live. */
  solvent: boolean;
}

export interface OfflineProtocolStats {
  live: false;
  reason: string;
}

export type ProtocolChainStats = LiveProtocolStats | OfflineProtocolStats;

export async function readProtocolChainStats(): Promise<ProtocolChainStats> {
  if (!IS_LIVE_CHAIN) {
    return {
      live: false,
      reason:
        "No SyndixTreasury address is configured, so there is no chain state to read.",
    };
  }

  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: http(GIWA_RPC_HTTP, { timeout: 10_000, retryCount: 1 }),
    });
    const treasury = SYNDIX_CONTRACTS.treasury;
    const common = { address: treasury, abi: syndixTreasuryAbi } as const;

    const [
      articleCount,
      uniqueReaders,
      totalProtocolVolume,
      totalRewardDistributed,
      reservedRewards,
      unreservedBalance,
      treasuryBalance,
      gasPriceWei,
      blockNumber,
    ] = await Promise.all([
      client.readContract({ ...common, functionName: "articleCount" }),
      client.readContract({ ...common, functionName: "uniqueReaders" }),
      client.readContract({ ...common, functionName: "totalProtocolVolume" }),
      client.readContract({ ...common, functionName: "totalRewardDistributed" }),
      client.readContract({ ...common, functionName: "reservedRewards" }),
      client.readContract({ ...common, functionName: "unreservedBalance" }),
      client.getBalance({ address: treasury }),
      client.getGasPrice(),
      client.getBlockNumber(),
    ]);

    return {
      live: true,
      articleCount: Number(articleCount),
      uniqueReaders: Number(uniqueReaders),
      totalProtocolVolumeWei: totalProtocolVolume,
      totalRewardDistributedWei: totalRewardDistributed,
      reservedRewardsWei: reservedRewards,
      treasuryBalanceWei: treasuryBalance,
      unreservedBalanceWei: unreservedBalance,
      gasPriceWei,
      blockNumber,
      solvent: treasuryBalance >= reservedRewards,
    };
  } catch (error) {
    return {
      live: false,
      reason: `GIWA Sepolia was unreachable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

/** Gas a claim costs, measured from the first real claim rather than estimated. */
export const MEASURED_CLAIM_GAS = 180_313n;

export interface ClaimEconomics {
  gasCostWei: bigint;
  rewardWei: bigint;
  /** How many times the reward exceeds the gas needed to deliver it. */
  ratio: number;
  gasCostEth: string;
  rewardEth: string;
}

/**
 * The argument for building this on an L2 at all: on GIWA the reward dwarfs its
 * own delivery cost. Invert the ratio and the product cannot exist.
 */
export function claimEconomics(
  gasPriceWei: bigint,
  rewardWei: bigint,
): ClaimEconomics {
  const gasCostWei = MEASURED_CLAIM_GAS * gasPriceWei;
  const ratio =
    gasCostWei === 0n ? 0 : Number((rewardWei * 1000n) / gasCostWei) / 1000;
  return {
    gasCostWei,
    rewardWei,
    ratio,
    gasCostEth: formatEther(gasCostWei),
    rewardEth: formatEther(rewardWei),
  };
}
