import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AVOS Verify — evidence-backed verification for AI-operated finance',
  description:
    'An agent-independent verifier for settlement assurance. AVOS does not trust agent prose: it recomputes every financial claim from source evidence under the policy in force at decision time, and returns VERIFIED, UNCERTAIN or FAILED.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
