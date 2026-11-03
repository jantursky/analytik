declare module 'virtual:analytik-standalone' {
  /** The dashboard app, its stylesheet and the tracker script and its opt-in vitals script, built into strings at package build time. */
  const assets: { js: string; css: string; tracker: string; vitals: string }
  export default assets
}

declare module '*.svg?raw' {
  const source: string
  export default source
}
