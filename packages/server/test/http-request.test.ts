import { describe, expect, it } from 'vitest'
import { fillHttpRequest, parseHttpRequest } from '../src/services/http-request'

/** The `.http` request of an API scenario, parsed and filled (drive-scenarios decision 10). */

describe('parseHttpRequest', () => {
  const cases: Array<{ name: string; text: string; request: unknown }> = [
    {
      name: 'a JSON body after headers',
      text: [
        'POST /api/feed HTTP/1.1',
        'Authorization: Bearer {{token}}',
        'Content-Type: application/json',
        '',
        '{',
        '  "run": "{{run}}"',
        '}',
        '',
      ].join('\n'),
      request: {
        method: 'POST',
        target: '/api/feed',
        headers: [
          ['Authorization', 'Bearer {{token}}'],
          ['Content-Type', 'application/json'],
        ],
        body: '{\n  "run": "{{run}}"\n}',
      },
    },
    {
      name: 'no headers and no body',
      text: 'GET /health',
      request: { method: 'GET', target: '/health', headers: [] },
    },
    {
      name: 'a bare target, which means GET',
      text: 'https://example.com/x',
      request: { method: 'GET', target: 'https://example.com/x', headers: [] },
    },
    {
      name: 'leading blanks and comments, and comments in the header block',
      text: ['', '# the feed', '// blocked only', '', 'delete /api/x', '# skip me', 'X-A: 1', ''].join('\n'),
      request: { method: 'DELETE', target: '/api/x', headers: [['X-A', '1']] },
    },
    {
      name: 'a CRLF file',
      text: 'PUT /a HTTP/2\r\nX-A: b\r\n\r\nhello\r\n',
      request: { method: 'PUT', target: '/a', headers: [['X-A', 'b']], body: 'hello' },
    },
    {
      name: 'a ### separator ending the request, later ones ignored',
      text: ['POST /a', '', 'one', '### second', 'GET /b'].join('\n'),
      request: { method: 'POST', target: '/a', headers: [], body: 'one' },
    },
    {
      name: 'a ### separator right after the headers',
      text: ['GET /a', 'X-A: 1', '###', 'GET /b'].join('\n'),
      request: { method: 'GET', target: '/a', headers: [['X-A', '1']] },
    },
    {
      name: 'a whitespace-only body as none',
      text: 'POST /a\n\n   \n\n',
      request: { method: 'POST', target: '/a', headers: [] },
    },
  ]

  it.each(cases)('parses $name', ({ text, request }) => {
    expect(parseHttpRequest(text)).toEqual({ ok: true, request })
  })

  it.each([
    ['an empty file', ''],
    ['only comments', '# nothing\n// here\n'],
    ['only a separator', '###\nGET /a'],
    ['a malformed request line', 'GET /a b c'],
    ['a malformed header', 'GET /a\nnot a header'],
  ])('fails on %s', (_name, text) => {
    expect(parseHttpRequest(text)).toEqual({ ok: false, error: expect.any(String) })
  })
})

describe('fillHttpRequest', () => {
  const tpl = {
    method: 'POST',
    target: '/api/items?run={{run}}',
    headers: [['Authorization', 'Bearer {{ token }}'], ['X-Other', '{{other}}']] as Array<[string, string]>,
    body: '{"buyer":"buyer_{{run}}","t":"{{token}}"}',
  }

  it('fills token and run, keeps unknown placeholders, resolves against the drive URL', () => {
    expect(fillHttpRequest(tpl, { token: 'tok', run: '7f3a', driveUrl: 'http://127.0.0.1:5199/' })).toEqual({
      method: 'POST',
      url: 'http://127.0.0.1:5199/api/items?run=7f3a',
      headers: [['Authorization', 'Bearer tok'], ['X-Other', '{{other}}']],
      body: '{"buyer":"buyer_7f3a","t":"tok"}',
    })
  })

  it('leaves {{token}} verbatim with no token, and keeps an absolute target', () => {
    const filled = fillHttpRequest(
      { method: 'GET', target: 'http://other.test/x', headers: [['A', '{{token}}']] },
      { run: 'r', driveUrl: 'http://127.0.0.1:5199/' },
    )
    expect(filled).toEqual({ method: 'GET', url: 'http://other.test/x', headers: [['A', '{{token}}']] })
  })
})
