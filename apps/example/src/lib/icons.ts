import {
  siAngular,
  siAstro,
  siBun,
  siCloudflareworkers,
  siDjango,
  siDocker,
  siDocusaurus,
  siEleventy,
  siFlask,
  siFlydotio,
  siFramer,
  siGatsby,
  siGhost,
  siGoogletagmanager,
  siHtml5,
  siHugo,
  siJekyll,
  siLaravel,
  siNeon,
  siNetlify,
  siNextdotjs,
  siNodedotjs,
  siNuxt,
  siPostgresql,
  siQwik,
  siRailway,
  siReact,
  siReactrouter,
  siRender,
  siRubyonrails,
  siShopify,
  siSolid,
  siSqlite,
  siSupabase,
  siSvelte,
  siVercel,
  siVuedotjs,
  siWebflow,
  siWordpress,
  type SimpleIcon,
} from 'simple-icons'

import type { ServerTarget, SiteTarget } from './prompts'

/** Brand marks (simple-icons, CC0) per option: the platform first, then the database or runtime. */
export const SERVER_ICONS: Record<ServerTarget, readonly SimpleIcon[]> = {
  'cloudflare-d1': [siCloudflareworkers],
  'vercel-supabase': [siVercel, siSupabase],
  'vercel-neon': [siVercel, siNeon],
  'railway-postgres': [siRailway, siPostgresql],
  'render-postgres': [siRender, siPostgresql],
  'fly-sqlite': [siFlydotio, siSqlite],
  'netlify-supabase': [siNetlify, siSupabase],
  'docker-bun-sqlite': [siDocker, siBun],
  'node-postgres': [siNodedotjs, siPostgresql],
}

export const SITE_ICONS: Record<SiteTarget, readonly SimpleIcon[]> = {
  html: [siHtml5],
  'react-vite': [siReact],
  nextjs: [siNextdotjs],
  remix: [siReactrouter],
  vue: [siVuedotjs],
  nuxt: [siNuxt],
  astro: [siAstro],
  sveltekit: [siSvelte],
  angular: [siAngular],
  solidstart: [siSolid],
  qwik: [siQwik],
  gatsby: [siGatsby],
  docusaurus: [siDocusaurus],
  hugo: [siHugo],
  jekyll: [siJekyll],
  eleventy: [siEleventy],
  wordpress: [siWordpress],
  shopify: [siShopify],
  webflow: [siWebflow],
  framer: [siFramer],
  ghost: [siGhost],
  laravel: [siLaravel],
  rails: [siRubyonrails],
  django: [siDjango],
  flask: [siFlask],
  gtm: [siGoogletagmanager],
}

const luminance = (hex: string): number => {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

const TEXT = 'var(--text)'

/**
 * The brand colour for a light and a dark tile. Marks that would vanish on the tile (near-black ones such as Vercel
 * on a dark surface, very pale ones on white) use the text colour instead.
 */
export const iconColors = (hex: string): { light: string; dark: string } => ({
  light: contrast(hex, 'ffffff') >= 1.5 ? `#${hex}` : TEXT,
  dark: contrast(hex, '1c1b18') >= 2.5 ? `#${hex}` : TEXT,
})
