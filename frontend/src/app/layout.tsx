import type { Metadata } from 'next'
import './globals.css'
import Header from '@/src/components/Header'
import GDPRConsentBanner from '@/src/components/GDPRConsentBanner'
import WebSocketInitializer from '@/src/components/WebSocketInitializer'

export const metadata: Metadata = {
  title: 'UniShop - Ecommerce Platform',
  description: 'E-commerce store with cart and checkout functionality',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <WebSocketInitializer />
        <Header />
        {children}
        <GDPRConsentBanner />
      </body>
    </html>
  )
}
