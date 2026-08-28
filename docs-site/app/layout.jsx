import { getPageMap } from 'nextra/page-map'
import { Head } from 'nextra/components'
import { Footer, Layout, Navbar } from 'nextra-theme-docs'
import 'nextra-theme-docs/style.css'
import '../styles/globals.css'

export const metadata = {
  title: {
    default: 'EverDraw Docs',
    template: '%s - EverDraw Docs',
  },
  description: 'EverDraw - prize savings protocol on Monad. Win the pot, or keep your lot.',
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
}

const navbar = (
  <Navbar
    logo={<span style={{ fontWeight: 800, fontSize: '1.2rem', letterSpacing: 0 }}>EverDraw</span>}
    projectLink="https://github.com/Gmankey/everdraw"
  />
)

const footer = <Footer>Copyright 2026 EverDraw. Win the pot, or keep your lot.</Footer>

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <Head color={{ hue: 265 }} />
      </head>
      <body>
        <Layout
          navbar={navbar}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/Gmankey/everdraw/tree/staging/docs-site/content"
          footer={footer}
          darkMode
          nextThemes={{ defaultTheme: 'dark' }}
          sidebar={{ defaultMenuCollapseLevel: 1, toggleButton: true }}
        >
          {children}
        </Layout>
      </body>
    </html>
  )
}
