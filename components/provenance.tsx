/**
 * Evidence provenance.
 *
 * Two separate facts, deliberately not merged into one indicator:
 *
 *   1. Where the evidence on this page actually came from.
 *   2. Whether a Razorpay connector is configured at all.
 *
 * Merging them is the tempting mistake, and it is the dishonest one. A page that
 * lights up "Razorpay API" because credentials happen to be present — while
 * still rendering committed fixtures — is claiming a provenance it does not
 * have. So the source badge is derived from the pack that was actually rendered,
 * and the connector line only ever describes configuration.
 *
 * This is a provenance strip, not a feature. It is small on purpose.
 */


export type EvidenceSourceKind = 'fixture' | 'razorpay_api'

export function ProvenanceStrip({
  source,
  connector,
}: {
  source: EvidenceSourceKind
  /** Configuration state only. Never used to label the data. */
  connector: { configured: boolean; mode: 'test' | 'live' | null }
}) {
  const live = source === 'razorpay_api'
  return (
    <span
      className="text-mini text-muted-foreground"
      title={
        live
          ? 'Fetched from the Razorpay API and normalised by lib/connectors/razorpay.ts'
          : 'The CSV ledger committed to this repository'
      }
    >
      source ·{' '}
      <span className={live ? 'text-[hsl(var(--verdict-verified))]' : 'text-foreground'}>
        {live ? 'Razorpay API' : 'AVOS fixture'}
      </span>
      <span aria-hidden className="mx-1.5 opacity-40">
        |
      </span>
      <span aria-hidden className="mr-1">
        {connector.configured ? '\u25CF' : '\u25CB'}
      </span>
      connector {connector.configured ? connector.mode : 'off'}
    </span>
  )
}
