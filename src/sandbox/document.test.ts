import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDocument } from './document.ts'

/**
 * These tests are the load-bearing ones for the .md and .json features.
 *
 * Both kinds reach the same `srcdoc` sink that renders real HTML for .html
 * attachments. If escaping regresses, a JSON string containing `<script>`
 * silently becomes a script — so every case here asserts on the *absence* of
 * live markup, not just the presence of the right text.
 *
 * The JSON view also has to stay interactive without any JavaScript, because the
 * frame that renders it is built with `sandbox=""`. That is what the <details>
 * assertions guard.
 */

const XSS = '<script>alert(1)</script>'

test('json never produces live markup, in keys or values', async () => {
  const doc = await buildDocument(JSON.stringify({ [XSS]: XSS }), 'json')

  assert.doesNotMatch(doc, /<script/i)
  // Both the key and the value must survive as visible text.
  assert.equal(doc.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g)?.length, 2)
})

test('json is browsable without any JavaScript', async () => {
  const doc = await buildDocument(JSON.stringify({ user: { name: 'x' }, tags: [1, 2] }), 'json')

  // <details> is the whole interaction model — the frame has sandbox="" so a
  // script-driven tree would simply not work.
  assert.match(doc, /<details class="j-node"/)
  assert.match(doc, /<summary>/)
  assert.doesNotMatch(doc, /<script/i)
  assert.doesNotMatch(doc, /onclick=/i)
})

test('json labels each collapsed container with its size', async () => {
  const doc = await buildDocument(JSON.stringify({ a: 1, b: 2, c: 3 }), 'json')
  assert.match(doc, /3 keys/)

  const one = await buildDocument(JSON.stringify([{ x: 1 }]), 'json')
  assert.match(one, /1 item(?!s)/, 'singular, not "1 items"')
})

test('json colours values by type', async () => {
  const doc = await buildDocument(JSON.stringify({ s: 'x', n: 1.5, b: true, nil: null }), 'json')

  assert.match(doc, /<span class="j-string">&quot;x&quot;<\/span>/)
  assert.match(doc, /<span class="j-number">1\.5<\/span>/)
  assert.match(doc, /<span class="j-boolean">true<\/span>/)
  assert.match(doc, /<span class="j-null">null<\/span>/)
})

test('json expand modes change what starts open', async () => {
  const source = JSON.stringify({ a: { b: { c: { d: 1 } } } })

  const all = await buildDocument(source, 'json', { expand: 'all' })
  const none = await buildDocument(source, 'json', { expand: 'none' })
  const auto = await buildDocument(source, 'json', { expand: 'auto' })

  const openCount = (html: string) => html.match(/<details class="j-node" open>/g)?.length ?? 0

  assert.equal(openCount(none), 1, 'collapse-all keeps only the root open')
  assert.ok(openCount(all) > openCount(auto), 'expand-all opens more than the default')
  assert.ok(openCount(auto) > openCount(none), 'the default opens more than collapse-all')
})

test('empty containers stay on one line instead of becoming expandable', async () => {
  const doc = await buildDocument(JSON.stringify({ empty: {}, none: [] }), 'json')

  // Only the root is expandable; the two empty children have nothing inside.
  // Matched on the class, not on "<details" alone — the stylesheet mentions the
  // tag in a comment and would inflate a looser count.
  assert.equal(doc.match(/<details class="j-node"/g)?.length, 1)
  assert.match(doc, /&quot;empty&quot;<\/span><span class="j-punct">: <\/span><span class="j-punct">\{\}/)
  assert.match(doc, /&quot;none&quot;<\/span><span class="j-punct">: <\/span><span class="j-punct">\[\]/)
})

test('invalid json still shows the file, with the parse error', async () => {
  const broken = '{ "a": 1, }'
  const doc = await buildDocument(broken, 'json')

  assert.match(doc, /Not valid JSON/)
  assert.match(doc, /class="plain"/)
  assert.match(doc, /&quot;a&quot;/, 'the raw source is still readable')
})

test('invalid json does not become markup', async () => {
  const doc = await buildDocument(`not json ${XSS}`, 'json')

  assert.doesNotMatch(doc, /<script/i)
  assert.match(doc, /&lt;script&gt;/)
})

test('markdown renders structure but neutralises raw HTML', async () => {
  const doc = await buildDocument(`# Title\n\n${XSS}\n\n- one\n- two`, 'markdown')

  assert.match(doc, /<h1>Title<\/h1>/)
  assert.match(doc, /<li>one<\/li>/)
  assert.match(doc, /&lt;script&gt;/)
  assert.doesNotMatch(doc, /<script/i)
})

