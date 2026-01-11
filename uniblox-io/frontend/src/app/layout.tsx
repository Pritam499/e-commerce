import type { Metadata } from 'next'
import './globals.css'
import Header from '@/src/components/Header'

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
        <Header />
        {children}
      </body>
    </html>
  )
}
