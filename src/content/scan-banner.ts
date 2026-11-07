import type { HtmlFinding } from '../shared/protocol.ts'

/**
 * Turns what the sandbox found in an HTML file into the modal's warning bar, or
 * into no bar at all.
 *
 * No wording here may call a file safe or checked-clean. A clean scan means only
 * that nothing was found, and the scanner cannot see a form drawn as a picture.
 * The line says what is in the file, and an empty result says nothing.
 *
 * The findings are codes rather than strings, so nothing from the file can reach
 * this bar. An unrecognised code is dropped.
 */

export type BannerLevel = 'notice' | 'caution' | 'danger'

export interface Banner {
  level: BannerLevel
  text: string
}

const LEVELS: Record<HtmlFinding, BannerLevel> = {
  obfuscated: 'danger',
  redirect: 'danger',
  password: 'caution',
  login: 'caution',
  embedded: 'caution',
  unchecked: 'caution',
  scripts: 'notice',
  inputs: 'notice',
  remote: 'notice',
}

/** In the order they are read, most serious first. */
const ORDER: HtmlFinding[] = [
  'obfuscated',
  'redirect',
  'unchecked',
  'password',
  'login',
  'embedded',
  'scripts',
  'inputs',
  'remote',
]

function sentence(finding: HtmlFinding, scriptsOn: boolean): string {
  switch (finding) {
    case 'obfuscated':
      return scriptsOn
        ? 'This file’s scripts look deliberately disguised, and they are running. Turn them off unless you trust where it came from.'
        : 'This file’s scripts look deliberately disguised. Leave them off unless you trust where it came from.'
    case 'redirect':
      return 'This file tries to send you to another page as soon as it opens.'
    case 'unchecked':
      return 'This file could not be checked. Treat it as untrusted and never type a password into it.'
    case 'password':
      return 'This file has a password field. Don’t type a password into it.'
    case 'login':
      return 'This file looks like a sign-in page. Don’t type a password into it.'
    case 'embedded':
      return 'This file embeds another document, which was not checked.'
    case 'scripts':
      return scriptsOn
        ? 'Its scripts are running, cut off from the internet and your Google account.'
        : 'This file contains scripts. They are off.'
    case 'inputs':
      return 'It has input fields. Nothing typed here can leave this preview.'
    case 'remote':
      return 'Images, styles or scripts it links to on the internet were not loaded.'
  }
}

export function bannerFor(findings: readonly HtmlFinding[], scriptsOn: boolean): Banner | null {
  const present = ORDER.filter((finding) => findings.includes(finding))
  const worst = present[0]
  if (worst === undefined) return null

  // `obfuscated` says everything the plain script line would.
  const lines = present.filter((f) => !(f === 'scripts' && present.includes('obfuscated')))

  return {
    level: LEVELS[worst],
    text: lines.map((finding) => sentence(finding, scriptsOn)).join(' '),
  }
}
