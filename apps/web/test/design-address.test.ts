import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PassUnreachable } from '../src/components/design/PassUnreachable'
import { designAddress, designPingAddress } from '../src/lib/design-address'

/**
 * Where a design opens (designs-and-the-plan-get-their-own-place decisions 23,
 * 26): through the pass-through on the page's own host and protocol, so it
 * opens wherever runcastle does — never the design server's localhost URL.
 */
describe('designAddress', () => {
  it('keeps the page’s own protocol and host, on the pass-through’s port', () => {
    expect(designAddress({ protocol: 'http:', hostname: 'localhost' }, 4514, 'feat_1', '/preview/cart.html')).toBe(
      'http://localhost:4514/__runcastle/open/feat_1?path=%2Fpreview%2Fcart.html',
    )
    expect(designAddress({ protocol: 'https:', hostname: 'desk.tail1234.ts.net' }, 4514, 'feat_1', '/x')).toBe(
      'https://desk.tail1234.ts.net:4514/__runcastle/open/feat_1?path=%2Fx',
    )
  })

  it('encodes the path and the feature id, and opens / without a path', () => {
    expect(designAddress({ protocol: 'http:', hostname: '10.0.0.5' }, 5002, 'a b', '/p?q=1&r=2#h')).toBe(
      'http://10.0.0.5:5002/__runcastle/open/a%20b?path=%2Fp%3Fq%3D1%26r%3D2%23h',
    )
    expect(designAddress({ protocol: 'http:', hostname: '10.0.0.5' }, 5002, 'f')).toBe('http://10.0.0.5:5002/__runcastle/open/f?path=%2F')
  })

  it('brackets an IPv6 host, as a Tailscale address can be, once', () => {
    expect(designAddress({ protocol: 'http:', hostname: '[fd7a:115c:a1e0::1]' }, 4514, 'f', '/')).toBe(
      'http://[fd7a:115c:a1e0::1]:4514/__runcastle/open/f?path=%2F',
    )
    expect(designPingAddress({ protocol: 'http:', hostname: 'fd7a:115c:a1e0::1' }, 4514)).toBe(
      'http://[fd7a:115c:a1e0::1]:4514/__runcastle/ping',
    )
  })
})

describe('PassUnreachable', () => {
  it('names the port to forward on this host, with the tunnel that forwards it, and offers Retry', () => {
    const html = renderToStaticMarkup(createElement(PassUnreachable, { hostname: 'vps.example', passPort: 4514, onRetry: () => {} }))
    expect(html).toContain('cannot reach port 4514 on vps.example')
    expect(html).toContain('ssh -L 4512:localhost:4512 -L 4514:localhost:4514 &lt;host&gt;')
    expect(html).toContain('Retry')
  })
})
