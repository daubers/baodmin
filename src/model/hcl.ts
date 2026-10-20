// Minimal HCL parser: enough for OpenBao ACL policies (blocks, attributes,
// strings, numbers, bools, lists, objects, comments). Not a general HCL parser.

export type HclValue = string | number | boolean | HclValue[] | { [key: string]: HclValue }

export interface HclBlock {
  type: string
  labels: string[]
  body: HclBody
}

export interface HclBody {
  attributes: Record<string, HclValue>
  blocks: HclBlock[]
}

export class HclSyntaxError extends Error {
  readonly line: number
  constructor(message: string, line: number) {
    super(`${message} (line ${line})`)
    this.name = 'HclSyntaxError'
    this.line = line
  }
}

type Token =
  | { t: 'ident' | 'string' | 'number'; v: string; line: number }
  | { t: 'punct'; v: '{' | '}' | '[' | ']' | '=' | ','; line: number }
  | { t: 'eof'; v: ''; line: number }

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  let line = 1
  while (i < src.length) {
    const c = src[i]
    if (c === '\n') {
      line++
      i++
    } else if (/\s/.test(c)) {
      i++
    } else if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') i++
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end < 0) throw new HclSyntaxError('Unterminated comment', line)
      line += src.slice(i, end).split('\n').length - 1
      i = end + 2
    } else if (c === '"') {
      let s = ''
      i++
      for (;;) {
        if (i >= src.length || src[i] === '\n') throw new HclSyntaxError('Unterminated string', line)
        if (src[i] === '"') break
        if (src[i] === '\\') {
          const n = src[i + 1]
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n
          i += 2
        } else s += src[i++]
      }
      i++
      out.push({ t: 'string', v: s, line })
    } else if ('{}[]=,'.includes(c)) {
      out.push({ t: 'punct', v: c as '{', line })
      i++
    } else if (/[0-9-]/.test(c)) {
      const m = /^-?[0-9]+(\.[0-9]+)?/.exec(src.slice(i))
      if (!m) throw new HclSyntaxError(`Unexpected character "${c}"`, line)
      out.push({ t: 'number', v: m[0], line })
      i += m[0].length
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(src.slice(i))!
      out.push({ t: 'ident', v: m[0], line })
      i += m[0].length
    } else {
      throw new HclSyntaxError(`Unexpected character "${c}"`, line)
    }
  }
  out.push({ t: 'eof', v: '', line })
  return out
}

class Parser {
  private pos = 0
  private readonly tokens: Token[]
  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.pos]
  }
  private next(): Token {
    return this.tokens[this.pos++]
  }
  private isPunct(v: string): boolean {
    const t = this.peek()
    return t.t === 'punct' && t.v === v
  }
  private expectPunct(v: string): void {
    const t = this.next()
    if (t.t !== 'punct' || t.v !== v) throw new HclSyntaxError(`Expected "${v}"`, t.line)
  }

  parseBody(closing: boolean): HclBody {
    const body: HclBody = { attributes: {}, blocks: [] }
    for (;;) {
      if (this.peek().t === 'eof') {
        if (closing) throw new HclSyntaxError('Missing closing "}"', this.peek().line)
        return body
      }
      if (closing && this.isPunct('}')) {
        this.next()
        return body
      }
      const key = this.next()
      if (key.t !== 'ident' && key.t !== 'string') throw new HclSyntaxError(`Unexpected "${key.v}"`, key.line)
      if (this.isPunct('=')) {
        this.next()
        body.attributes[key.v] = this.parseValue()
        continue
      }
      const labels: string[] = []
      while (this.peek().t === 'string') labels.push(this.next().v)
      this.expectPunct('{')
      body.blocks.push({ type: key.v, labels, body: this.parseBody(true) })
    }
  }

  private parseValue(): HclValue {
    const t = this.next()
    if (t.t === 'string') return t.v
    if (t.t === 'number') return Number(t.v)
    if (t.t === 'ident') {
      if (t.v === 'true') return true
      if (t.v === 'false') return false
      throw new HclSyntaxError(`Unsupported expression "${t.v}"`, t.line)
    }
    if (t.t === 'punct' && t.v === '[') {
      const items: HclValue[] = []
      while (!this.isPunct(']')) {
        items.push(this.parseValue())
        if (this.isPunct(',')) this.next()
        else if (!this.isPunct(']')) throw new HclSyntaxError('Expected "," or "]"', this.peek().line)
      }
      this.next()
      return items
    }
    if (t.t === 'punct' && t.v === '{') {
      const obj: { [key: string]: HclValue } = {}
      while (!this.isPunct('}')) {
        const k = this.next()
        if (k.t !== 'ident' && k.t !== 'string') throw new HclSyntaxError(`Unexpected "${k.v}"`, k.line)
        if (this.isPunct('=')) this.next()
        obj[k.v] = this.parseValue()
        if (this.isPunct(',')) this.next()
      }
      this.next()
      return obj
    }
    throw new HclSyntaxError(`Unexpected "${t.v}"`, t.line)
  }
}

export function parseHcl(src: string): HclBody {
  return new Parser(tokenize(src)).parseBody(false)
}
