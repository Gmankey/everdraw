export default {
  logo: (
    <span style={{ fontWeight: 800, fontSize: '1.2rem', letterSpacing: '-0.02em' }}>
      EverDraw
    </span>
  ),
  project: {
    link: 'https://github.com/Gmankey/everdraw',
  },
  docsRepositoryBase: 'https://github.com/Gmankey/everdraw/tree/main/docs-site',
  footer: {
    text: '© 2026 EverDraw. Win the pot, or keep your lot.',
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s – EverDraw Docs',
    }
  },
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta name="description" content="EverDraw — prize savings protocol on Monad. Win the pot, or keep your lot." />
    </>
  ),
  primaryHue: 265,
  darkMode: true,
  nextThemes: {
    defaultTheme: 'dark',
  },
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
}
