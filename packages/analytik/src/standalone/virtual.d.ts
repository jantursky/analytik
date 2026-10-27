declare module 'virtual:analytik-standalone' {
  /** The dashboard app, its stylesheet and the tracker script, built into strings at package build time. */
  const assets: { js: string; css: string; tracker: string }
  export default assets
}
