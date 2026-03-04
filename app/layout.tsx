import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Providers } from '@/providers'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

// Font configurations
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

// Metadata configuration
export const metadata: Metadata = {
  title: {
    default: 'RepoLens',
    template: '%s | RepoLens',
  },
  description: 'RepoLens Analysis Tool For Github',
  keywords: ['React', 'Next.js', 'TypeScript', 'AI', 'GitHub', 'Code Analysis'],
  authors: [{ name: 'RepoLens' }],
  creator: 'RepoLens',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    title: 'RepoLens',
    description: 'RepoLens Analysis Tool For Github',
    siteName: 'RepoLens',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'RepoLens',
    description: 'RepoLens Analysis Tool For Github',
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
}

// Viewport configuration
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
}

// Root layout component
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
      </head>
      <body className="font-sans antialiased" suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
