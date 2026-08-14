import { NextResponse } from 'next/server';
import { publicClient, getTreasuryClient, getReferrer, getTreasuryAddress } from '@/lib/megapot/client';
import { CONTRACTS, txUrl } from '@/lib/megapot/addresses';
import { JACKPOT_ABI } from '@/lib/megapot/abi';
import { referralFeesOwed, getCurrentDrawing } from '@/lib/megapot/drawing';

export const dynamic = 'force-dynamic';

/**
 * Referral revenue.
 *
 * Megapot pays a share of ticket price to whoever is named as referrer on a
 * purchase, plus a share of that player's winnings. Rally Vault names itself on
 * every ticket it buys, so this money accrues on the Jackpot contract from the
 * first race — and until now there was no code path that could ever collect it,
 * which made the whole referral wiring decorative.
 *
 * GET  reports what has accrued. Safe, read-only, no auth.
 * POST calls `claimReferralFees()` from the treasury, sweeping it to the
 *      treasury wallet.
 *
 * The POST is gated on a shared secret because it moves money. It is not gated
 * on "is this the treasury" — the contract already guarantees fees only ever go
 * to the address that earned them, so the worst an attacker could do by calling
 * it is pay our gas to send us our own money. The secret is there to stop that
 * being free, not to protect the funds.
 */

const ADMIN_SECRET = process.env.RALLY_ADMIN_SECRET;

/** The address fees accrue to: whoever we name as referrer on purchases. */
function referralAccount(): `0x${string}` | null {
  return getReferrer() ?? getTreasuryAddress();
}

export async function GET() {
  const account = referralAccount();
  if (!account) {
    return NextResponse.json({
      ok: true,
      configured: false,
      note:
        'No referrer is configured, so purchases pass empty referral arrays and earn nothing. ' +
        'Set NEXT_PUBLIC_REFERRER_ADDRESS (or a treasury key) to start earning.',
    });
  }

  try {
    const [owed, drawing] = await Promise.all([referralFeesOwed(account), getCurrentDrawing()]);

    return NextResponse.json({
      ok: true,
      configured: true,
      account,
      owedUnits: owed.toString(),
      // Read live rather than assumed — these are per-drawing protocol state.
      referralFeePct: Number(drawing.referralFee) / 1e16,
      referralWinSharePct: Number(drawing.referralWinShare) / 1e16,
      claimable: owed > 0n,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { ok: false, error: 'Set RALLY_ADMIN_SECRET to enable referral collection.' },
      { status: 404 },
    );
  }

  const provided =
    req.headers.get('x-admin-secret') ??
    new URL(req.url).searchParams.get('secret') ??
    '';
  if (provided !== ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: 'Unauthorised' }, { status: 401 });
  }

  const account = referralAccount();
  if (!account) {
    return NextResponse.json(
      { ok: false, error: 'No referrer configured — there is nothing to claim.' },
      { status: 400 },
    );
  }

  try {
    const owed = await referralFeesOwed(account);
    if (owed <= 0n) {
      return NextResponse.json({ ok: true, claimedUnits: '0', txHash: null, note: 'Nothing accrued yet.' });
    }

    const { wallet, account: signer } = getTreasuryClient();

    // Fees are paid to msg.sender, so the treasury must BE the referrer. If a
    // separate referrer address was configured, that wallet has to claim its own
    // fees — say so rather than sending a transaction that credits the wrong one.
    if (signer.address.toLowerCase() !== account.toLowerCase()) {
      return NextResponse.json(
        {
          ok: false,
          error:
            `Referral fees accrue to ${account}, but the treasury signs as ${signer.address}. ` +
            `claimReferralFees() pays msg.sender, so this must be called by the referrer wallet.`,
        },
        { status: 409 },
      );
    }

    const hash = await wallet.writeContract({
      address: CONTRACTS.jackpot,
      abi: JACKPOT_ABI,
      functionName: 'claimReferralFees',
      args: [],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success') {
      return NextResponse.json({ ok: false, error: 'The claim transaction reverted.' }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      claimedUnits: owed.toString(),
      txHash: hash,
      explorerUrl: txUrl(hash),
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
