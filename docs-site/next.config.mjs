import nextra from 'nextra'

const withNextra = nextra({
  defaultShowCopyCode: true,
})

export default withNextra({
  images: { unoptimized: true },
  turbopack: {
    root: import.meta.dirname,
    resolveAlias: {
      'next-mdx-import-source-file': './mdx-components.js',
    },
  },
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
