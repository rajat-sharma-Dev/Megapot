import jackpotAbi from './Jackpot.json';
import randomTicketBuyerAbi from './JackpotRandomTicketBuyer.json';
import ticketNftAbi from './JackpotTicketNFT.json';
import batchPurchaseAbi from './BatchPurchaseFacilitator.json';
import type { Abi } from 'viem';

/** ABIs pulled verbatim from https://llms.megapot.io/abi/<Name>.json (8 Aug 2026). */
export const JACKPOT_ABI = jackpotAbi as Abi;
export const RANDOM_TICKET_BUYER_ABI = randomTicketBuyerAbi as Abi;
export const TICKET_NFT_ABI = ticketNftAbi as Abi;
export const BATCH_PURCHASE_ABI = batchPurchaseAbi as Abi;

/** Minimal ERC-20 surface we need for the USDC approve/allowance dance. */
export const ERC20_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
] as const satisfies Abi;
