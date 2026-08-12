/**
 * The two ERC-20 calls the browser makes.
 *
 * Deliberately a separate, tiny ABI rather than importing the shared one from
 * `lib/megapot/abi`: that module pulls in the full Jackpot ABI, which is ~2,500
 * lines of JSON that would then be bundled into the client for the sake of a
 * `transfer`.
 */
export const ERC20_MINIMAL_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
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
] as const;