test('markdown neutralises inline HTML and event handlers', async () => {
  const doc = await buildDocument('text <img src=x onerror=alert(1)> more', 'markdown')

  assert.doesNotMatch(doc, /<img/i)
  assert.match(doc, /&lt;img src=x onerror=alert\(1\)&gt;/)
})

test('markdown code spans and fences keep their angle brackets readable', async () => {
  // Regression: escaping the source *before* parsing double-escapes here, so
  // `<b>` renders as the literal text "&lt;b&gt;" instead of "<b>".
  const doc = await buildDocument('`code <b>`\n\n```js\nif (a<b) {}\n```', 'markdown')

  assert.match(doc, /<code>code &lt;b&gt;<\/code>/)
  assert.match(doc, /<code class="language-js hljs">/)
  assert.match(doc, /\(a&lt;b\) \{\}/)
  assert.doesNotMatch(doc, /&amp;lt;/, 'double-escaped output means the pre-escape bug is back')
})

test('fenced code is syntax-coloured when the language is known', async () => {
  const doc = await buildDocument('```python\ndef f(n):\n    return "x"\n```', 'markdown')

  assert.match(doc, /<code class="language-python hljs">/)
  assert.match(doc, /<span class="hljs-keyword">def<\/span>/)
  assert.match(doc, /<span class="hljs-string">&quot;x&quot;<\/span>/)
  // The colours have to be in the document, not left to a stylesheet it cannot
  // fetch — the sandbox CSP allows no remote CSS.
  assert.match(doc, /\.hljs-keyword,?[^{]*\{[^}]*color:/)
})

test('an unknown fence language stays a plain escaped code block', async () => {
  const doc = await buildDocument(`\`\`\`brainfuck\n${XSS}\n\`\`\``, 'markdown')

  assert.match(doc, /<code class="language-brainfuck">/)
  // Matched on the span, not on "hljs" alone: the theme is in every document's
  // stylesheet whether or not anything was coloured.
  assert.doesNotMatch(doc, /<span class="hljs-/, 'nothing was coloured')
  assert.doesNotMatch(doc, /<script/i)
  assert.match(doc, /&lt;script&gt;/)
})

test('an untagged fence stays plain rather than being guessed at', async () => {
  // Auto-detection is deliberately not attempted: it is wrong often enough on
  // short snippets that mislabelled colouring would read worse than none.
  const doc = await buildDocument('```\nsome text\n```', 'markdown')

  assert.match(doc, /<pre><code>some text/)
  assert.doesNotMatch(doc, /<span class="hljs-/)
})

test('syntax colouring never turns a code fence into live markup', async () => {
  // This is the one that matters: hljs output is inserted unescaped, so a fence
  // whose *content* is markup must still come out inert.
  const doc = await buildDocument(`\`\`\`html\n${XSS}\n\`\`\``, 'markdown')

  assert.doesNotMatch(doc, /<script/i)
  // The brackets are escaped but not adjacent to the name — hljs puts the tag
  // name in its own span — so this asserts on the pieces rather than the string.
  assert.match(doc, /&lt;<span class="hljs-name">script<\/span>&gt;/)
  assert.match(doc, /hljs-/, 'and it was still coloured')
})

test('mermaid and plantuml fences are diagrams, never coloured code', async () => {
  // Both tags would otherwise be plausible highlight targets; the diagram path
  // has to win, and the fallback for a failed diagram is plain source.
  const doc = await buildDocument('```mermaid\nflowchart TD\n A-->B\n```', 'markdown', {
    renderMermaid: async () => '<svg></svg>',
  })

  assert.match(doc, /<div class="diagram"><svg><\/svg><\/div>/)
  assert.doesNotMatch(doc, /language-mermaid/)
})

test('markdown drops dangerous link schemes but keeps the text', async () => {
  const doc = await buildDocument('[click](javascript:alert(1)) and [ok](https://x.test)', 'markdown')

  assert.doesNotMatch(doc, /javascript:/i)
  assert.match(doc, /click/)
  assert.match(doc, /<a href="https:\/\/x\.test"[^>]*>ok<\/a>/)
})

test('markdown link filtering survives scheme obfuscation', async () => {
  for (const href of ['java\tscript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)']) {
    const doc = await buildDocument(`[x](${href})`, 'markdown')
    assert.doesNotMatch(doc, /href="[^"]*script:/i, `not neutralised: ${JSON.stringify(href)}`)
  }
})

test('markdown links cannot reach back through window.opener', async () => {
  const doc = await buildDocument('[ok](https://x.test)', 'markdown')
  assert.match(doc, /rel="noopener noreferrer nofollow"/)
})

test('markdown keeps tables and blockquotes', async () => {
  const doc = await buildDocument('| a | b |\n|---|---|\n| 1 | 2 |\n\n> quoted', 'markdown')

  assert.match(doc, /<table>/)
  assert.match(doc, /<th>a<\/th>/)
  assert.match(doc, /<blockquote>/)
})

test('a whole .mmd file is drawn as one diagram', async () => {
  const doc = await buildDocument('flowchart TD\n A-->B', 'mermaid', {
    renderMermaid: async (source) => `<svg data-len="${source.length}"></svg>`,
  })

  assert.match(doc, /<div class="diagram diagram-page"><svg data-len="19"><\/svg><\/div>/)
  // No fenced-block machinery involved: the file is the diagram source, not
  // markdown that happens to contain one.
  assert.doesNotMatch(doc, /class="markdown"/)
})

test('a whole .puml file is fetched as an image, not linked to a server', async () => {
  const doc = await buildDocument('@startuml\nA->B\n@enduml', 'plantuml', {
    diagrams: { mermaid: true, plantUml: true, plantUmlServer: 'https://uml.internal/plantuml' },
    fetchDiagram: async () => 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  })

  assert.match(doc, /<img src="data:image\/svg\+xml;base64,/)
  // The document must never reach a host itself — the sandbox CSP is img-src
  // `data: blob:` with no host, so an https src would simply not load.
  assert.doesNotMatch(doc, /src="https:/)
  assert.match(doc, /Rendered by uml\.internal/)
  assert.match(doc, /source was sent there/)
})

test('a diagram file whose source contains a fence is still one diagram', async () => {
  // Regression guard for the tempting shortcut of wrapping the file in a
  // synthetic ```mermaid block: this source would close that fence early.
  const source = 'flowchart TD\n A["```"]-->B'
  const doc = await buildDocument(source, 'mermaid', {
    renderMermaid: async (received) => {
      assert.equal(received, source, 'the renderer must receive the file verbatim')
      return '<svg></svg>'
    },
  })

  assert.match(doc, /<div class="diagram diagram-page"><svg><\/svg><\/div>/)
})

test('with drawing off, a diagram file opens as source and sends nothing', async () => {
  const off = { mermaid: false, plantUml: false, plantUmlServer: 'https://www.plantuml.com/plantuml' }

  const puml = await buildDocument(`@startuml\n${XSS}\n@enduml`, 'plantuml', {
    diagrams: off,
    // Passing a fetcher that throws proves the disabled path never calls it.
    fetchDiagram: async () => {
      throw new Error('must not be reached')
    },
  })

  assert.match(puml, /switched off/)
  assert.match(puml, /sending the source to a PlantUML server/)
  assert.match(puml, /<pre><code>/)
  assert.doesNotMatch(puml, /<script/i, 'the source is escaped on this path too')
  assert.match(puml, /&lt;script&gt;/)

  const mmd = await buildDocument('flowchart TD', 'mermaid', { diagrams: off })
  assert.match(mmd, /switched off/)
  assert.match(mmd, /<pre><code>flowchart TD<\/code><\/pre>/)
})

test('a diagram file that fails to render falls back to its source', async () => {
  const doc = await buildDocument('flowchart TD\n bad', 'mermaid', {
    renderMermaid: async () => {
      throw new Error('Parse error on line 2')
    },
  })

  assert.match(doc, /Parse error on line 2/)
  assert.match(doc, /flowchart TD/, 'the source is still readable')
})

test('a diagram file with no renderer injected says so rather than blanking', async () => {
  const doc = await buildDocument('flowchart TD', 'mermaid')

  assert.match(doc, /Diagram rendering is unavailable/)
  assert.match(doc, /flowchart TD/)
})

test('mermaid blocks become diagrams via the injected renderer', async () => {
  const fake = async (source: string, index: number) =>
    `<svg data-index="${index}" data-len="${source.length}"></svg>`
  const doc = await buildDocument('# T\n\n```mermaid\nflowchart TD\n A-->B\n```\n', 'markdown', {
    renderMermaid: fake,
  })

  assert.match(doc, /<div class="diagram"><svg data-index="0"/)
  assert.doesNotMatch(doc, /data-mermaid=/, 'every placeholder must be filled')
  assert.doesNotMatch(doc, /language-mermaid/, 'it is a diagram now, not a code block')
})

test('a failed diagram falls back to its source, keeping the rest of the document', async () => {
  const failing = async () => {
    throw new Error('bad diagram syntax')
  }
  const doc = await buildDocument('# Title\n\n```mermaid\nnonsense\n```\n\nAfter.', 'markdown', {
    renderMermaid: failing,
  })

  assert.match(doc, /<h1>Title<\/h1>/)
  assert.match(doc, /After\./)
  assert.match(doc, /nonsense/)
  assert.match(doc, /bad diagram syntax/)
})

test('mermaid source is never treated as markup', async () => {
  const passthrough = async (source: string) => `<svg>${source}</svg>`
  const doc = await buildDocument('```mermaid\nA[<script>alert(1)</script>]\n```', 'markdown', {
    renderMermaid: async () => {
      throw new Error('renderer down')
    },
  })

  // The fallback path shows the source, so it must be escaped there too.
  assert.doesNotMatch(doc, /<script/i)
  assert.match(doc, /&lt;script&gt;/)
  void passthrough
})

test('markdown without diagrams needs no renderer at all', async () => {
  const doc = await buildDocument('# Title\n\n```js\nconst a = 1\n```', 'markdown')

  assert.match(doc, /<h1>Title<\/h1>/)
  assert.match(doc, /language-js/)
})

test('plantuml blocks are fetched through the injected fetcher, not linked directly', async () => {
  let requested = ''
  const doc = await buildDocument('```plantuml\n@startuml\nA -> B\n@enduml\n```', 'markdown', {
    fetchDiagram: async (url) => {
      requested = url
      return 'data:image/svg+xml;base64,PHN2Zy8+'
    },
  })

  // The URL must go to the configured server, but the <img> must carry a data:
  // URI — the sandbox CSP allows no remote image host at all.
  // Deflate + PlantUML's URL-safe alphabet, not the `~h` hex form: hex doubles
  // the source and the server 400s past an 8 KB URL. See markdown.test.ts.
  assert.match(requested, /^https:\/\/www\.plantuml\.com\/plantuml\/svg\/[0-9A-Za-z_-]+$/)
  assert.match(doc, /<img src="data:image\/svg\+xml;base64,/)
  assert.doesNotMatch(doc, /<img src="https:/)
  // The source leaves the machine, so the reader is told.
  assert.match(doc, /www\.plantuml\.com/)
})

test('plantuml aliases are all recognised', async () => {
  for (const lang of ['plantuml', 'puml', 'uml']) {
    let called = false
    await buildDocument(`\`\`\`${lang}\n@startuml\nA -> B\n@enduml\n\`\`\``, 'markdown', {
      fetchDiagram: async () => {
        called = true
        return 'data:image/svg+xml;base64,PHN2Zy8+'
      },
    })
    assert.ok(called, `${lang} was not recognised`)
  }
})

test('a custom plantuml server is used verbatim', async () => {
  let requested = ''
  await buildDocument('```puml\n@startuml\nA -> B\n@enduml\n```', 'markdown', {
    diagrams: { mermaid: true, plantUml: true, plantUmlServer: 'https://uml.internal/plantuml' },
    fetchDiagram: async (url) => {
      requested = url
      return 'data:image/svg+xml;base64,PHN2Zy8+'
    },
  })
  assert.match(requested, /^https:\/\/uml\.internal\/plantuml\/svg\/[0-9A-Za-z_-]+$/)
})

test('disabled diagram kinds stay ordinary code blocks', async () => {
  const source = '```mermaid\nflowchart TD\n A-->B\n```\n\n```plantuml\n@startuml\nA -> B\n@enduml\n```'
  const doc = await buildDocument(source, 'markdown', {
    diagrams: { mermaid: false, plantUml: false, plantUmlServer: 'https://www.plantuml.com/plantuml' },
    renderMermaid: async () => '<svg></svg>',
    fetchDiagram: async () => 'data:image/svg+xml;base64,PHN2Zy8+',
  })

  assert.match(doc, /language-mermaid/)
  assert.match(doc, /language-plantuml/)
  assert.doesNotMatch(doc, /<svg>/)
  assert.doesNotMatch(doc, /<img/)
})

test('a plantuml server failure falls back to the source, not an empty box', async () => {
  const doc = await buildDocument('```plantuml\n@startuml\nA -> B\n@enduml\n```', 'markdown', {
    fetchDiagram: async () => {
      throw new Error('The diagram server answered HTTP 503.')
    },
  })

  assert.match(doc, /HTTP 503/)
  assert.match(doc, /@startuml/)
})

test('html is passed through untouched — it is the document', async () => {
  const source = '<!doctype html><html><body><script>ok()</script></body></html>'
  assert.equal(await buildDocument(source, 'html'), source)
})

test('generated documents are complete and self-contained', async () => {
  for (const kind of ['json', 'markdown'] as const) {
    const doc = await buildDocument('"hello"', kind)
    assert.match(doc, /^<!doctype html>/)
    assert.match(doc, /<meta charset="utf-8">/)
    assert.match(doc, /<style>/, 'styles must be inline: the CSP forbids remote stylesheets')
  }
})
