import nextra from 'nextra'

const withNextra = nextra({
  theme: 'nextra-theme-docs',
  themeConfig: './theme.config.jsx',
  defaultShowCopyCode: true,
})

export default withNextra({
  images: { unoptimized: true },
  async redirects() {
    return [
      {
        source: '/getting-started/buying-tickets',
        destination: '/getting-started/depositing',
        permanent: true,
      },
      {
        source: '/how-it-works/round-lifecycle',
        destination: '/how-it-works/draw-lifecycle',
        permanent: true,
      },
    ]
  },
})
