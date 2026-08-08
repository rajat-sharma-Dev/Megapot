/**
 * Megapot contract addresses.
 *
 * Source of truth: https://llms.megapot.io/abi/index.json
 * Verified 8 August 2026.
 *
 * NOTE: the address `0xbEDd4F2beBE9E3E636161E644759f3cbe3d51B95` that circulates
 * in older write-ups is STALE. Do not use it.
 */

export const CHAIN_IDS = {
  mainnet: 8453, // Base
  testnet: 84532, // Base Sepolia
} as const;

export type MegapotNetwork = keyof typeof CHAIN_IDS;

export const ADDRESSES = {
  mainnet: {
    jackpot: '0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2',
    randomTicketBuyer: '0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd',
    ticketNFT: '0x48FfE35AbB9f4780a4f1775C2Ce1c46185b366e4',
    batchPurchaseFacilitator: '0xBA343479D98a1Ed333899999D95a7343B808a76F',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  testnet: {
    jackpot: '0x465dA3c859f193A3807386387bEE941B2A4c3279',
    randomTicketBuyer: '0x53c04e7e5044B28Ea8A4F9c4b26E3Ac1aeb63746',
    ticketNFT: '0x45084829ac63f9dC6a3D4981A46FA896f9180ECd',
    batchPurchaseFacilitator: '0x62A5D60F486D01a28071652a7951Aff1EA4c5b7c',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
} as const satisfies Record<MegapotNetwork, Record<string, `0x${string}`>>;

/** The network this build targets. Flip via NEXT_PUBLIC_MEGAPOT_NETWORK. */
export const NETWORK: MegapotNetwork =
  (process.env.NEXT_PUBLIC_MEGAPOT_NETWORK as MegapotNetwork) ?? 'testnet';

export const CONTRACTS = ADDRESSES[NETWORK];
export const CHAIN_ID = CHAIN_IDS[NETWORK];

/** Data API base. Testnet has its own host. */
export const DATA_API_BASE =
  NETWORK === 'mainnet'
    ? 'https://api.megapot.io/v1'
    : 'https://api-testnet.megapot.io/v1';

export const BASESCAN_BASE =
  NETWORK === 'mainnet' ? 'https://basescan.org' : 'https://sepolia.basescan.org';

export const txUrl = (hash: string) => `${BASESCAN_BASE}/tx/${hash}`;
