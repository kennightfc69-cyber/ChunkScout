/* ChunkScout advertising configuration. Every ad and sponsorship on the site is controlled from this file.
   Nothing loads, and every ad container stays hidden, until `enabled` is true AND a real publisher ID is set.

   After AdSense approval:
   1. publisherId: your "ca-pub-..." ID (AdSense > Account > Account information).
   2. For each placement you want, create a Display ad unit in AdSense (Ads > By ad unit) and paste its
      numeric "data-ad-slot" value into `unit`.
   3. Set enabled: true, commit and push. Cloudflare deploys automatically.
   4. Add /ads.txt at the repo root with the line AdSense shows you (Sites > your site > ads.txt), e.g.
      google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0
   5. In AdSense > Privacy & messaging, publish a GDPR/consent message (a Google-certified consent tool).
      Keep useGoogleConsent: true so ChunkScout relies on it instead of its own banner. */
window.CS_ADS = {
  enabled: false,              // master switch for AdSense
  publisherId: '',             // 'ca-pub-XXXXXXXXXXXXXXXX'
  useGoogleConsent: true,      // true: AdSense's own consent message handles consent (recommended)
  sidebar: true,               // allow desktop sidebar placements
  pages: { home: true, tool: true, directory: true, guide: true, page: false }, // page types that may show ads
  slots: {
    'homepage-banner': { enabled: true, unit: '', format: 'horizontal' },
    'homepage-middle': { enabled: true, unit: '', format: 'horizontal' },
    'homepage-bottom': { enabled: true, unit: '', format: 'horizontal' },
    'tool-top':        { enabled: true, unit: '', format: 'horizontal' },
    'tool-bottom':     { enabled: true, unit: '', format: 'horizontal' },
    'tool-sidebar':    { enabled: true, unit: '', format: 'sidebar' },
    'tool-end':        { enabled: true, unit: '', format: 'horizontal' },
    'directory-middle':{ enabled: true, unit: '', format: 'horizontal' },
    'directory-bottom':{ enabled: true, unit: '', format: 'horizontal' },
    'guide-top':       { enabled: true, unit: '', format: 'horizontal' },
    'guide-inline':    { enabled: true, unit: '', format: 'inline' },
    'guide-sidebar':   { enabled: true, unit: '', format: 'sidebar' },
    'guide-end':       { enabled: true, unit: '', format: 'horizontal' }
  },
  /* Direct sponsorships: shown with a "Sponsored" label, independent of AdSense.
     Use only creative the advertiser has approved. Example:
     { slot: 'homepage-middle', title: 'Example Hosting', text: 'Minecraft servers from $3/mo',
       url: 'https://example.com/?ref=chunkscout', image: '/assets/sponsors/example.png', active: true } */
  sponsors: []
};
